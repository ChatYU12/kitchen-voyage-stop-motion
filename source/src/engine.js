// 纸片定格引擎：加载贴图、生成带厚度与投影的纸片、关键帧工具
import * as THREE from 'three';
import MANIFEST from './manifest.json';

export const FPS_STEP = 12; // 定格：每秒 12 个姿态（24 帧时间线上一拍二）

export function assetURL(name) {
  if (window.__ASSETS__ && window.__ASSETS__[name]) return window.__ASSETS__[name];
  return 'assets/' + name + '.webp';
}

// ---------- 加载 ----------
export const IMG = {};   // name -> HTMLImageElement/ImageBitmap
export const TEX = {};   // name -> THREE.Texture

export async function loadAll(names, onProgress) {
  let done = 0;
  await Promise.all(names.map(async (n) => {
    let img;
    for (let tries = 0; tries < 3; tries++) {
      img = new Image(); img.decoding = 'async';
      img.src = assetURL(n) + (tries ? (assetURL(n).startsWith('data:') ? '' : '?r=' + tries) : '');
      const ok = await img.decode().then(() => true).catch(() => false);
      if (ok && img.naturalWidth) break;
      await new Promise((r) => setTimeout(r, 400 * (tries + 1)));
    }
    if (!img.naturalWidth) { // 实在加载不了：用 1x1 透明图顶上，不让整片卡住
      const c = document.createElement('canvas'); c.width = c.height = 2; img = c; img.naturalWidth = 2; img.naturalHeight = 2;
      console.warn('asset failed', n);
    }
    IMG[n] = img;
    done++; onProgress && onProgress(done / names.length);
  }));
}

let renderer = null;
export function setRenderer(r) { renderer = r; }

export function texFrom(src, { srgb = true, repeat = null, mirror = false } = {}) {
  const t = src.isTexture ? src : new THREE.Texture(src);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (repeat) {
    t.wrapS = t.wrapT = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}

export function tex(name) {
  if (!TEX[name]) TEX[name] = texFrom(IMG[name]);
  return TEX[name];
}

// ---------- 纸纹法线贴图（程序生成） ----------
let _paperNormal = null;
export function paperNormal() {
  if (_paperNormal) return _paperNormal;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  // 高度场：随机纤维 + 细噪
  const h = new Float32Array(S * S);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < S * S; i++) h[i] = rnd() * 0.35;
  for (let f = 0; f < 2600; f++) {
    let x = rnd() * S, y = rnd() * S; const a = rnd() * Math.PI * 2, len = 8 + rnd() * 40, w = 0.4 + rnd() * 0.8;
    for (let s = 0; s < len; s++) {
      const xi = ((x | 0) + S) % S, yi = ((y | 0) + S) % S; h[yi * S + xi] += w;
      x += Math.cos(a + Math.sin(s * 0.2) * 0.3); y += Math.sin(a + Math.sin(s * 0.2) * 0.3);
    }
  }
  // 模糊一遍
  const b = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += h[((y + dy + S) % S) * S + ((x + dx + S) % S)];
    b[y * S + x] = s / 9;
  }
  const id = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = b[y * S + ((x + 1) % S)] - b[y * S + ((x - 1 + S) % S)];
    const hy = b[((y + 1) % S) * S + x] - b[((y - 1 + S) % S) * S + x];
    let nx = -hx * 1.2, ny = -hy * 1.2, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * S + x) * 4; id.data[i] = (nx * 0.5 + 0.5) * 255; id.data[i + 1] = (ny * 0.5 + 0.5) * 255; id.data[i + 2] = (nz * 0.5 + 0.5) * 255; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  _paperNormal = texFrom(c, { srgb: false, repeat: [1, 1] });
  return _paperNormal;
}

// ---------- 裁剪 / 遮罩：从一张图里切出前景片 ----------
// poly: 归一化坐标多边形（保留区域）
export function maskedCanvas(name, poly, blurPx = 0) {
  const img = IMG[name]; const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  if (blurPx) g.filter = `blur(${blurPx}px)`;
  g.beginPath(); poly.forEach(([x, y], i) => { const px = x * c.width, py = y * c.height; i ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.closePath(); g.fill();
  return c;
}

export function blurredCanvas(name, px) {
  const img = IMG[name]; const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d');
  g.filter = `blur(${px}px)`; g.drawImage(img, 0, 0); return c;
}

// ---------- 材质 ----------
function paperMat(map, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    map, roughness: opts.roughness ?? 0.92, metalness: 0,
    normalMap: opts.flatPaper ? null : paperNormal(), normalScale: new THREE.Vector2(0.28, 0.28),
    alphaTest: opts.transparent ? 0 : 0.5, transparent: !!opts.transparent,
    alphaToCoverage: !opts.transparent, side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? !opts.transparent,
    opacity: opts.opacity ?? 1,
  });
  if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveMap = map; m.emissiveIntensity = opts.emissiveIntensity ?? 0.3; }
  return m;
}

// 纸背：只取贴图 alpha，颜色为纸芯奶白
function backingMat(map) {
  const m = new THREE.MeshStandardMaterial({ map, color: 0xeee3cf, roughness: 1, alphaTest: 0.5, alphaToCoverage: true });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
      'vec4 sampledDiffuseColor = texture2D( map, vMapUv ); diffuseColor.a *= sampledDiffuseColor.a;');
  };
  m.customProgramCacheKey = () => 'backing';
  return m;
}

function depthMat(map) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
}

const geoCache = new Map();
function planeGeo(w, h) {
  const k = w.toFixed(4) + 'x' + h.toFixed(4);
  if (!geoCache.has(k)) geoCache.set(k, new THREE.PlaneGeometry(w, h));
  return geoCache.get(k);
}

// ---------- 纸片 ----------
// 一个 Cut 是 Group：origin = 锚点。可以换图（替换动画）。
// opts: h(可见高度) | w(整图宽) | ppu(像素/单位) ; anchor:[u,v] 归一化 ; pivot:'manifest'
export class Cut extends THREE.Group {
  constructor(name, opts = {}) {
    super();
    this.opts = opts;
    this.thick = opts.thick ?? 0.018;
    this.front = new THREE.Mesh(planeGeo(1, 1), new THREE.MeshBasicMaterial());
    this.front.castShadow = opts.castShadow ?? true; this.front.receiveShadow = opts.receiveShadow ?? true;
    this.add(this.front);
    if (!opts.transparent && opts.backing !== false) {
      this.back = new THREE.Mesh(planeGeo(1, 1), new THREE.MeshBasicMaterial());
      this.back.castShadow = false; this.back.receiveShadow = true;
      this.add(this.back);
    }
    this.ppu = opts.ppu || null;
    this.pose = null;
    this.setPose(name, opts.source);
  }
  setPose(name, source) {
    const key = name + (source ? '#' + (source.key || '') : '');
    if (this.pose === key) return this;
    this.pose = key;
    const o = this.opts;
    if (!this._mats) this._mats = {};
    let entry = this._mats[key];
    if (!entry) {
      const map = source ? (source.texture || (source.texture = texFrom(source.canvas))) : tex(name);
      const mf = MANIFEST[name] || { size: [map.image.width, map.image.height], vis: [0, 0, map.image.width, map.image.height], pivot: [map.image.width / 2, map.image.height] };
      const W = map.image.width, H = map.image.height;
      let ppu = this.ppu;
      if (!ppu) {
        if (o.h) ppu = (mf.vis[3] - mf.vis[1]) / o.h * (W / mf.size[0]);
        else if (o.w) ppu = W / o.w;
        else ppu = H / 1;
        if (o.lockScale) this.ppu = ppu;
      }
      const w = W / ppu, h = H / ppu;
      let ax, ay;
      if (o.anchor) { ax = o.anchor[0]; ay = o.anchor[1]; }
      else { ax = mf.pivot[0] / mf.size[0]; ay = mf.pivot[1] / mf.size[1]; }
      entry = {
        geo: planeGeo(w, h), w, h,
        off: new THREE.Vector3((0.5 - ax) * w, (ay - 0.5) * h, 0),
        front: paperMat(map, o), back: this.back ? backingMat(map) : null, depth: depthMat(map),
      };
      this._mats[key] = entry;
    }
    this.front.geometry = entry.geo; this.front.material = entry.front; this.front.customDepthMaterial = entry.depth;
    this.front.position.copy(entry.off);
    if (this.back) {
      this.back.geometry = entry.geo; this.back.material = entry.back;
      this.back.position.copy(entry.off).add(new THREE.Vector3(0.0, -0.004, -this.thick));
      this.back.scale.set(1.008, 1.008, 1);
    }
    this.size = [entry.w, entry.h];
    return this;
  }
  set opacity(v) {
    for (const k in this._mats) { const e = this._mats[k]; e.front.opacity = v; }
  }
}

// ---------- 工具 ----------
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t) => t * t * t;
export const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const backOut = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// 关键帧：[[t, v], ...]，v 为数字或数组
export function kf(t, keys, ease = smooth) {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1]; if (t >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t >= t0 && t <= t1) {
      const e = (keys[i + 1][2] || ease)((t - t0) / (t1 - t0));
      if (Array.isArray(v0)) return v0.map((a, j) => lerp(a, v1[j], e));
      return lerp(v0, v1, e);
    }
  }
  return last[1];
}

// 按时间选择姿态：[[t, name], ...]
export function pick(t, list) {
  let r = list[0][1];
  for (const [tt, v] of list) if (t >= tt) r = v;
  return r;
}

// 确定性的抖动（定格手工误差）
export function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
export function jitter(step, id, amt) { return (hash(step * 13.7 + id * 91.3) - 0.5) * 2 * amt; }

export const between = (t, a, b) => t >= a && t < b;
