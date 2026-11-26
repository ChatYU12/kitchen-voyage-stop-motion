import * as THREE from 'three';
import { loadAll, setRenderer, FPS_STEP, clamp, hash, tex } from './engine.js';
import { buildWorld } from './world.js';
import { SHOTS, TOTAL, shotAt, setStep, SUBS } from './shots.js';
import { Sound, SFX } from './audio.js';
import MANIFEST from './manifest.json';

const $ = (s) => document.querySelector(s);
const stage = $('#stage'), canvas = $('#c');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__CAPTURE__ });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
setRenderer(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9dcc4);
scene.fog = new THREE.Fog(0xe9dcc4, 40, 90);
const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 200);

// 灯光：窗边暖阳 + 冷色天光 + 补光
const hemi = new THREE.HemisphereLight(0xdfeaf2, 0xc7a27a, 1.25); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d6, 2.6); sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xcfe0ff, 0.45); fill.position.set(8, 6, 10); scene.add(fill);
const SUN_DIR = new THREE.Vector3(-0.55, 0.95, 0.62).normalize();

let W = null;

// ---------- 尺寸 ----------
function resize() {
  const vw = stage.clientWidth, vh = stage.clientHeight;
  let w = vw, h = vw * 9 / 16; if (h > vh) { h = vh; w = vh * 16 / 9; }
  if (window.__CAPTURE__) { w = window.__CAPTURE__.w; h = window.__CAPTURE__.h; }
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  $('#frame').style.width = w + 'px'; $('#frame').style.height = h + 'px';
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  document.documentElement.style.setProperty('--fw', w + 'px');
  lastKey = null;
}
window.addEventListener('resize', resize);

// ---------- 渲染某一时刻 ----------
let lastKey = null;
function renderAt(T) {
  T = clamp(T, 0, TOTAL - 0.001);
  const step = Math.floor(T * FPS_STEP);
  const Ts = step / FPS_STEP; // 定格：只在 1/12 秒的格子上变化
  const s = shotAt(Ts); const t = Ts - s.start;
  const key = step + '|' + renderer.domElement.width;
  if (key === lastKey) return; lastKey = key;
  setStep(step);
  W.reset(); s.update(W, t);
  const c = s.cam(t);
  camera.position.set(...c.pos); camera.fov = c.fov; camera.updateProjectionMatrix(); camera.lookAt(...c.look);
  // 手持感：极轻微的定格误差
  camera.rotation.z += (hash(step * 3.1) - 0.5) * 0.0012;
  // 灯光按镜头收紧阴影范围，并带一点闪烁
  const [cx, cy, cz] = s.shadow.c, r = s.shadow.r;
  sun.target.position.set(cx, cy, cz); sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 30);
  const sc = sun.shadow.camera; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 5; sc.far = 70; sc.updateProjectionMatrix();
  sun.intensity = 2.6 * (1 + (hash(step * 7.7) - 0.5) * 0.03);
  W.waterTex.offset.set((step % 240) * 0.0009, Math.sin(step * 0.05) * 0.01);
  // 淡入淡出
  let fade = 0;
  if (s.fadeIn) fade = Math.max(fade, 1 - clamp((t - s.fadeIn[0]) / (s.fadeIn[1] - s.fadeIn[0])));
  if (s.fadeOut) fade = Math.max(fade, clamp((t - s.fadeOut[0]) / (s.fadeOut[1] - s.fadeOut[0])));
  $('#fade').style.opacity = fade;
  $('#end').style.opacity = s.fadeOut ? clamp((t - s.fadeOut[0] - 0.2) / 0.7) : 0;
  renderer.render(scene, camera);
  // 字幕
  const sub = SUBS.find(([a, b]) => T >= a && T < b);
  const subEl = $('#sub');
  const txt = sub ? `<b>${sub[2]}</b>${sub[3]}` : '';
  if (subEl.dataset.k !== txt) { subEl.dataset.k = txt; subEl.innerHTML = txt; subEl.classList.toggle('on', !!sub); }
  // 胶片颗粒按格跳动
  $('#grain').style.backgroundPosition = `${(hash(step) * 200) | 0}px ${(hash(step + 9) * 200) | 0}px`;
}
window.__renderAt = (t) => { lastKey = null; renderAt(t); };

// ---------- 播放控制 ----------
const sound = new Sound(); sound.events = SFX;
let playing = false, playT = 0, wallStart = 0, tAtStart = 0;
let voiceOn = false; const spoken = new Set();
function now() { return playing ? tAtStart + (performance.now() - wallStart) / 1000 : playT; }
function play(from) {
  if (from !== undefined) playT = from;
  if (playT >= TOTAL - 0.05) playT = 0;
  tAtStart = playT; wallStart = performance.now(); playing = true;
  try { sound.start(playT); } catch (e) { }
  spoken.clear(); for (const s of SUBS) if (s[0] < playT) spoken.add(s);
  document.body.classList.add('playing'); $('#play').setAttribute('aria-label', '暂停');
}
function pause() {
  playT = now(); playing = false; sound.stop(); try { speechSynthesis.cancel(); } catch (e) { }
  document.body.classList.remove('playing'); $('#play').setAttribute('aria-label', '播放');
}
function seek(t) { const was = playing; if (was) pause(); playT = clamp(t, 0, TOTAL - 0.01); lastKey = null; renderAt(playT); if (was) play(); }

const VOICE = { '旁白': [1.0, 1.0], '阿圆': [1.15, 1.05], '点点': [1.35, 1.0], '小粒': [1.7, 1.1] };
function speak(sub) {
  try {
    const u = new SpeechSynthesisUtterance(sub[3]); u.lang = 'zh-CN';
    const vs = speechSynthesis.getVoices().filter((v) => /zh[-_]CN|普通话|Chinese/i.test(v.lang + v.name));
    if (vs.length) u.voice = vs[0];
    const [p, r] = VOICE[sub[2]] || [1, 1]; u.pitch = p; u.rate = r; speechSynthesis.speak(u);
  } catch (e) { }
}

function loop() {
  requestAnimationFrame(loop);
  if (!W) return;
  let t = now();
  if (playing && t >= TOTAL) { pause(); playT = TOTAL - 0.01; t = playT; document.body.classList.add('ended'); }
  renderAt(t);
  if (playing && voiceOn) for (const s of SUBS) if (!spoken.has(s) && t >= s[0]) { spoken.add(s); if (t < s[1]) speak(s); }
  // 进度条
  $('#bar i').style.width = (t / TOTAL * 100) + '%';
  $('#time').textContent = fmt(t) + ' / ' + fmt(TOTAL);
  const sh = shotAt(t); const lab = `镜头 ${sh.id} · ${sh.name}`; if ($('#shot').textContent !== lab) $('#shot').textContent = lab;
}
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---------- 界面 ----------
function buildUI() {
  const marks = $('#marks');
  marks.innerHTML = SHOTS.map((s) => `<button style="left:${s.start / TOTAL * 100}%" data-t="${s.start}" title="镜头 ${s.id} · ${s.name}"><span>${s.id}</span></button>`).join('');
  marks.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { seek(+b.dataset.t + 0.01); } });
  const bar = $('#bar');
  const scrub = (e) => { const r = bar.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * TOTAL); };
  bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); scrub(e); bar.onpointermove = scrub; });
  bar.addEventListener('pointerup', () => { bar.onpointermove = null; });
  $('#play').onclick = () => { document.body.classList.remove('ended'); playing ? pause() : play(); };
  $('#start').onclick = () => { $('#cover').classList.add('gone'); document.body.classList.add('started'); play(0); };
  $('#subs').onclick = (e) => { document.body.classList.toggle('nosub'); e.currentTarget.setAttribute('aria-pressed', !document.body.classList.contains('nosub')); };
  $('#voice').onclick = (e) => { voiceOn = !voiceOn; e.currentTarget.setAttribute('aria-pressed', voiceOn); if (!voiceOn) try { speechSynthesis.cancel(); } catch (x) { } };
  $('#music').onclick = (e) => { sound.musicOn = !sound.musicOn; e.currentTarget.setAttribute('aria-pressed', sound.musicOn); if (playing) { pause(); play(); } };
  $('#full').onclick = () => { try { document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen(); } catch (e) { } };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); if (!$('#cover').classList.contains('gone')) $('#start').click(); else $('#play').click(); }
    if (e.code === 'ArrowRight') seek(now() + 5); if (e.code === 'ArrowLeft') seek(now() - 5);
  });
  let idle; const wake = () => { document.body.classList.add('ui'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.remove('ui'), 2200); };
  stage.addEventListener('pointermove', wake); stage.addEventListener('pointerdown', wake);
  stage.addEventListener('click', (e) => { if (e.target === canvas || e.target.id === 'frame' || e.target.id === 'sub') $('#play').click(); });
}

// 颗粒贴图
(function grain() {
  const c = document.createElement('canvas'); c.width = c.height = 200; const g = c.getContext('2d'); const d = g.createImageData(200, 200);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); $('#grain').style.backgroundImage = `url(${c.toDataURL()})`;
})();

// ---------- 启动 ----------
(async function boot() {
  buildUI(); resize();
  try {
    await Promise.race([document.fonts.load('80px "ZCOOL KuaiLe"'), new Promise((r) => setTimeout(r, 2500))]);
  } catch (e) { }
  await loadAll(Object.keys(MANIFEST), (p) => { $('#load i').style.width = (p * 100) + '%'; $('#loadtxt').textContent = `正在铺纸片… ${Math.round(p * 100)}%`; });
  W = buildWorld(scene); window.__W = W; window.__THREE = THREE;
  W.drawTitle();
  // 预编译所有材质
  for (const s of SHOTS) { W.reset(); s.update(W, 1); }
  W.reset(); SHOTS[0].update(W, 0);
  renderer.compile(scene, camera);
  lastKey = null; renderAt(window.__CAPTURE__ ? 0 : 4.6);
  for (const k of Object.keys(MANIFEST)) { try { renderer.initTexture(tex(k)); } catch (e) { } }
  document.body.classList.add('ready');
  $('#start').disabled = false;
  $('#loadtxt').textContent = '准备好了';
  if (window.__CAPTURE__) { document.body.classList.add('capture'); window.__READY__ = true; return; }
  requestAnimationFrame(loop);
})();
