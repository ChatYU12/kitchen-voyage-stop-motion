// 程序合成的音效与配乐（WebAudio），按时间线调度，支持暂停与跳转
export class Sound {
  constructor() { this.ctx = null; this.session = null; this.events = []; this.musicOn = true; }
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const n = this.ctx.sampleRate * 2; const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
      // 简单混响
      const len = this.ctx.sampleRate * 1.6; const ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const x = ir.getChannelData(c); for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      this.ir = ir;
    }
    return this.ctx;
  }
  // 从时间线 t 开始播放
  start(t0) {
    const ctx = this.ensure(); ctx.resume();
    this.stop();
    const s = { out: ctx.createGain(), nodes: [] };
    s.out.gain.value = 0.9; s.out.connect(ctx.destination);
    s.rev = ctx.createConvolver(); s.rev.buffer = this.ir; s.revG = ctx.createGain(); s.revG.gain.value = 0.25; s.rev.connect(s.revG); s.revG.connect(s.out);
    s.base = ctx.currentTime + 0.05 - t0; // 时间线 t 对应 ctx 时间 base + t
    this.session = s;
    for (const [t, fn, ...args] of this.events) if (t >= t0 - 0.05) { try { this[fn](s, s.base + t, ...args); } catch (e) { } }
    this.ambience(s, t0);
    if (this.musicOn) this.music(s, t0);
  }
  stop() {
    if (!this.session) return;
    const s = this.session; this.session = null;
    const now = this.ctx.currentTime; s.out.gain.setTargetAtTime(0, now, 0.03);
    setTimeout(() => { try { s.out.disconnect(); } catch (e) { } for (const n of s.nodes) try { n.stop(); } catch (e) { } }, 300);
  }
  // ---------- 基础构件 ----------
  _env(s, at, a, d, peak = 1, dest) {
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + a + d);
    g.connect(dest || s.out); return g;
  }
  _noise(s, at, dur, filterType, freq, q = 1, peak = 0.5, a = 0.005, wet = 0.2) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(freq, at); f.Q.value = q;
    const g = this._env(s, at, a, dur, peak);
    src.connect(f); f.connect(g); if (wet) { const w = this.ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(s.rev); }
    src.start(at, Math.random()); src.stop(at + a + dur + 0.05); s.nodes.push(src);
    return f;
  }
  _tone(s, at, freq, dur, type = 'sine', peak = 0.3, a = 0.004, glideTo = null, wet = 0.3) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, at);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + dur * 0.8);
    const g = this._env(s, at, a, dur, peak); o.connect(g);
    if (wet) { const w = this.ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(s.rev); }
    o.start(at); o.stop(at + a + dur + 0.05); s.nodes.push(o); return o;
  }
  // ---------- 音效 ----------
  drip(s, at, vol = 1) { this._tone(s, at, 1500, 0.09, 'sine', 0.35 * vol, 0.002, 520, 0.5); this._tone(s, at + 0.012, 2600, 0.05, 'sine', 0.1 * vol, 0.001, 1400, 0.4); }
  plop(s, at, vol = 1) { this._tone(s, at, 420, 0.22, 'sine', 0.5 * vol, 0.003, 120, 0.3); this._noise(s, at, 0.35, 'lowpass', 1400, 0.7, 0.35 * vol, 0.004, 0.4); for (let i = 0; i < 4; i++) this._tone(s, at + 0.12 + i * 0.07 + Math.random() * 0.04, 700 + Math.random() * 900, 0.05, 'sine', 0.08 * vol, 0.002, 1800, 0.3); }
  splash(s, at, vol = 1) { const f = this._noise(s, at, 0.7, 'bandpass', 2400, 0.6, 0.5 * vol, 0.01, 0.35); f.frequency.exponentialRampToValueAtTime(600, at + 0.6); this._tone(s, at, 180, 0.25, 'sine', 0.35 * vol, 0.005, 70, 0.1); }
  bubble(s, at, n = 5, vol = 1) { for (let i = 0; i < n; i++) { const t = at + i * (0.09 + Math.random() * 0.12); const f = 500 + Math.random() * 900; this._tone(s, t, f, 0.06, 'sine', 0.09 * vol, 0.003, f * 2.2, 0.4); } }
  fold(s, at, vol = 1) { const f = this._noise(s, at, 0.16, 'highpass', 2500, 0.8, 0.35 * vol, 0.003, 0.15); this._noise(s, at + 0.03, 0.08, 'bandpass', 5200, 2, 0.25 * vol, 0.002, 0.1); }
  crisp(s, at) { this._noise(s, at, 0.1, 'highpass', 3800, 1.2, 0.55, 0.001, 0.25); this._tone(s, at, 3200, 0.03, 'triangle', 0.08, 0.001, null, 0.2); }
  scrape(s, at, dur = 0.25, vol = 1) { const f = this._noise(s, at, dur, 'bandpass', 900, 4, 0.22 * vol, 0.02, 0.15); f.frequency.linearRampToValueAtTime(1500, at + dur); }
  whoosh(s, at, dur = 0.8, vol = 1) { const f = this._noise(s, at, dur, 'bandpass', 600, 0.8, 0.4 * vol, dur * 0.35, 0.4); f.frequency.exponentialRampToValueAtTime(2600, at + dur); }
  stroke(s, at, vol = 1) { const f = this._noise(s, at, 0.32, 'lowpass', 900, 0.7, 0.28 * vol, 0.06, 0.3); f.frequency.linearRampToValueAtTime(400, at + 0.3); }
  step(s, at, vol = 1) { this._tone(s, at, 180 + Math.random() * 60, 0.05, 'sine', 0.12 * vol, 0.002, 90, 0.05); this._noise(s, at, 0.03, 'bandpass', 1800, 2, 0.05 * vol, 0.001, 0); }
  thump(s, at, vol = 1) { this._tone(s, at, 140, 0.16, 'sine', 0.4 * vol, 0.003, 60, 0.1); this._noise(s, at, 0.05, 'lowpass', 900, 1, 0.12 * vol, 0.002, 0.05); }
  enamel(s, at, vol = 1) { [1, 2.76, 5.4, 8.93].forEach((m, i) => this._tone(s, at, 820 * m, 0.9 / (i + 1), 'sine', 0.12 * vol / (i + 1), 0.002, null, 0.5)); }
  creak(s, at, dur = 0.9) {
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, at); o.frequency.linearRampToValueAtTime(55, at + dur);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 18; const lg = this.ctx.createGain(); lg.gain.value = 25; lfo.connect(lg); lg.connect(o.frequency);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 3;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.12, at + 0.05); g.gain.setValueAtTime(0.12, at + dur - 0.1); g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(f); f.connect(g); g.connect(s.out); o.start(at); o.stop(at + dur); lfo.start(at); lfo.stop(at + dur); s.nodes.push(o, lfo);
  }
  knock(s, at) { this._tone(s, at, 520, 0.12, 'triangle', 0.25, 0.002, 300, 0.3); this._noise(s, at, 0.04, 'bandpass', 1500, 3, 0.2, 0.001, 0.2); }
  touch(s, at) { this._tone(s, at, 260, 0.1, 'triangle', 0.2, 0.003, 180, 0.2); this._noise(s, at, 0.08, 'lowpass', 800, 1, 0.15, 0.004, 0.1); }
  giggle(s, at, base = 600) { for (let i = 0; i < 5; i++) this._tone(s, at + i * 0.09, base * (1 + (i % 2) * 0.12), 0.07, 'triangle', 0.05, 0.005, base * 0.9, 0.3); }
  // 环境水声：按镜头调整
  ambience(s, t0) {
    const ctx = this.ctx; const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; const g = ctx.createGain(); g.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.25; const lg = ctx.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(f.frequency);
    src.connect(f); f.connect(g); g.connect(s.out); src.start(); lfo.start(); s.nodes.push(src, lfo);
    // [时间, 音量]
    const curve = [[0, 0.02], [8, 0.03], [17, 0.09], [26, 0.03], [36, 0.06], [45, 0.07], [55, 0.09], [76, 0.08], [87, 0.07], [99, 0.05], [110, 0.025], [120, 0]];
    for (const [t, v] of curve) { const at = s.base + t; if (t >= t0) g.gain.linearRampToValueAtTime(v, Math.max(ctx.currentTime, at)); else g.gain.setValueAtTime(v, ctx.currentTime); }
  }
  // 配乐：轻快的拨弦小调，三段
  music(s, t0) {
    const ctx = this.ctx; const bus = ctx.createGain(); bus.gain.value = 0.16; bus.connect(s.out); const w = ctx.createGain(); w.gain.value = 0.5; bus.connect(w); w.connect(s.rev);
    const bpm = 96, beat = 60 / bpm;
    const N = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const pluck = (at, note, dur, vol = 1, type = 'triangle') => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = N(note);
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = N(note) * 2.001;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.5 * vol, at + 0.008); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      const g2 = ctx.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(g);
      o.connect(g); g.connect(bus); o.start(at); o.stop(at + dur + 0.05); o2.start(at); o2.stop(at + dur + 0.05); s.nodes.push(o, o2);
    };
    // 段落：[开始, 结束, 和弦序列(根音), 旋律]
    const F = 65, C = 60, D = 62, Bb = 58, G = 55, A = 57;
    const sections = [
      { a: 0.6, b: 16.5, chords: [[F, 0], [D, 1], [Bb, 0], [C, 0]], mel: [77, 79, 81, 84, 81, 79, 77, 79, 81, 77, 74, 77, 79, 81, 79, 77], vol: 0.8 },
      { a: 17.2, b: 76, chords: [[D, 1], [Bb, 0], [G, 1], [A, 0]], mel: [74, 0, 77, 76, 74, 0, 72, 74, 76, 0, 77, 79, 77, 76, 74, 0], vol: 0.7, fast: true },
      { a: 87.2, b: 118.5, chords: [[F, 0], [C, 0], [D, 1], [Bb, 0]], mel: [81, 79, 77, 79, 81, 84, 81, 0, 79, 77, 74, 77, 79, 0, 77, 0], vol: 0.85 },
    ];
    for (const sec of sections) {
      const sb = sec.fast ? beat * 0.75 : beat;
      let i = 0;
      for (let t = sec.a; t < sec.b; t += sb, i++) {
        if (t < t0 - 0.01) continue;
        // 76–87 秒之间配乐收住
        if (t > 77.5 && t < 87) continue;
        const at = s.base + t; const bar = Math.floor(i / 8) % 4; const [root, minor] = sec.chords[bar];
        const fadeIn = Math.min(1, (t - sec.a) / 2), fadeOut = Math.min(1, (sec.b - t) / 2.5);
        const v = sec.vol * fadeIn * fadeOut;
        if (i % 4 === 0) pluck(at, root - 12, sb * 3.5, 0.55 * v, 'sine');
        if (i % 2 === 1) { pluck(at, root + (minor ? 3 : 4), sb * 1.6, 0.18 * v); pluck(at, root + 7, sb * 1.6, 0.15 * v); }
        const m = sec.mel[i % sec.mel.length]; if (m && i % 2 === 0) pluck(at, m, sb * 2.2, 0.3 * v);
      }
    }
    // 配乐“收住半拍”：在勺子滑下前后单独一记
    if (t0 < 81) pluck(s.base + 81.0, 74, 1.6, 0.3);
    if (t0 < 82.5) pluck(s.base + 82.4, 77, 2.2, 0.3);
  }
}

// 时间线上的音效 [t, 方法, ...参数]
export const SFX = [
  [6.83, 'drip'], [6.86, 'plop', 0.5],
  [8.0 + 3.98, 'drip'], [8.0 + 4.3, 'whoosh', 0.3, 0.5], [8.0 + 4.35, 'plop', 1.3], [8.0 + 4.36, 'splash', 1], [8.0 + 5.2, 'bubble', 5],
  [17.2, 'bubble', 6], [18.5, 'splash', 0.4], [20.0, 'touch'], [22.0, 'bubble', 4], [21.6, 'whoosh', 1.4, 0.6],
  [26.3, 'scrape', 1.1, 0.6], [27.2, 'step'], [27.5, 'step'], [27.8, 'step'], [28.1, 'step'],
  [29.2, 'fold'], [30.9, 'fold'], [32.6, 'crisp'], [33.6, 'scrape', 0.8, 0.5],
  [36.3, 'step'], [36.6, 'scrape', 0.3], [37.3, 'scrape', 0.3], [38.4, 'thump', 0.7], [38.6, 'thump', 0.6], [39.0, 'scrape', 0.9, 1.0], [40.2, 'splash', 1.1], [40.25, 'whoosh', 0.9], [41.7, 'stroke'], [42.3, 'stroke'], [42.9, 'stroke'], [43.6, 'stroke'], [44.2, 'stroke'],
  [45.5, 'stroke'], [46.1, 'stroke'], [46.7, 'stroke'], [47.4, 'stroke'], [48.0, 'stroke'], [49.6, 'whoosh', 1.6, 0.4], [51.0, 'bubble', 3],
  [57.4, 'touch'], [60.5, 'stroke'], [61.1, 'stroke'], [61.8, 'stroke', 1.2], [62.5, 'stroke', 1.2], [63.4, 'whoosh', 0.9, 0.7], [63.6, 'scrape', 0.5, 0.5],
  [65.2, 'stroke'], [65.9, 'stroke'], [71.6, 'splash', 0.9], [72.3, 'plop', 0.6], [72.6, 'thump', 0.5], [73.0, 'giggle', 620], [74.5, 'bubble', 4],
  [76.4, 'whoosh', 2.4, 0.9], [78.3, 'splash', 0.5], [80.4, 'knock'], [80.6, 'enamel', 0.5], [80.9, 'creak', 1.1], [82.1, 'plop', 1.2], [82.15, 'splash', 0.7],
  [88.0, 'stroke'], [88.6, 'stroke'], [89.2, 'stroke'], [92.8, 'stroke'], [93.6, 'stroke'], [94.8, 'stroke'], [95.6, 'stroke'], [96.1, 'touch'], [96.2, 'scrape', 0.4, 0.6],
  [99.5, 'step'], [100.0, 'step'], [101.8, 'step'], [102.6, 'step'], [103.4, 'step'], [104.2, 'step'], [105.0, 'step'], [105.8, 'step'], [106.6, 'step'],
  [107.1, 'thump'], [107.9, 'thump'], [108.7, 'thump'], [109.4, 'whoosh', 1.2, 0.3],
  [112.63, 'drip'], [112.66, 'plop', 0.7], [113.0, 'bubble', 3, 0.6], [117.9, 'giggle', 560], [118.2, 'giggle', 700], [119.2, 'drip', 0.7],
];
