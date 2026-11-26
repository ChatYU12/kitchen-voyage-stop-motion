// 厨房场景：台面、墙、窗、3D 搪瓷盆、水面，以及全部纸片演员
import * as THREE from 'three';
import { Cut, IMG, tex, texFrom, paperNormal, maskedCanvas, blurredCanvas } from './engine.js';
import MANIFEST from './manifest.json';

export const BASIN = { cx: 0, cz: 0.8, rimR: 5.62, rimY: 2.45, WL: 1.85 };
// 盆的外轮廓（r, y）
const PROFILE = [[4.3, 0.0], [4.42, 0.04], [4.75, 0.55], [5.15, 1.45], [5.45, 2.15], [5.6, 2.42]];
export function innerR(y) {
  const p = PROFILE.map(([r, yy]) => [r - 0.07, yy]);
  for (let i = 0; i < p.length - 1; i++) if (y >= p[i][1] && y <= p[i + 1][1]) {
    const t = (y - p[i][1]) / (p[i + 1][1] - p[i][1]); return p[i][0] + (p[i + 1][0] - p[i][0]) * t;
  }
  return p[p.length - 1][0];
}
export const WATER_R = innerR(BASIN.WL) - 0.01;
// 后沿/前沿上某 x 处的 z
export const rimZ = (x, back = true, r = BASIN.rimR) => BASIN.cz + (back ? -1 : 1) * Math.sqrt(Math.max(0, r * r - (x - BASIN.cx) ** 2));
export const waterZ = (x, back = true) => rimZ(x, back, WATER_R);

const H = { yuan: 1.0, diandian: 0.86, li: 0.74 };
function charPPU(idle, h) { const m = MANIFEST[idle]; return (m.vis[3] - m.vis[1]) / h; }

// 从一张图拼成可平铺的镜像贴图
function tileCanvas(name, crop, outW, outH) {
  const img = IMG[name], c = document.createElement('canvas'); c.width = outW; c.height = outH;
  const g = c.getContext('2d');
  const sx = crop[0] * img.naturalWidth, sy = crop[1] * img.naturalHeight, sw = (crop[2] - crop[0]) * img.naturalWidth, sh = (crop[3] - crop[1]) * img.naturalHeight;
  g.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  return c;
}

function stdMat(map, o = {}) {
  return new THREE.MeshStandardMaterial({ map, roughness: o.roughness ?? 0.95, metalness: 0, normalMap: paperNormal(), normalScale: new THREE.Vector2(o.ns ?? 0.3, o.ns ?? 0.3), side: o.side ?? THREE.FrontSide, color: o.color ?? 0xffffff });
}

export function buildWorld(scene) {
  const W = { scene, all: [], opt: [] };
  const add = (obj, parent = scene) => { parent.add(obj); W.all.push(obj); return obj; };

  // ---------- 台面 ----------
  const ctex = texFrom(tileCanvas('counter_texture', [0.02, 0.02, 0.98, 0.98], 1280, 720), { repeat: [5, 2.2], mirror: true });
  const counter = new THREE.Mesh(new THREE.PlaneGeometry(70, 26), stdMat(ctex, { ns: 0.12 }));
  counter.rotation.x = -Math.PI / 2; counter.position.set(0, 0, 7.8); counter.receiveShadow = true; scene.add(counter);
  // 台面前沿
  const bandC = tileCanvas('kitchen_backdrop', [0, 0.705, 1, 0.74], 1280, 64);
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(70, 1.0), stdMat(texFrom(bandC, { repeat: [6, 1], mirror: true })));
  edge.position.set(0, -0.5, 20.8); edge.receiveShadow = true; scene.add(edge);

  // ---------- 墙 ----------
  const ttex = texFrom(IMG.tile_texture, { repeat: [7, 3], mirror: true });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(70, 24), stdMat(ttex, { ns: 0.1 }));
  wall.position.set(0, 12, -5.4); wall.receiveShadow = true; scene.add(wall);
  // 红砖腰线（从背景图裁出）
  const red = tileCanvas('kitchen_backdrop', [0, 0.655, 1, 0.715], 1280, 80);
  const redM = new THREE.Mesh(new THREE.PlaneGeometry(70, 0.9), stdMat(texFrom(red, { repeat: [7, 1], mirror: true })));
  redM.position.set(0, 0.45, -5.38); redM.receiveShadow = true; scene.add(redM);

  // 窗
  W.window = add(new Cut('window_cutout', { h: 6.2, anchor: [0.5, 0.5], thick: 0.12 }));
  W.window.position.set(-4.6, 7.8, -5.2);
  // 窗玻璃后的暖光
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 5.2), new THREE.MeshBasicMaterial({ color: 0xffe3a6, transparent: true, opacity: 0.0 }));
  glow.position.set(-4.6, 7.9, -5.3); scene.add(glow);
  // 窗光（叠加柔光）
  const lightTex = tex('window_light');
  W.winLight = new THREE.Mesh(new THREE.PlaneGeometry(9, 6.6), new THREE.MeshBasicMaterial({ map: lightTex, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
  W.winLight.position.set(-1.6, 4.6, -4.2); W.winLight.rotation.set(-0.35, 0, -0.08); scene.add(W.winLight);
  W.opt.push(W.winLight);

  // 片名（写在窗玻璃上）
  {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d');
    W.titleCanvas = c; W.titleTex = texFrom(c);
    W.title = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 4.3), new THREE.MeshBasicMaterial({ map: W.titleTex, transparent: true, opacity: 0, depthWrite: false }));
    W.title.position.set(-4.6, 7.9, -5.02); scene.add(W.title);
    W.drawTitle = () => {
      g.clearRect(0, 0, 1024, 1024);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const font = '"ZCOOL KuaiLe","Hannotate SC","Yuanti SC","PingFang SC","Noto Sans SC",sans-serif';
      g.font = `200px ${font}`;
      const lines = [['厨房里的', 330], ['大航海', 620]];
      for (const [s, y] of lines) {
        g.lineJoin = 'round'; g.lineWidth = 26; g.strokeStyle = 'rgba(92,58,32,0.55)'; g.strokeText(s, 512, y);
        g.fillStyle = '#fffaf0'; g.fillText(s, 512, y);
      }
      g.font = `64px ${font}`; g.fillStyle = 'rgba(255,250,240,0.95)'; g.fillText('〜 三颗豌豆的故事 〜', 512, 820);
      W.titleTex.needsUpdate = true;
    };
    W.drawTitle();
  }

  // ---------- 3D 搪瓷盆 ----------
  {
    const outerC = tileCanvas('basin_side', [0.18, 0.55, 0.82, 0.86], 1024, 256);
    const outerT = texFrom(outerC, { repeat: [5, 1], mirror: true });
    const innerC = tileCanvas('basin_top', [0.3, 0.3, 0.7, 0.62], 1024, 512);
    const innerT = texFrom(innerC, { repeat: [5, 1], mirror: true });
    const pts = PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
    const outer = new THREE.Mesh(new THREE.LatheGeometry(pts, 160), stdMat(outerT, { roughness: 0.55, ns: 0.25 }));
    outer.material.emissive = new THREE.Color(0xffffff); outer.material.emissiveMap = outerT; outer.material.emissiveIntensity = 0.22;
    const inPts = PROFILE.map(([r, y]) => new THREE.Vector2(r - 0.07, y + 0.02)).reverse();
    const inner = new THREE.Mesh(new THREE.LatheGeometry(inPts, 160), stdMat(innerT, { roughness: 0.5, ns: 0.25 }));
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x34548c, roughness: 0.45, normalMap: paperNormal(), normalScale: new THREE.Vector2(0.4, 0.4) });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(BASIN.rimR - 0.03, 0.085, 16, 200), rimMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = BASIN.rimY;
    const foot = new THREE.Mesh(new THREE.TorusGeometry(4.36, 0.05, 10, 160), rimMat); foot.rotation.x = Math.PI / 2; foot.position.y = 0.04;
    // 保证法线方向：外壁朝外，内壁朝内
    const fixN = (mesh, want) => {
      const n = mesh.geometry.attributes.normal, P = mesh.geometry.attributes.position;
      const i = Math.floor(n.count / 2); const d = n.getX(i) * P.getX(i) + n.getZ(i) * P.getZ(i);
      if (Math.sign(d) !== want) { for (let k = 0; k < n.array.length; k++) n.array[k] *= -1; n.needsUpdate = true; }
    };
    outer.geometry.computeVertexNormals(); inner.geometry.computeVertexNormals();
    fixN(outer, 1); fixN(inner, -1);
    const g = new THREE.Group(); g.add(outer, inner, rim, foot);
    for (const m of [outer, inner, rim, foot]) { m.castShadow = true; m.receiveShadow = true; }
    g.position.set(BASIN.cx, 0, BASIN.cz); scene.add(g); W.basin = g;
  }

  // ---------- 水面 ----------
  {
    const wt = texFrom(IMG.water_texture, { repeat: [1.6, 1.6], mirror: true });
    W.waterTex = wt;
    const mat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.35, metalness: 0.0, normalMap: paperNormal(), normalScale: new THREE.Vector2(0.5, 0.5), color: 0xe6f2f2 });
    const water = new THREE.Mesh(new THREE.CircleGeometry(WATER_R, 128), mat);
    water.rotation.x = -Math.PI / 2; water.position.set(BASIN.cx, BASIN.WL, BASIN.cz); water.receiveShadow = true;
    scene.add(water); W.water = water;
    // 盆壁水线
    const ring = new THREE.Mesh(new THREE.RingGeometry(WATER_R - 0.08, WATER_R, 128), new THREE.MeshBasicMaterial({ color: 0xe9f6f1, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(BASIN.cx, BASIN.WL + 0.004, BASIN.cz); scene.add(ring);
  }

  // ---------- 固定道具 ----------
  W.tap = add(new Cut('tap_side', { h: 4.2, anchor: [0.10, 0.44], thick: 0.06 }));
  W.tap.position.set(-2.0, 4.7, -5.0);

  // 滤篮：后片 + 前片（豌豆夹在中间）
  W.colander = add(new Cut('colander', { w: 4.0, anchor: [0.5, 0.985], thick: 0.04 }));
  W.colander.position.set(-8.6, 0, 1.0);
  const colFront = { key: 'front', canvas: maskedCanvas('colander', [[0, 0.30], [0.2, 0.36], [0.5, 0.40], [0.8, 0.36], [1, 0.30], [1, 1], [0, 1]]) };
  W.colanderFront = add(new Cut('colander', { w: 4.0, anchor: [0.5, 0.985], source: colFront, thick: 0.02 }));
  W.colanderFront.position.set(-8.6, 0, 1.3);

  // 圆盘：后片 + 前沿片
  W.plate = add(new Cut('kitchen_plate', { w: 3.6, anchor: [0.5, 0.985], thick: 0.02 }));
  W.plate.position.set(8.3, 0.01, 1.4);
  const plFront = { key: 'front', canvas: maskedCanvas('kitchen_plate', [[0, 0.5], [0.15, 0.72], [0.5, 0.80], [0.85, 0.72], [1, 0.5], [1, 1], [0, 1]]) };
  W.plateFront = add(new Cut('kitchen_plate', { w: 3.6, anchor: [0.5, 0.985], source: plFront, thick: 0.02 }));
  W.plateFront.position.set(8.3, 0.01, 1.72);

  W.towel = add(new Cut('tea_towel', { w: 4.6, anchor: [0.5, 0.985], thick: 0.05 }));

  // 木勺：锚点在搭盆沿处
  W.spoon = add(new Cut('spoon_side', { w: 5.6, anchor: [0.55, 0.42], thick: 0.06 }));
  W.spoonTop = add(new Cut('spoon_top', { w: 5.6, anchor: [0.55, 0.5], thick: 0.05 }));
  W.spoonTop.rotation.x = -Math.PI / 2;

  // 砧板滑道
  {
    const top = texFrom(tileCanvas('wood_board', [0.22, 0.12, 0.96, 0.88], 1024, 512));
    const side = texFrom(tileCanvas('wood_board', [0.3, 0.05, 0.9, 0.12], 512, 64));
    const mTop = stdMat(top, { roughness: 0.8 }), mSide = stdMat(side, { roughness: 0.9, color: 0xd9a35a });
    const box = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.16, 1.6), [mSide, mSide, mTop, mSide, mSide, mSide]);
    box.castShadow = box.receiveShadow = true; box.position.x = 2.0; // 原点在左端
    W.board = new THREE.Group(); W.board.add(box); scene.add(W.board);
  }

  // ---------- 角色 ----------
  const mk = (idle, h) => { const c = new Cut(idle, { ppu: charPPU(idle, h), thick: 0.03 }); add(c); return c; };
  W.yuan = mk('yuan_idle', H.yuan);
  W.dd = mk('diandian_idle', H.diandian);
  W.li = mk('li_idle', H.li);
  // 第二套（同屏需要复制时，例如俯视小人）
  W.paddle = add(new Cut('small_paddle', { w: 1.25, anchor: [0.5, 0.5], thick: 0.02 }));

  // ---------- 纸船（侧/俯/朝镜头/颠簸/湿） ----------
  const boatPoly = [[0, 0.24], [0.25, 0.42], [0.5, 0.60], [0.75, 0.42], [1, 0.22], [1, 1], [0, 1]];
  W.boatW = 3.5;
  W.boat = add(new Cut('boat_side', { w: W.boatW, anchor: [0.5, 0.86], thick: 0.02 }));
  W.boatFrontSrc = {
    boat_side: { key: 'bf', canvas: maskedCanvas('boat_side', boatPoly) },
    boat_wet: { key: 'bfw', canvas: maskedCanvas('boat_wet', boatPoly) },
    boat_rock: { key: 'bfr', canvas: maskedCanvas('boat_rock', [[0, 0.10], [0.3, 0.35], [0.55, 0.55], [0.8, 0.45], [1, 0.35], [1, 1], [0, 1]]) },
  };
  W.boatFront = add(new Cut('boat_side', { w: W.boatW, anchor: [0.5, 0.86], source: W.boatFrontSrc.boat_side, thick: 0.01, backing: false }));
  W.boatTop = add(new Cut('boat_top', { w: W.boatW, anchor: [0.5, 0.5], thick: 0.02 })); W.boatTop.rotation.x = -Math.PI / 2;

  // 豆荚
  W.pod = add(new Cut('pod_side', { w: 3.0, anchor: [0.5, 0.72], thick: 0.02 }));
  W.podFront = add(new Cut('pod_side', { w: 3.0, anchor: [0.5, 0.72], thick: 0.01, backing: false, source: { key: 'pf', canvas: maskedCanvas('pod_side', [[0, 0.58], [0.25, 0.60], [0.5, 0.52], [0.75, 0.40], [0.92, 0.22], [1, 0.0], [1, 1], [0, 1]]) } }));
  W.podTop = add(new Cut('pod_top', { w: 3.0, anchor: [0.5, 0.5], thick: 0.02 })); W.podTop.rotation.x = -Math.PI / 2;

  // 菜叶
  W.leaf = add(new Cut('lettuce_side', { w: 5.2, anchor: [0.5, 0.78], thick: 0.02 }));
  W.leafTop = add(new Cut('lettuce_top', { w: 5.6, anchor: [0.5, 0.5], thick: 0.02 })); W.leafTop.rotation.x = -Math.PI / 2;
  W.stem = add(new Cut('lettuce_stem', { w: 2.4, anchor: [0.08, 0.75], thick: 0.03 }));

  // 折纸阶段
  W.paperFlat = add(new Cut('baking_paper_flat', { w: 3.2, anchor: [0.5, 0.5], thick: 0.01 })); W.paperFlat.rotation.x = -Math.PI / 2;
  W.paperTri = add(new Cut('baking_paper_triangle', { w: 3.6, anchor: [0.5, 0.95], thick: 0.02 }));
  W.paperHat = add(new Cut('baking_paper_hat', { w: 3.6, anchor: [0.5, 0.95], thick: 0.02 }));

  // ---------- 水效（透明叠加） ----------
  const fx = (n, o) => add(new Cut(n, Object.assign({ transparent: true, castShadow: false, receiveShadow: false, depthWrite: false, flatPaper: true }, o)));
  W.dropHang = fx('drop_hang', { h: 0.34, anchor: [0.5, 0.05] });
  W.dropFall = fx('drop_fall', { h: 0.5, anchor: [0.5, 0.5] });
  W.splash = fx('splash_crown', { w: 1.6, anchor: [0.5, 0.75] });
  W.splash2 = fx('splash_crown', { w: 2.6, anchor: [0.5, 0.75] });
  W.spray = fx('spray_drops', { w: 1.5, anchor: [0.2, 0.8] });
  W.spray2 = fx('spray_drops', { w: 1.5, anchor: [0.2, 0.8] });
  W.wake = fx('boat_wake', { w: 3.2, anchor: [1.0, 0.6] });
  W.bubbles = fx('bubble_cluster', { w: 1.3, anchor: [0.5, 0.9] });
  W.bubble = fx('bubble_single', { w: 0.22, anchor: [0.5, 0.5] });
  W.waveA = fx('counter_wave', { w: 4.0, anchor: [0.5, 0.78] });
  W.waveB = fx('counter_wave', { w: 3.2, anchor: [0.5, 0.78] });
  W.waveC = fx('water_glints', { w: 4.4, anchor: [0.5, 0.6] });
  W.waveD = fx('water_glints', { w: 3.6, anchor: [0.5, 0.6] });
  W.wave62 = fx('counter_wave', { w: 3.4, anchor: [0.5, 0.78] });
  // 平贴在水面上的效果（俯视）
  const flat = (n, w) => { const c = fx(n, { w, anchor: [0.5, 0.5] }); c.rotation.x = -Math.PI / 2; return c; };
  W.eddy = flat('water_eddy', 2.6);
  W.eddy2 = flat('water_eddy', 2.0);
  // 波纹（侧视用原图的透视椭圆；俯视用程序圆环）
  W.ripS1 = fx('ripple_small', { w: 1.2, anchor: [0.5, 0.5] });
  W.ripS2 = fx('ripple_large', { w: 1.2, anchor: [0.5, 0.5] });
  W.ripS3 = fx('ripple_large', { w: 1.2, anchor: [0.5, 0.5] });
  W.ripS4 = fx('ripple_small', { w: 1.2, anchor: [0.5, 0.5] });
  {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    g.strokeStyle = 'rgba(240,252,255,0.95)'; g.lineWidth = 14; g.beginPath(); g.arc(256, 256, 220, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(70,120,170,0.6)'; g.lineWidth = 6; g.beginPath(); g.arc(256, 256, 200, 0, 7); g.stroke();
    const src = { key: 'ring', canvas: c };
    W.ringTop = add(new Cut('ripple_small', { w: 1, anchor: [0.5, 0.5], source: src, transparent: true, castShadow: false, receiveShadow: false, depthWrite: false, flatPaper: true, backing: false }));
    W.ringTop.rotation.x = -Math.PI / 2;
    W.ringTop2 = add(new Cut('ripple_small', { w: 1, anchor: [0.5, 0.5], source: src, transparent: true, castShadow: false, receiveShadow: false, depthWrite: false, flatPaper: true, backing: false }));
    W.ringTop2.rotation.x = -Math.PI / 2;
  }

  // 第二组角色（俯视镜头里坐船的“小人”与另一处需要的复制）
  W.yuan2 = mk('yuan_idle', H.yuan); W.dd2 = mk('diandian_idle', H.diandian); W.li2 = mk('li_idle', H.li);

  // 可选对象：每帧先全部隐藏，再由镜头摆位
  W.optional = [W.towel, W.paddle, W.boat, W.boatFront, W.boatTop, W.pod, W.podFront, W.podTop, W.leaf, W.leafTop, W.stem,
    W.paperFlat, W.paperTri, W.paperHat, W.board, W.spoonTop, W.yuan, W.dd, W.li, W.yuan2, W.dd2, W.li2,
    W.dropHang, W.dropFall, W.splash, W.splash2, W.spray, W.spray2, W.wake, W.bubbles, W.bubble, W.waveA, W.waveB, W.waveC, W.waveD, W.wave62,
    W.eddy, W.eddy2, W.ripS1, W.ripS2, W.ripS3, W.ripS4, W.ringTop, W.ringTop2];
  W.reset = () => {
    for (const o of W.optional) { o.visible = false; o.position.set(0, 0, 0); o.rotation.set(o.rotation.x, 0, 0); o.scale.set(1, 1, 1); }
    // 平放的要保留 rotation.x
    for (const o of [W.boatTop, W.podTop, W.leafTop, W.paperFlat, W.spoonTop, W.eddy, W.eddy2, W.ringTop, W.ringTop2]) o.rotation.set(-Math.PI / 2, 0, 0);
    for (const o of [W.towel, W.paddle, W.boat, W.boatFront, W.pod, W.podFront, W.leaf, W.stem, W.paperTri, W.paperHat, W.board, W.yuan, W.dd, W.li, W.yuan2, W.dd2, W.li2,
      W.dropHang, W.dropFall, W.splash, W.splash2, W.spray, W.spray2, W.wake, W.bubbles, W.bubble, W.waveA, W.waveB, W.waveC, W.waveD, W.wave62, W.ripS1, W.ripS2, W.ripS3, W.ripS4]) o.rotation.set(0, 0, 0);
    for (const o of W.optional) if (o.opts && o.opts.transparent) o.opacity = 1;
    W.title.material.opacity = 0;
    W.spoon.visible = true; W.spoon.position.set(BASIN.rimR + 0.02, BASIN.rimY + 0.07, BASIN.cz + 0.0); W.spoon.rotation.set(0, 0, -0.09);
    W.boat.setPose('boat_side'); W.boatFront.setPose('boat_side', W.boatFrontSrc.boat_side);
  };
  return W;
}
