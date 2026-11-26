// 12 个镜头：每个镜头是 t(镜头内时间) 的纯函数，可任意跳转
import * as THREE from 'three';
import { kf, pick, clamp, lerp, smooth, easeIn, easeOut, easeInOut, backOut, jitter, between } from './engine.js';
import { BASIN, rimZ, waterZ, WATER_R } from './world.js';

const WL = BASIN.WL;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _e = new THREE.Euler(), _v = new THREE.Vector3();

// ---------- 摆位工具 ----------
let STEP = 0;
function put(o, x, y, z, o2 = {}) {
  o.visible = true; o.position.set(x, y, z);
  if (o2.rx !== undefined) o.rotation.x = o2.rx;
  if (o2.ry !== undefined) o.rotation.y = o2.ry;
  if (o2.rz !== undefined) o.rotation.z = o2.rz;
  const s = o2.s ?? 1; o.scale.set((o2.flip ? -1 : 1) * s * (o2.sx ?? 1), s * (o2.sy ?? 1), s);
  if (o2.op !== undefined) o.opacity = o2.op;
  return o;
}
// 角色：带定格手工误差
function actor(c, pose, x, y, z, o2 = {}) {
  c.setPose(pose);
  const id = c.id;
  const j = o2.still ? 0 : 1;
  put(c, x + jitter(STEP, id, 0.006) * j, y, z, Object.assign({}, o2, { rz: (o2.rz ?? 0) + jitter(STEP, id + 5, 0.012) * j }));
  return c;
}
// 走路：在两个姿态间交替，并带上下颠
function walkPose(t, a, b, rate = 4) { return Math.floor(t * rate) % 2 ? a : b; }
function hop(t, rate = 4, amp = 0.05) { return Math.abs(Math.sin(Math.floor(t * 12) / 12 * Math.PI * rate)) * amp; }

// 船：后片 + 船员 + 前片，整体绕锚点旋转
function boatRig(W, { x, y = WL, z, rx = 0, ry = 0, rz = 0, variant = 'boat_side', s = 1 }, crew = []) {
  W.boat.setPose(variant); W.boatFront.setPose(variant, W.boatFrontSrc[variant] || W.boatFrontSrc.boat_side);
  put(W.boat, x, y, z, { rx, ry, rz, s });
  _e.set(rx, ry, rz);
  const at = (dx, dy, dz) => _v.set(dx * s, dy * s, dz * s).applyEuler(_e).add(V(x, y, z)).clone();
  const pf = at(0, 0, 0.34); put(W.boatFront, pf.x, pf.y, pf.z, { rx, ry, rz, s });
  for (const m of crew) {
    const p = at(m.dx, 0.34 + (m.dy || 0), 0.17 + (m.dz || 0));
    actor(m.c, m.pose, p.x, p.y, p.z, { rx: rx + (m.rx || 0), ry, rz: rz + (m.rz || 0), flip: m.flip, s: m.s });
  }
  return at;
}
function podRig(W, { x, y = WL, z, ry = 0, rz = 0 }, rider) {
  put(W.pod, x, y, z, { ry, rz });
  _e.set(0, ry, rz);
  const at = (dx, dy, dz) => _v.set(dx, dy, dz).applyEuler(_e).add(V(x, y, z)).clone();
  const pf = at(0, 0, 0.26); put(W.podFront, pf.x, pf.y, pf.z, { ry, rz });
  if (rider) { const p = at(rider.dx || 0, rider.dy || 0, 0.13); actor(rider.c, rider.pose, p.x, p.y, p.z, { ry, rz: rz + (rider.rz || 0) }); }
}
// 水面浮动（定格步进）
const bob = (t, ph = 0, a = 0.035, f = 1.1) => Math.sin((t * f + ph) * Math.PI * 2) * a;
// 侧视波纹
function ripple(o, x, z, t0, t, dur = 1.6, w0 = 0.5, w1 = 2.4) {
  const k = (t - t0) / dur; if (k < 0 || k > 1) return;
  const w = lerp(w0, w1, easeOut(k)); put(o, x, WL + 0.01, z, { s: w, op: 1 - k });
}
function ringFlat(o, x, z, t0, t, dur = 1.8, r1 = 2.4) {
  const k = (t - t0) / dur; if (k < 0 || k > 1) return;
  put(o, x, WL + 0.02, z, { s: lerp(0.2, r1, easeOut(k)), op: (1 - k) * 0.9 });
}
function fade(o, t, a, b, c, d) { // 淡入 a-b，保持，c-d 淡出
  let op = 1; if (t < b) op = clamp((t - a) / (b - a)); if (t > c) op = 1 - clamp((t - c) / (d - c)); return op;
}
// 水滴落下：从 (x,y0,z) 到水面
function dropFall(W, x, y0, z, tHang0, tFall, t, { splashS = 1 } = {}) {
  if (t >= tHang0 && t < tFall) {
    const k = clamp((t - tHang0) / (tFall - tHang0));
    put(W.dropHang, x, y0, z, { s: lerp(0.35, 1.1, easeIn(k)), sy: 1 + Math.sin(t * 9) * 0.03 * k });
  }
  const fallDur = Math.sqrt(2 * (y0 - WL) / 30);
  if (t >= tFall && t < tFall + fallDur) {
    const k = (t - tFall) / fallDur; put(W.dropFall, x, y0 - 0.25 - (y0 - WL) * k * k, z, { s: 0.9 });
  }
  const tHit = tFall + fallDur;
  if (t >= tHit && t < tHit + 0.33) { const k = (t - tHit) / 0.33; put(W.splash, x, WL, z + 0.02, { s: splashS * lerp(0.5, 1, easeOut(k)), sy: splashS * (1 - k * k), op: 1 - k * 0.6 }); }
  return tHit;
}
// 沿木勺上表面的路径（图像坐标 → 世界坐标）
const SPOON_PATH = [[0.13, 0.46], [0.30, 0.38], [0.5, 0.30], [0.7, 0.22], [0.97, 0.07]];
function spoonPoint(W, u) {
  const sp = W.spoon; const [w, h] = sp.size; const ax = 0.55, ay = 0.42;
  const n = SPOON_PATH.length - 1, f = clamp(u) * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
  const px = lerp(SPOON_PATH[i][0], SPOON_PATH[i + 1][0], k), py = lerp(SPOON_PATH[i][1], SPOON_PATH[i + 1][1], k);
  const lx = (px - ax) * w, ly = (ay - py) * h;
  const c = Math.cos(sp.rotation.z), s = Math.sin(sp.rotation.z);
  return V(sp.position.x + lx * c - ly * s, sp.position.y + lx * s + ly * c, sp.position.z);
}
const SPOON_DOWN = 0.21, SPOON_DX = -0.45; // 木勺滑下后的角度与位移
function spoonDown(W) { W.spoon.position.x += SPOON_DX; W.spoon.rotation.z = SPOON_DOWN; }

// ---------- 镜头定义 ----------
// 每个镜头：dur, cam(t) -> {pos, look, fov}, shadow:{c:[x,y,z], r}, update(W,t)
export const SHOTS = [];
const shot = (o) => SHOTS.push(o);

// 01 厨房全景
shot({
  id: '01', name: '厨房全景', dur: 8,
  cam: (t) => ({ pos: kf(t, [[0, [0.6, 7.4, 28]], [3.0, [0.4, 7.2, 27]], [8, [-2.4, 5.4, 18.5]]], easeInOut), look: kf(t, [[0, [0, 3.4, -0.6]], [3.0, [-0.3, 3.4, -0.6]], [8, [-3.6, 2.8, -0.8]]], easeInOut), fov: 34 }),
  shadow: { c: [0, 2, 0], r: 16 },
  fadeIn: [0, 1.3],
  update(W, t) {
    put(W.towel, -13.4, 0, 3.6, { ry: 0.25 });
    W.title.material.opacity = fade(null, t, 2.2, 3.6, 9, 10) * 0.92;
    const peek = (t0) => kf(t, [[t0, 0.25], [t0 + 0.5, 1.05, backOut]]);
    actor(W.yuan, t > 3.2 && t < 5 ? 'yuan_laugh' : 'yuan_idle', -9.5, peek(1.0), 1.12);
    actor(W.dd, 'diandian_idle', -8.65, peek(1.5) - 0.05, 1.16);
    actor(W.li, t > 4 ? 'li_wave' : 'li_idle', -7.75, peek(2.0) + 0.05, 1.2);
    const hit = dropFall(W, -2.0, 4.62, -3.75, 4.2, 6.4, t);
    ringFlat(W.ringTop, -2.0, -3.75, hit, t, 1.6, 1.6);
    ripple(W.ripS1, -2.0, -3.7, hit, t, 1.6, 0.4, 2.0);
  },
});

// 02 盆沿近景：水珠与滑落
shot({
  id: '02', name: '盆沿近景', dur: 9,
  cam: (t) => ({ pos: kf(t, [[0, [-2.4, 4.2, 0.9]], [4.2, [-2.4, 4.15, 0.6]], [5.4, [-2.3, 4.2, 0.4]]]), look: kf(t, [[0, [-2.4, 3.7, -4.4]], [4.2, [-2.4, 3.65, -4.4]], [5.4, [-2.3, 2.6, -3.8]]]), fov: 38 }),
  shadow: { c: [-2, 3, -3.6], r: 5 },
  update(W, t) {
    const zr = (x) => rimZ(x) + 0.06, ry = BASIN.rimY + 0.07;
    // 阿圆、点点
    const lean = kf(t, [[4.5, 0], [5.0, 0.42]], easeOut);
    actor(W.yuan, t > 4.5 ? 'yuan_reach' : 'yuan_idle', -4.05, ry, zr(-4.05), { rx: lean, flip: t > 4.5 });
    actor(W.dd, t > 4.6 ? 'diandian_point' : 'diandian_idle', -3.25, ry, zr(-3.25), { rx: lean * 0.9, flip: t > 4.6 });
    // 小粒：踮脚 → 伸手 → 滑落
    const dropX = -2.0, dropZ = -3.75;
    if (t < 3.7) {
      const tip = t > 1.1 ? hop(t, 3, 0.07) : 0;
      actor(W.li, t > 2.1 ? 'li_reach' : 'li_idle', -1.3, ry + tip, zr(-1.3), { sy: 1 + tip * 0.6 });
    } else if (t < 4.35) {
      const k = (t - 3.7) / 0.65;
      const x = lerp(-1.3, -1.6, k), y = ry + 0.25 * Math.sin(k * Math.PI) - (ry - WL + 0.5) * k * k, z = lerp(zr(-1.3), -3.3, k);
      actor(W.li, 'li_slip', x, y + 0.37, z, { rz: lerp(0, 1.4, k) });
    }
    const hit = dropFall(W, dropX, 4.62, dropZ, 0.0, 3.55, t, { splashS: 0.8 });
    ripple(W.ripS1, dropX, dropZ, hit, t, 1.4, 0.3, 1.6);
    // 落水
    const T = 4.35;
    if (t >= T && t < T + 0.45) { const k = (t - T) / 0.45; put(W.splash2, -1.6, WL, -3.2, { s: lerp(0.6, 1.1, easeOut(k)), sy: 1.1 * (1 - k * k) }); put(W.spray, -1.5, WL + 0.1 + k * 0.6, -3.1, { s: 0.8, op: 1 - k }); }
    ripple(W.ripS2, -1.6, -3.2, T, t, 2.4, 0.6, 3.2);
    ripple(W.ripS3, -1.6, -3.2, T + 0.5, t, 2.4, 0.5, 2.6);
    if (t > T + 0.8 && t < T + 3.5) put(W.bubble, -1.6 + Math.sin(t * 3) * 0.1, WL + 0.08, -3.15, { s: 1 + 0.3 * Math.sin(t * 5) });
  },
});

// 03 贴水面：抱住豆荚
shot({
  id: '03', name: '贴水面', dur: 9,
  cam: (t) => ({ pos: kf(t, [[0, [-0.9, 2.3, 1.1]], [9, [-1.1, 2.25, 0.7]]]), look: [-1.4, 2.05, -2.4], fov: 40 }),
  shadow: { c: [-1.2, 2, -2], r: 5 },
  update(W, t) {
    const lx = -1.5, lz = -2.2;
    // 背景浪片
    put(W.waveA, kf(t, [[0, -4.2], [9, -3.4]], (x) => x), WL - 0.08 + bob(t, 0.2, 0.04), -4.0);
    put(W.waveC, kf(t, [[0, 2.2], [9, 1.2]], (x) => x), WL - 0.05 + bob(t, 0.5, 0.03), -4.4);
    put(W.waveD, kf(t, [[0, -3.0], [9, -2.2]], (x) => x), WL - 0.04 + bob(t, 0.8, 0.03), -0.9);
    // 豆荚漂过来
    const px = kf(t, [[0, 2.4], [3.0, lx + 0.25]], easeOut);
    const spin = kf(t, [[5.0, 0], [5.8, 0.9], [6.6, -0.5], [7.4, 0.25], [8.2, 0]]);
    const pzx = t > 5 ? kf(t, [[5, 0], [7.5, 0.35]]) : 0;
    if (t < 3.0) {
      // 小粒在水里扑腾
      actor(W.li, Math.floor(t * 6) % 2 ? 'li_reach' : 'li_cling', lx + bob(t, 0, 0.05, 2), WL - 0.38 + bob(t, 0.3, 0.06, 2), lz + 0.05);
      ripple(W.ripS1, lx, lz, 0.0, t, 1.5, 0.6, 2.4); ripple(W.ripS2, lx, lz, 0.9, t, 1.6, 0.6, 2.4); ripple(W.ripS4, lx, lz, 1.8, t, 1.4, 0.5, 2.0);
      put(W.bubbles, lx + 0.5, WL - 0.1 + (t % 1.5) * 0.15, lz + 0.1, { s: 0.8 });
      put(W.pod, px, WL + bob(t, 0.1), lz - 0.1, {});
      put(W.podFront, px, WL + bob(t, 0.1), lz + 0.16, {});
    } else {
      const grabUp = kf(t, [[3.0, -0.25], [3.4, -0.08]], backOut);
      podRig(W, { x: px + pzx, y: WL + bob(t, 0.1), z: lz - 0.1, ry: spin, rz: bob(t, 0.4, 0.05) }, { c: W.li, pose: t > 3.0 && t < 3.3 ? 'li_reach' : 'li_cling', dx: -0.2, dy: grabUp - 0.1 });
      if (t > 3.0 && t < 3.6) put(W.spray, lx, WL + 0.1, lz + 0.3, { s: 0.6, op: 1 - (t - 3) / 0.6 });
    }
    // 回水
    if (t > 4.6 && t < 7.6) put(W.wave62, kf(t, [[4.6, -4.2], [7.6, 1.8]], (x) => x), WL - 0.1, lz + 0.6, { s: 0.9 });
    if (t > 5) ripple(W.ripS3, px, lz, 5.2, t, 2, 1.0, 3.2);
  },
});

// 04 台面俯视：折船
shot({
  id: '04', name: '折纸船', dur: 10,
  cam: (t) => ({ pos: kf(t, [[0, [-12.1, 5.0, 8.6]], [10, [-12.0, 4.6, 8.1]]]), look: [-12.0, 0.55, 4.0], fov: 38 }),
  shadow: { c: [-12, 0.5, 4], r: 5 },
  update(W, t) {
    const cx = -12.0, cz = 4.2;
    put(W.towel, -16.2, 0, 2.6, { ry: 0.5 });
    const lean = -0.22;
    // 烘焙纸被拽进来
    const px = kf(t, [[0, -15.6], [1.6, cx]], easeOut);
    if (t < 3.2) put(W.paperFlat, px, 0.012, cz + 0.2, { rz: kf(t, [[0, 0.3], [1.6, 0.05]]) });
    // 阿圆：拽纸 → 蹲下折
    if (t < 1.6) actor(W.yuan, walkPose(t, 'yuan_walk', 'yuan_idle', 6), px - 1.9, hop(t, 3, 0.05), cz, { rx: lean });
    else actor(W.yuan, 'yuan_fold', cx - 1.9, 0, cz, { rx: lean });
    // 点点：从右边走来，压住纸角
    if (t < 2.4) actor(W.dd, walkPose(t, 'diandian_walk', 'diandian_idle', 6), kf(t, [[0.4, -8.6], [2.4, cx + 1.85]], easeOut), hop(t, 3, 0.05), cz, { rx: lean, flip: true });
    else if (t < 7.4) actor(W.dd, 'diandian_fold', cx + 1.85, 0, cz, { rx: lean, flip: true });
    else actor(W.dd, 'diandian_idle', cx + 1.85, 0, cz, { rx: lean });
    // 折纸：每一折一个弹跳
    const pop = (t0) => (t >= t0 && t < t0 + 0.5) ? 1 + 0.12 * Math.sin((t - t0) / 0.5 * Math.PI) : 1;
    if (t >= 3.2 && t < 4.9) put(W.paperTri, cx, 0, cz, { sx: 0.86, sy: kf(t, [[3.2, 0.2], [3.45, 1.0, backOut]]) * pop(3.2), rx: lean * 0.5 });
    if (t >= 4.9 && t < 6.6) put(W.paperHat, cx, 0, cz, { sx: 0.86, sy: kf(t, [[4.9, 0.6], [5.15, 1.0, backOut]]) * pop(4.9), rx: lean * 0.5 });
    if (t >= 6.6) {
      W.boat.setPose('boat_side'); const h = W.boat.size[1];
      put(W.boat, cx, h * 0.14 * 0.82, cz, { s: 0.82, sy: 0.82 * pop(6.6) * kf(t, [[6.6, 0.7], [6.85, 1, backOut]]), rx: lean * 0.5 });
    }
    // 木桨被推进船里
    if (t >= 7.4) {
      const k = kf(t, [[7.4, 0], [8.8, 1]], easeInOut);
      put(W.paddle, lerp(cx + 2.9, cx + 0.5, k), lerp(0.08, 0.95, k), cz + 0.25, { rz: lerp(-1.3, -0.35, k), s: 0.9 });
      actor(W.dd, 'diandian_point', cx + 1.85 + lerp(1.2, 0, k) * 0, 0, cz + 0.05, { rx: lean, flip: true });
    }
  },
});

// 05 低机位：滑道下水
shot({
  id: '05', name: '下水', dur: 9,
  cam: (t) => {
    const x = kf(t, [[0, -3.6], [2.6, -3.6], [5.4, -1.9], [9, -0.7]], easeInOut);
    return { pos: [x - 0.3, 3.45, 6.5], look: [x - 0.2, kf(t, [[0, 2.75], [3.2, 2.7], [4.6, 2.25]]), 0.9], fov: 46 };
  },
  shadow: { c: [-3, 2, 0.6], r: 5 },
  update(W, t) {
    const z = BASIN.cz;
    const top = V(-BASIN.rimR - 0.3, BASIN.rimY + 0.12, z), bot = V(-2.1, WL - 0.4, z);
    const dir = bot.clone().sub(top), len = dir.length(); dir.normalize();
    const ang = Math.atan2(dir.y, dir.x);
    W.board.visible = true; W.board.position.copy(top); W.board.rotation.set(0, 0, ang);
    const nrm = V(-dir.y, dir.x, 0);
    const onBoard = (s, h = 0.08) => top.clone().add(dir.clone().multiplyScalar(s)).add(nrm.clone().multiplyScalar(h));
    // 推船
    const sPush = kf(t, [[0, 1.95], [0.7, 2.1], [1.4, 2.25], [2.1, 2.4]], (x) => x < 0.5 ? 0 : 1);
    let crew = [];
    const s = t < 3.0 ? sPush : lerp(sPush, len + 0.1, easeIn(clamp((t - 3.0) / 1.15)));
    const inWater = t >= 4.15;
    if (!inWater) {
      const p = onBoard(s, 0.36);
      const jumped = t >= 2.4;
      if (jumped) {
        const k = clamp((t - 2.4) / 0.4);
        crew = [{ c: W.yuan, pose: 'yuan_idle', dx: 0.55, dy: 0.5 * Math.sin(k * Math.PI) }, { c: W.dd, pose: t > 2.9 && t < 3.6 ? 'diandian_point' : 'diandian_balance', dx: -0.55, dy: 0.4 * Math.sin(k * Math.PI) }];
      }
      boatRig(W, { x: p.x, y: p.y, z: z + 0.25, rz: ang }, jumped ? crew : []);
      if (!jumped) {
        const back = onBoard(s - 1.55, 0.08);
        actor(W.dd, walkPose(t, 'diandian_walk', 'diandian_idle', 5), back.x, back.y + hop(t, 3, 0.04), z + 0.35, { rz: ang * 0.3 });
        actor(W.yuan, walkPose(t + 0.1, 'yuan_walk', 'yuan_idle', 5), back.x - 0.5, back.y + hop(t, 3, 0.04) + 0.12, z + 0.15, { rz: ang * 0.3 });
      }
    } else {
      const k = t - 4.15;
      const x = bot.x + 0.6 + easeOut(clamp(k / 4.6)) * 2.6;
      const rz = kf(t, [[4.15, ang], [4.4, 0.22], [4.75, -0.08], [5.1, 0.04], [5.5, 0]]);
      const variant = t < 4.9 ? 'boat_rock' : 'boat_side';
      const row = t > 5.6;
      boatRig(W, { x, y: WL + bob(t, 0, 0.03) + kf(t, [[4.15, -0.12], [4.5, 0.04], [4.9, 0]]), z: z + 0.25, rz }, [
        { c: W.yuan, pose: row ? 'yuan_row' : 'yuan_idle', dx: 0.55 },
        { c: W.dd, pose: 'diandian_idle', dx: -0.6 },
      ]);
      if (k < 0.6) { const q = k / 0.6; put(W.splash2, bot.x + 0.9, WL, z + 0.6, { s: lerp(0.7, 1.2, q), sy: 1.2 * (1 - q * q) }); put(W.spray, bot.x + 1.8, WL + 0.2 + q * 0.5, z + 0.7, { s: 0.9, op: 1 - q }); }
      put(W.wake, x - 1.6, WL + 0.02, z + 0.5, { s: clamp(k / 1.2) * 0.9 + 0.1, op: 0.9 });
      if (row) {
        const st = Math.sin((t - 5.6) * Math.PI * 1.6);
        put(W.paddle, x + 1.05, WL + 0.55 + st * 0.08, z + 0.62, { rz: -0.9 + st * 0.35, s: 0.85 });
      }
      ripple(W.ripS1, bot.x + 0.9, z + 0.5, 4.15, t, 2, 0.8, 3.0);
    }
  },
});

// 06 搪瓷盆俯视：菜叶挡路
shot({
  id: '06', name: '菜叶挡路', dur: 10,
  cam: (t) => ({ pos: kf(t, [[0, [0.4, 17.8, 10.6]], [10, [0.3, 16.6, 9.6]]]), look: [0.0, 1.8, 0.3], fov: 33 }),
  shadow: { c: [0, 2, 0.8], r: 8 },
  update(W, t) {
    const up = -0.95; // 小人朝镜头后仰
    // 船
    let bx = kf(t, [[0, -3.7], [3.2, -1.9], [5.0, -1.6], [6, -1.9], [9, -2.0]]);
    let bz = kf(t, [[0, 2.0], [3.2, 1.5], [6, 1.6], [9, 1.7]]);
    let br = kf(t, [[0, 0.1], [3.2, -0.05], [5.0, 0.15], [6.0, 0.4], [8.6, 0.4 + Math.PI * 1.1]], easeInOut);
    put(W.boatTop, bx, WL + 0.02, bz, { rz: br, s: 0.9 });
    const c = Math.cos(br), s = Math.sin(br);
    const crew = [[W.yuan2, 'yuan_row', 0.55], [W.dd2, t > 5 && t < 8 ? 'diandian_point' : 'diandian_idle', -0.6]];
    for (const [ch, pose, d] of crew) actor(ch, pose, bx + c * d, WL + 0.1, bz - s * d + 0.05, { rx: up, s: 0.95 });
    // 木桨
    const st = Math.sin(t * Math.PI * 1.6);
    if (t < 6) put(W.paddle, bx + c * 0.9 + 0.1, WL + 0.3, bz + 0.65 + st * 0.15, { rx: up, rz: -0.8 + st * 0.3, s: 0.8 });
    put(W.eddy, bx - c * 1.6, WL + 0.03, bz + s * 1.6, { rz: -t * 1.2, s: 0.7, op: 0.85 });
    // 菜叶：慢慢横过来
    const lx = kf(t, [[0, 1.8], [4, 0.4], [6, -0.1], [10, -0.3]]), lz = kf(t, [[0, -1.2], [5, 0.5], [10, 0.8]]);
    const lr = kf(t, [[0, -1.0], [4.5, 0.25], [5.6, 1.1], [7, 1.3], [10, 1.5]]);
    put(W.leafTop, lx, WL + 0.04, lz, { rz: lr });
    put(W.eddy2, lx + 0.8, WL + 0.03, lz - 0.9, { rz: t * 0.8, s: 0.8, op: 0.7 });
    // 豆荚和小粒
    const px = 3.2 + bob(t, 0.3, 0.12, 0.4), pz = -1.6;
    put(W.podTop, px, WL + 0.02, pz, { rz: 0.4 + bob(t, 0, 0.15, 0.3), s: 0.95 });
    actor(W.li2, 'li_cling', px - 0.1, WL + 0.05, pz + 0.2, { rx: up, s: 0.95 });
    ringFlat(W.ringTop, px, pz, 1.0, t % 3.3 + 1.0, 2.2, 2.4);
    ringFlat(W.ringTop2, bx - 1.3, bz, 0.2, (t % 2.4) + 0.2, 1.8, 1.8);
  },
});

// 07 豆荚和菜叶同框：发现叶尖缺口
shot({
  id: '07', name: '叶尖水路', dur: 10,
  cam: (t) => ({ pos: kf(t, [[0, [0.6, 2.5, 4.9]], [10, [0.3, 2.45, 4.5]]]), look: [0.2, 2.42, -1.2], fov: 42 }),
  shadow: { c: [0, 2, -0.6], r: 6 },
  update(W, t) {
    put(W.waveC, kf(t, [[0, -2.6], [10, -1.6]], (x) => x), WL - 0.05 + bob(t, 0.2, 0.03), -3.8);
    put(W.waveA, kf(t, [[0, 2.6], [10, 1.8]], (x) => x), WL - 0.08 + bob(t, 0.6, 0.03), -3.4);
    // 菜叶：叶尖（左端）摆开
    const swing = kf(t, [[0, 0], [1.0, -0.35], [2.0, 0.05], [3.0, -0.45], [6.5, -0.55], [8.2, -0.35], [8.6, -0.25], [10, -0.3]]);
    put(W.leaf, 0.7, WL + bob(t, 0, 0.03), -1.3, { ry: swing, s: 1.0 });
    // 豆荚 + 小粒（前景右）
    const slap = (t >= 2.4 && t < 2.8) ? -0.06 : 0;
    podRig(W, { x: 2.5, y: WL + bob(t, 0.4, 0.04) + slap, z: 0.9, ry: -0.15, rz: bob(t, 0.1, 0.04) }, { c: W.li, pose: t > 2.4 ? 'li_reach' : 'li_cling', dx: -0.3, dy: t > 2.4 ? 0.02 : -0.1 });
    // 纸船：先在左后方，转向后斜着钻过叶尖
    const bx = kf(t, [[0, -2.5], [6.0, -2.4], [7.0, -2.2], [9.6, 0.3]], easeInOut);
    const bz = kf(t, [[0, -2.3], [6.0, -2.3], [7.0, -1.9], [9.6, -0.1]], easeInOut);
    const bry = kf(t, [[0, 0], [6.0, 0], [6.8, -0.75], [8.4, -0.5], [9.6, -0.15]]);
    const bow = t > 6.3 && t < 7.2;
    const ddRow = t > 5.3;
    const yuanRow = t < 4.8;
    boatRig(W, { x: bx, y: WL + bob(t, 0.7, 0.03), z: bz, ry: bry, rz: bob(t, 0.2, 0.03), variant: bow ? 'boat_bow' : 'boat_side', s: 0.95 }, bow ? [] : [
      { c: W.yuan, pose: yuanRow ? 'yuan_row' : 'yuan_idle', dx: 0.55 },
      { c: W.dd, pose: ddRow ? 'diandian_row' : (t > 4.7 ? 'diandian_point' : 'diandian_idle'), dx: -0.6 },
    ]);
    if (bow) { // 船头朝镜头时只画船，船员换成在船后露头
      actor(W.yuan, 'yuan_idle', bx + 0.35, WL + 0.55, bz - 0.2, { s: 0.9 }); actor(W.dd, 'diandian_row', bx - 0.35, WL + 0.5, bz - 0.25, { s: 0.9 });
    }
    // 木桨在两人间传递
    const pOwner = t < 4.8 ? 'yuan' : (t < 5.3 ? 'pass' : 'dd');
    if (!bow) {
      const st = Math.sin(t * Math.PI * 1.8);
      const _bx = bx, py = WL + 0.6;
      if (pOwner === 'yuan') put(W.paddle, _bx + 1.0, py + st * 0.06, bz + 0.55, { rz: -0.9 + st * 0.3, ry: bry, s: 0.8 });
      else if (pOwner === 'pass') put(W.paddle, _bx, py + 0.45, bz + 0.5, { rz: 0.2, ry: bry, s: 0.8 });
      else put(W.paddle, _bx - 1.15, py + st * 0.06, bz + 0.55, { rz: 0.9 + st * 0.3, ry: bry, s: 0.8, flip: true });
    }
    if (t > 6.8) put(W.wake, bx - 1.3, WL + 0.02, bz + 0.2, { ry: bry, s: 0.8, op: 0.8 });
    if (t > 8.2 && t < 8.9) put(W.spray, bx + 1.2, WL + 0.2, bz + 0.3, { s: 0.6, op: 0.8 });
  },
});

// 08 船边近景：救起小粒
shot({
  id: '08', name: '伸手救援', dur: 11,
  cam: (t) => ({ pos: kf(t, [[0, [0.8, 2.6, 4.2]], [11, [0.9, 2.5, 3.5]]]), look: [0.9, 2.15, -0.5], fov: 40 }),
  shadow: { c: [0.8, 2, -0.4], r: 5 },
  update(W, t) {
    put(W.waveC, kf(t, [[0, -2.0], [11, -1.0]], (x) => x), WL - 0.05 + bob(t, 0.2, 0.03), -3.6);
    put(W.waveA, kf(t, [[0, 3.2], [11, 2.4]], (x) => x), WL - 0.08 + bob(t, 0.6, 0.03), -3.0);
    put(W.leaf, kf(t, [[0, -1.5], [11, -2.4]]), WL + bob(t, 0, 0.02), -3.2, { s: 0.8, ry: -0.3 });
    const bx = kf(t, [[0, -1.6], [2.0, -0.05]], easeOut);
    const rock = t > 6.7 ? Math.sin((t - 6.7) * 7) * 0.12 * Math.exp(-(t - 6.7) * 1.4) : 0;
    const pull = t > 5.6;
    const liIn = t >= 6.7;
    const crew = [
      { c: W.yuan, pose: t < 2.0 ? 'yuan_idle' : (pull && t < 7.4 ? 'yuan_pull' : (t < 5.6 ? 'yuan_reach' : 'yuan_laugh')), dx: t < 2.0 ? 0.5 : 0.75, rx: t >= 2 && t < 5.6 ? 0.15 : 0 },
      { c: W.dd, pose: t < 7.4 ? 'diandian_balance' : 'diandian_laugh', dx: -0.85 },
    ];
    if (liIn) crew.push({ c: W.li, pose: 'li_sit', dx: 0.0, dy: -0.06, dz: -0.03 });
    boatRig(W, { x: bx, y: WL + bob(t, 0.5, 0.03) + (t > 6.7 && t < 7.0 ? -0.06 : 0), z: -0.7, rz: rock + bob(t, 0.2, 0.02) }, crew);
    // 豆荚
    const pX = kf(t, [[0, 2.55], [6.7, 2.45], [11, 4.6]], easeIn);
    const pZ = kf(t, [[6.7, -0.45], [11, -1.4]]);
    if (!liIn && t < 5.6) {
      podRig(W, { x: pX, y: WL + bob(t, 0.1), z: pZ, rz: bob(t, 0.3, 0.04) }, { c: W.li, pose: t < 3.6 ? 'li_cling' : 'li_reach', dx: -0.45, dy: t < 3.6 ? -0.12 : 0.0 });
    } else {
      podRig(W, { x: pX, y: WL + bob(t, 0.1), z: pZ, rz: bob(t, 0.3, 0.04) + (t < 6.2 ? 0.1 : 0) }, null);
      if (!liIn) { // 被拉起的弧线
        const k = clamp((t - 5.6) / 1.1);
        const x = lerp(pX - 0.45, bx, easeInOut(k)), y = lerp(WL + 0.0, WL + 0.3, k) + Math.sin(k * Math.PI) * 0.75;
        actor(W.li, k < 0.6 ? 'li_reach' : 'li_sit', x, y, -0.45, { rz: Math.sin(k * Math.PI) * 0.4 });
        put(W.spray2, x + 0.2, y - 0.1, -0.2, { s: 0.8, op: 1 - k });
      }
    }
    if (t > 5.6 && t < 6.2) put(W.spray, pX - 0.6, WL + 0.1, pZ + 0.4, { s: 0.7, op: 1 - (t - 5.6) / 0.6 });
    ripple(W.ripS1, pX - 0.4, pZ + 0.1, 5.7, t, 2.2, 0.6, 2.6);
    ripple(W.ripS2, bx, -0.4, 6.75, t, 2.0, 1.2, 3.6);
    if (t > 7 && t < 10) put(W.bubble, pX - 0.6, WL + 0.06 + ((t - 7) % 1) * 0.1, pZ + 0.4, { s: 1.0 });
  },
});

// 09 木勺和盆沿近景：回浪、叶梗碰勺
shot({
  id: '09', name: '木勺滑下', dur: 11,
  cam: (t) => ({ pos: kf(t, [[0, [1.7, 4.3, 7.3]], [11, [2.1, 4.1, 6.7]]]), look: [4.1, 1.9, 0.9], fov: 44 }),
  shadow: { c: [5, 2, 1], r: 7 },
  update(W, t) {
    // 回浪
    if (t < 3.6) put(W.wave62, kf(t, [[0, 6.0], [3.6, 0.6]], (x) => x), WL - 0.06, 1.6, { s: 1.0, flip: true });
    // 船被推偏（带三颗豆）
    const bx = kf(t, [[0, 0.2], [2.2, 1.0], [3.8, 0.7], [11, 1.2]]), bz = 1.8;
    const rz = kf(t, [[0, 0], [1.4, -0.16], [2.4, 0.1], [3.4, -0.04], [4.0, 0]]) + bob(t, 0.3, 0.02);
    boatRig(W, { x: bx, y: WL + bob(t, 0.1, 0.03), z: bz, rz, s: 0.9 }, [
      { c: W.yuan, pose: t > 6.2 ? 'yuan_idle' : 'yuan_row', dx: 0.6 },
      { c: W.li, pose: 'li_sit', dx: 0.0, dy: -0.06 },
      { c: W.dd, pose: t > 6.2 ? 'diandian_point' : 'diandian_balance', dx: -0.75 },
    ]);
    // 菜叶被顶过来，叶梗翘起碰勺
    const lx = kf(t, [[0, -1.0], [3.6, 0.3], [11, 0.5]]);
    put(W.leaf, lx, WL + bob(t, 0, 0.02), 0.25, { s: 0.9 });
    const stemX = lx + 2.15;
    const sr = kf(t, [[2.4, -0.25], [4.1, 0.55], [4.4, 0.42], [5.0, 0.3]], easeInOut);
    put(W.stem, stemX, WL + 0.06, 0.95, { rz: sr, s: 0.95 });
    // 木勺
    const kick = (t > 4.3 && t < 4.6) ? 0.04 : 0;
    const fall = clamp((t - 4.9) / 1.15);
    W.spoon.position.x += SPOON_DX * easeIn(fall);
    W.spoon.rotation.z = lerp(-0.09, SPOON_DOWN, easeIn(fall)) + kick + (t > 6.05 && t < 6.4 ? 0.03 : 0);
    const head = spoonPoint(W, 0.05);
    if (t >= 6.05 && t < 6.5) { const k = (t - 6.05) / 0.45; put(W.splash2, head.x, WL, head.z + 0.2, { s: lerp(0.6, 1.0, k), sy: 1 - k * k }); put(W.spray, head.x + 0.2, WL + 0.2 + k * 0.4, head.z + 0.3, { s: 0.7, op: 1 - k }); }
    ripple(W.ripS1, head.x, head.z + 0.1, 6.05, t, 2.2, 0.6, 2.8);
    ripple(W.ripS2, head.x, head.z + 0.1, 6.6, t, 2.2, 0.5, 2.2);
  },
});

// 10 俯视 → 水面近景：靠上勺头
shot({
  id: '10', name: '往勺头划', dur: 12,
  cam: (t) => t < 5
    ? { pos: kf(t, [[0, [2.6, 13.6, 7.8]], [5, [2.8, 12.8, 7.2]]]), look: [3.0, 1.8, 0.9], fov: 38 }
    : { pos: kf(t, [[5, [1.9, 3.8, 6.6]], [12, [2.4, 3.6, 5.8]]]), look: [3.0, 1.95, 1.0], fov: 42 },
  shadow: { c: [3, 2, 1], r: 7 },
  update(W, t) {
    spoonDown(W);
    if (t < 5) {
      W.spoon.visible = false;
      put(W.spoonTop, W.spoon.position.x, BASIN.rimY + 0.06, BASIN.cz, {});
      const up = -1.0;
      const bx = kf(t, [[0, 0.0], [2.0, 0.6], [5, 1.4]]), bz = kf(t, [[0, 2.6], [5, 1.9]]);
      const br = kf(t, [[0, -0.35], [1.6, -0.35], [3.2, 0.25], [5, 0.15]], easeInOut);
      put(W.boatTop, bx, WL + 0.02, bz, { rz: br, s: 0.9 });
      const c = Math.cos(br), s = Math.sin(br);
      for (const [ch, pose, d] of [[W.yuan2, 'yuan_idle', 0.6], [W.li2, 'li_sit', 0.0], [W.dd2, t > 0.6 ? 'diandian_point' : 'diandian_idle', -0.7]])
        actor(ch, pose, bx + c * d, WL + 0.1, bz - s * d + 0.05, { rx: up, s: 0.95 });
      const st = Math.sin(t * Math.PI * 1.8);
      put(W.paddle, bx - c * 1.0, WL + 0.3, bz + 0.6 + st * 0.12, { rx: up, rz: 0.8 + st * 0.3, s: 0.8, flip: true });
      ringFlat(W.ringTop, bx - 1.2, bz + 0.2, 0, t % 2 , 1.8, 1.6);
      put(W.leafTop, -2.6, WL + 0.03, -0.6, { rz: 1.4 });
    } else {
      const k = t - 5;
      const bx = kf(t, [[5, 0.6], [9.0, 2.45]], easeOut);
      const sink = kf(t, [[9.0, 0], [9.3, -0.16], [9.7, -0.1]]);
      const rz = kf(t, [[9.0, 0], [9.3, 0.08], [9.8, 0.05]]) + bob(t, 0.2, 0.02) * (t < 9 ? 1 : 0.3);
      const st = Math.sin(t * Math.PI * 1.8);
      boatRig(W, { x: bx, y: WL + sink + (t < 9 ? bob(t, 0.5, 0.03) : 0), z: 1.45, rz, variant: t > 7.2 ? 'boat_wet' : 'boat_side', s: 0.9 }, [
        { c: W.yuan, pose: t < 9.2 ? 'yuan_reach' : 'yuan_laugh', dx: 0.62, rx: t < 9.2 ? 0.1 : 0 },
        { c: W.li, pose: 'li_sit', dx: 0.0, dy: -0.06 },
        { c: W.dd, pose: t < 9.0 ? 'diandian_row' : 'diandian_idle', dx: -0.75 },
      ]);
      if (t < 9.0) put(W.paddle, bx - 1.15, WL + 0.5 + st * 0.06, 2.0, { rz: 0.9 + st * 0.3, s: 0.75, flip: true });
      if (t < 9.0) put(W.wake, bx - 1.4, WL + 0.02, 1.9, { s: 0.8, op: 0.8 });
      ripple(W.ripS1, bx + 1.2, 1.6, 9.0, t, 2.0, 0.8, 2.6);
      put(W.leaf, -1.6, WL + bob(t, 0, 0.02), -0.6, { s: 0.85 });
    }
  },
});

// 11 勺柄侧面：上岸
shot({
  id: '11', name: '走上木勺', dur: 11,
  cam: (t) => t < 5.6
    ? { pos: kf(t, [[0, [2.7, 3.9, 6.0]], [5.6, [3.4, 4.0, 6.1]]]), look: kf(t, [[0, [3.9, 2.3, 0.9]], [5.6, [4.8, 2.6, 0.9]]]), fov: 40 }
    : { pos: kf(t, [[5.6, [12.2, 3.0, 8.2]], [11, [11.6, 2.8, 7.4]]]), look: [7.2, 1.9, 1.2], fov: 40 },
  shadow: { c: [6, 2, 1], r: 7 },
  update(W, t) {
    spoonDown(W);
    // 靠在勺头的湿纸船
    boatRig(W, { x: 2.45, y: WL - 0.1, z: 1.45, rz: 0.05, variant: 'boat_wet', s: 0.9 }, []);
    // 路径参数：0=勺头, ~0.45=盆沿, 1=勺柄末端
    const walkers = [
      { c: W.dd, t0: 0.2, t1: 6.8, a: 'diandian_walk', b: 'diandian_idle', hopT: 7.6, land: [8.0, 0.3, 1.52] },
      { c: W.li, t0: 1.5, t1: 7.6, a: 'li_idle', b: 'li_wave', hopT: 8.4, land: [8.75, 0.3, 1.54] },
      { c: W.yuan, t0: 2.6, t1: 8.4, a: 'yuan_walk', b: 'yuan_idle', hopT: 9.2, land: [9.45, 0.3, 1.56] },
    ];
    const zOff = [0.16, 0.2, 0.24];
    walkers.forEach((w, i) => {
      const startP = V(2.45 + 0.6 - i * 0.6, WL + 0.3, 1.62);
      if (t < w.t0) { actor(w.c, w.b, startP.x, startP.y, startP.z); return; }
      if (t < w.t1) {
        // 先跨上勺头，再沿勺子往上
        const k = clamp((t - w.t0) / (w.t1 - w.t0));
        const u = lerp(0.04, 0.96, k);
        const p = spoonPoint(W, u);
        const step = k < 0.08 ? k / 0.08 : 1;
        const x = lerp(startP.x, p.x, step), y = lerp(startP.y, p.y, step) + hop(t, 4, 0.06), z = lerp(startP.z, p.z + zOff[i], step);
        let pose = walkPose(t + i * 0.13, w.a, w.b, 5);
        let rz = 0;
        if (w.c === W.li) rz = Math.sin(t * 5) * 0.13; // 小粒摇摇晃晃
        if (w.c === W.dd && t > 1.0 && t < 3.6) { pose = 'diandian_balance'; }
        actor(w.c, pose, x, y, z, { rz });
        return;
      }
      const end = spoonPoint(W, 0.96); end.z += zOff[i];
      if (t < w.hopT) { actor(w.c, w.b, end.x, end.y, end.z); return; }
      const k = clamp((t - w.hopT) / 0.55);
      if (k < 1) {
        const x = lerp(end.x, w.land[0], k), y = lerp(end.y, w.land[1], k) + Math.sin(k * Math.PI) * 0.6, z = lerp(end.z, w.land[2], k);
        actor(w.c, w.c === W.li ? 'li_slip' : w.a, x, y, z);
      } else {
        const sq = t - w.hopT - 0.55 < 0.2 ? 0.88 : 1;
        let pose = w.c === W.li ? (t > 10.0 && t < 10.6 ? 'li_idle' : 'li_wave') : w.b;
        actor(w.c, pose, w.land[0], w.land[1], w.land[2], { sy: sq * (w.c === W.li && t > 10.0 && t < 10.5 ? 0.93 : 1) });
      }
    });
  },
});

// 12 厨房宽景：结尾
shot({
  id: '12', name: '结尾', dur: 10,
  cam: (t) => ({ pos: kf(t, [[0, [5.8, 4.4, 15.5]], [3.2, [5.4, 4.6, 16.5]], [10, [0.6, 7.4, 28]]], easeInOut), look: kf(t, [[0, [6.4, 1.8, 1]], [3.2, [6.2, 2.0, 1]], [10, [0, 3.4, -0.6]]], easeInOut), fov: 34 }),
  shadow: { c: [3, 2, 0], r: 15 },
  fadeOut: [8.6, 10],
  update(W, t) {
    spoonDown(W);
    put(W.towel, -13.4, 0, 3.6, { ry: 0.25 });
    const rock = t > 2.55 ? Math.sin((t - 2.55) * 6) * 0.1 * Math.exp(-(t - 2.55) * 1.2) : 0;
    boatRig(W, { x: 2.45, y: WL - 0.1, z: 1.45, rz: 0.05 + rock, variant: 'boat_wet', s: 0.9 }, []);
    const hit = dropFall(W, -2.0, 4.62, -3.0, 0.3, 2.2, t);
    ringFlat(W.ringTop, -2.0, -3.0, hit, t, 2.2, 3.4);
    ringFlat(W.ringTop2, -2.0, -3.0, hit + 0.5, t, 2.2, 2.6);
    actor(W.yuan, t > 3.5 && t < 5.2 ? 'yuan_idle' : 'yuan_laugh', 7.75, 0.28, 1.52);
    actor(W.li, t > 5.3 ? 'li_wave' : 'li_sit', 8.5, 0.3 + (t > 5.3 && t < 5.6 ? 0.08 : 0), 1.54, { flip: t > 2.6 && t < 5.3 });
    actor(W.dd, 'diandian_laugh', 9.3, 0.28, 1.56);
  },
});

let acc = 0; for (const s of SHOTS) { s.start = acc; acc += s.dur; }
export const TOTAL = acc;
export function shotAt(t) { for (const s of SHOTS) if (t < s.start + s.dur) return s; return SHOTS[SHOTS.length - 1]; }
export function setStep(n) { STEP = n; }

// 字幕
export const SUBS = [
  [0.8, 5.6, '旁白', '对三颗豌豆来说，一盆水就有大海那么大。'],
  [9.0, 11.7, '小粒', '那颗水珠好大——'],
  [12.8, 14.6, '阿圆', '小粒！'],
  [20.4, 24.4, '小粒', '我在这儿！它一直在转！'],
  [26.5, 29.4, '阿圆', '我来。我们折条船！'],
  [36.6, 39.0, '点点', '一、二——走！'],
  [50.2, 52.8, '点点', '路被挡住了！'],
  [57.5, 59.6, '小粒', '从叶尖那头过！'],
  [59.8, 61.3, '点点', '给我桨！'],
  [67.2, 68.8, '阿圆', '抓住我！'],
  [69.0, 70.6, '小粒', '抓住啦！'],
  [87.8, 90.0, '点点', '往勺头划！'],
  [100.2, 102.6, '点点', '慢一点，我扶着你。'],
  [113.6, 115.2, '阿圆', '下次谁来划？'],
  [115.4, 116.6, '小粒', '我来！'],
  [116.8, 118.6, '点点', '好，你坐中间划。'],
];
