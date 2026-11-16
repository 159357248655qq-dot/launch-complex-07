import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 全程序化音频：不依赖任何音频文件，全部由 WebAudio 合成。
// 声部：环境风 / 低频轰鸣 / 中频咆哮 / 次低频 / 燃烧爆裂 / 倒计时 / 音爆
// ---------------------------------------------------------------------------

function impulseResponse(ctx, seconds, decay, spread) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      d[i] = (Math.random() * 2 - 1) * env * (ch === 0 ? 1 : 1 - spread * 0.5);
    }
  }
  return buf;
}

function noiseBuffer(ctx, kind, seconds) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, brown = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') {
      brown = (brown + 0.02 * w) / 1.02;
      d[i] = brown * 3.4;
    } else if (kind === 'pink') {
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    } else {
      d[i] = w;
    }
  }
  return buf;
}

function softClipCurve(k) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

export class LaunchAudio {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.muted = false;
    this.level = 0.85;
    this.beds = null;
    this.crackleT = 0;
    this.beepT = 0;
    this.lastBeep = -1;
    this.supersonic = false;
    this.lfo = null;
  }

  // 必须在用户手势中调用（浏览器自动播放策略）
  async enable() {
    if (this.ctx) {
      // 状态复位必须放在 await 之前：resume() 在没有用户手势时永不 resolve，
      // 放在后面会导致「静音一次后永远打不开」。
      this.on = true;
      this.muted = false;
      this.fade(1.0, 0.6);
      if (this.ctx.state === 'suspended') { this.ctx.resume().catch(() => {}); }
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain();
    master.gain.value = 0.0001;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 22;
    comp.ratio.value = 4.0;
    comp.attack.value = 0.005;
    comp.release.value = 0.22;
    master.connect(comp);
    comp.connect(ctx.destination);

    // 户外大空间混响
    const rev = ctx.createConvolver();
    rev.buffer = impulseResponse(ctx, 2.8, 2.6, 0.7);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.42;
    rev.connect(revGain);
    revGain.connect(master);
    this.reverb = rev;

    const send = (node, wet) => {
      node.connect(master);
      if (wet > 0) {
        const g = ctx.createGain();
        g.gain.value = wet;
        node.connect(g);
        g.connect(rev);
      }
    };

    // --- 环境风 ---
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(ctx, 'pink', 4.0);
    wind.loop = true;
    const windBP = ctx.createBiquadFilter();
    windBP.type = 'bandpass';
    windBP.frequency.value = 520;
    windBP.Q.value = 0.55;
    const windGain = ctx.createGain();
    // 0.055 实测只有 -44.7 dB，等于没声；发射场待机必须能听见海风与远处人声环境
    windGain.gain.value = 0.24;
    wind.connect(windBP).connect(windGain);
    send(windGain, 0.35);
    wind.start();

    // --- 低频轰鸣（燃烧室 + 塔架反射）---
    const rumble = ctx.createBufferSource();
    rumble.buffer = noiseBuffer(ctx, 'brown', 4.0);
    rumble.loop = true;
    const rumbleLP = ctx.createBiquadFilter();
    rumbleLP.type = 'lowpass';
    rumbleLP.frequency.value = 110;
    rumbleLP.Q.value = 0.9;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.0001;
    rumble.connect(rumbleLP).connect(rumbleGain);
    send(rumbleGain, 0.5);
    rumble.start();

    // --- 中频咆哮（尾焰湍流）---
    const roar = ctx.createBufferSource();
    roar.buffer = noiseBuffer(ctx, 'white', 4.0);
    roar.loop = true;
    const roarBP = ctx.createBiquadFilter();
    roarBP.type = 'bandpass';
    roarBP.frequency.value = 480;
    roarBP.Q.value = 0.75;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve(2.2);
    shaper.oversample = '2x';
    const roarGain = ctx.createGain();
    roarGain.gain.value = 0.0001;
    roar.connect(roarBP).connect(shaper).connect(roarGain);
    send(roarGain, 0.45);
    roar.start();

    // 湍流摆动：让中频咆哮的频率与音量缓慢起伏，避免"电风扇"式的死板噪声
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 3.1;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(roarBP.frequency);
    lfo.start();
    const lfo2 = ctx.createOscillator();
    lfo2.type = 'sine';
    lfo2.frequency.value = 0.37;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.045;
    lfo2.connect(lfo2Gain).connect(roarGain.gain);
    lfo2.start();
    this.lfo = { lfo, lfo2 };

    // --- 次低频（推力压迫感）---
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 34;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.0001;
    sub.connect(subGain);
    send(subGain, 0.2);
    sub.start();

    // --- 高频嘶声（真空中残留的泵噪）---
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuffer(ctx, 'white', 3.0);
    hiss.loop = true;
    const hissHP = ctx.createBiquadFilter();
    hissHP.type = 'highpass';
    hissHP.frequency.value = 3400;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.0001;
    hiss.connect(hissHP).connect(hissGain);
    send(hissGain, 0.15);
    hiss.start();

    this.beds = { windGain, rumbleGain, rumbleLP, roarGain, roarBP, subGain, sub, hissGain };
    this.on = true;
    this.muted = false;
    this.fade(1.0, 0.8);
    return true;
  }

  fade(target, seconds) {
    if (!this.ctx) return;
    const g = this.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(this.muted ? 0.0001 : target * this.level, this.ctx.currentTime, Math.max(0.02, seconds / 3));
  }

  setMuted(m) {
    this.muted = m;
    this.fade(0.85, 0.35);
  }

  setVolume(v) {
    this.level = v;
    this.fade(0.85, 0.2);
  }

  // 短促点击/提示音
  beep(freq, dur, gain) {
    if (!this.ctx || !this.on || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.14, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.14));
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + (dur || 0.14) + 0.02);
  }

  // 音爆 / 结构撞击：低频冲击 + 噪声扫频
  boom(strength) {
    if (!this.ctx || !this.on || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = strength == null ? 1 : strength;

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 'brown', 1.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * s, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
    noise.connect(lp).connect(g);
    g.connect(this.master);
    g.connect(this.reverb);
    noise.start(t);
    noise.stop(t + 1.4);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(72, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.42 * s, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(og);
    og.connect(this.master);
    o.start(t);
    o.stop(t + 1.15);
  }

  // 跨音速音爆：N 形激波 —— 极快上升沿 + 快速衰减 + 次低频拖尾
  sonicBoom() {
    if (!this.ctx || !this.on || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [delay, amp] of [[0, 0.9], [0.19, 0.55]]) {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx, 'white', 0.5);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2600, t + delay);
      bp.frequency.exponentialRampToValueAtTime(180, t + delay + 0.42);
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(amp, t + delay + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.5);
      noise.connect(bp).connect(g);
      g.connect(this.master);
      g.connect(this.reverb);
      noise.start(t + delay);
      noise.stop(t + delay + 0.52);
    }
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(22, t + 1.6);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.55, t + 0.05);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(og);
    og.connect(this.master);
    o.start(t);
    o.stop(t + 1.85);
  }

  // 摆杆解锁 / 机械动作
  clank() {
    if (!this.ctx || !this.on || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 'white', 0.35);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2100, t);
    bp.frequency.exponentialRampToValueAtTime(620, t + 0.3);
    bp.Q.value = 3.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    noise.connect(bp).connect(g);
    g.connect(this.master);
    g.connect(this.reverb);
    noise.start(t);
    noise.stop(t + 0.36);
  }

  // 点火前的气体喷注
  purge() {
    if (!this.ctx || !this.on || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 'white', 1.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 1.4);
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.18);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.5);
    noise.connect(bp).connect(g);
    g.connect(this.master);
    g.connect(this.reverb);
    noise.start(t);
    noise.stop(t + 1.6);
  }

  // 每帧更新：把状态映射到各声部增益
  update(dt, s) {
    if (!this.ctx || !this.on || !this.beds) return;
    const b = this.beds;
    const th = s.throttle || 0;
    const alt = s.altitude || 0;
    const t = this.ctx.currentTime;
    const k = 0.12;

    // 大气越稀薄，燃烧声越干净、轰鸣越弱
    const air = Math.max(0.06, Math.exp(-alt / 26000));
    // 待机底噪要可闻（-30 dB 量级），起飞后被发动机压下去
    const wind = 0.20 + 0.07 * (1 - air);

    b.windGain.gain.setTargetAtTime(wind * (1 - th * 0.78), t, k);
    b.rumbleGain.gain.setTargetAtTime(th * 0.92 * (0.32 + 0.68 * air), t, k);
    b.roarGain.gain.setTargetAtTime(th * 0.44 * (0.16 + 0.84 * air), t, k);
    b.subGain.gain.setTargetAtTime(th * 0.52 * (0.36 + 0.64 * air), t, k);
    b.hissGain.gain.setTargetAtTime(th * 0.13 * (1 - air), t, k);

    b.rumbleLP.frequency.setTargetAtTime(64 + th * 150 * air + 40, t, 0.2);
    b.roarBP.frequency.setTargetAtTime(330 + th * 620 * air, t, 0.2);
    b.sub.frequency.setTargetAtTime(28 + th * 14 - alt * 0.00002, t, 0.3);

    // 跨音速：Mach 1 一次性音爆
    const mach = s.mach || 0;
    if (!this.supersonic && mach > 1.0) { this.supersonic = true; this.sonicBoom(); }
    if (mach < 0.6) this.supersonic = false;

    // 燃烧爆裂
    if (th > 0.25) {
      this.crackleT += dt;
      const interval = 0.055 + Math.random() * 0.09;
      if (this.crackleT > interval) {
        this.crackleT = 0;
        const ctx = this.ctx;
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer(ctx, 'white', 0.12);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 700 + Math.random() * 1800;
        bp.Q.value = 1.8 + Math.random() * 2.4;
        const g = ctx.createGain();
        const amp = (0.035 + Math.random() * 0.11) * th * (0.28 + 0.72 * air);
        g.gain.setValueAtTime(amp, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
        noise.connect(bp).connect(g);
        g.connect(this.master);
        g.connect(this.reverb);
        noise.start(t);
        noise.stop(t + 0.12);
      }
    }

    // 倒计时滴答
    if (s.countdown != null && s.countdown >= 0) {
      const sec = Math.ceil(s.countdown);
      if (sec !== this.lastBeep && sec <= 10 && sec > 0) {
        this.lastBeep = sec;
        this.beep(sec <= 3 ? 1180 : 880, 0.15, sec <= 3 ? 0.30 : 0.20);
      }
      if (s.countdown < 0) this.lastBeep = -1;
    }
  }
}
