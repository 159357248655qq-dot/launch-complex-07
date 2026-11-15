import * as THREE from 'three';

// 视觉高度压缩：近场 1:1，1200 m 以上指数饱和到约 2500（HUD 仍显示真实米数）。
// 2500 与地球半径 2600 配套 —— 终点高度约 0.96 R，地球在画面中张开约 60°，能看清弧形地平线。
const ALT_KNEE = 1200, ALT_TOP = 2500, ALT_TAU = 26000;
export function renderAlt(a) {
  if (a <= ALT_KNEE) return a;
  return ALT_KNEE + (ALT_TOP - ALT_KNEE) * (1 - Math.exp(-(a - ALT_KNEE) / ALT_TAU));
}
export const STAGE2_Y = 57.0;   // 二级底端在 root 局部坐标的高度（实测包围盒 57.0）
export const ROCKET_BASE = 12.6;

function softSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SMOKE_VERT = [
  'attribute float aLife;',
  'attribute float aSize;',
  'attribute vec3 aColor;',
  'attribute float aFade;',
  'varying float vLife;',
  'varying vec3 vColor;',
  'varying float vFade;',
  'void main() {',
  '  vLife = aLife; vColor = aColor; vFade = aFade;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  gl_PointSize = aSize * (520.0 / max(1.0, -mv.z));',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');

const SMOKE_FRAG = [
  'uniform sampler2D uMap;',
  'varying float vLife;',
  'varying vec3 vColor;',
  'varying float vFade;',
  'void main() {',
  '  vec4 tex = texture2D(uMap, gl_PointCoord);',
  '  float a = tex.a * smoothstep(0.0, 0.22, vLife) * (1.0 - smoothstep(0.50, 1.0, vLife));',
  '  if (a < 0.004) discard;',
  '  gl_FragColor = vec4(vColor, a * vFade);',
  '}'
].join('\n');

class Smoke {
  constructor(scene, count) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.ttl = new Float32Array(count);
    this.size = new Float32Array(count);
    this.col = new Float32Array(count * 3);
    this.base = new Float32Array(count);
    this.fade = new Float32Array(count);
    this.cursor = 0;
    for (let i = 0; i < count; i++) { this.life[i] = 1.0; this.fade[i] = 0.7; }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aFade', new THREE.BufferAttribute(this.fade, 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softSprite() } },
      vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
      transparent: true, depthWrite: false
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  emit(x, y, z, spread, up, life, size, tint, fade) {
    const i = this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x + (Math.random() - 0.5) * spread;
    this.pos[i * 3 + 1] = y + Math.random() * spread * 0.4;
    this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
    this.vel[i * 3] = (Math.random() - 0.5) * spread * 1.6;
    this.vel[i * 3 + 1] = up * (0.55 + Math.random() * 0.9);
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * spread * 1.6;
    this.life[i] = 0.0001;
    this.ttl[i] = life * (0.7 + Math.random() * 0.6);
    this.base[i] = size * (0.6 + Math.random() * 0.8);
    this.fade[i] = fade == null ? 0.72 : fade;
    this.col[i * 3] = tint[0]; this.col[i * 3 + 1] = tint[1]; this.col[i * 3 + 2] = tint[2];
  }

  update(dt, drag) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] >= 1.0) { this.size[i] = 0; continue; }
      this.life[i] += dt / this.ttl[i];
      const k = 1 - Math.min(1, dt * drag);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 2] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + dt * 1.2;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.base[i] * (0.55 + Math.min(this.life[i], 0.62) * 1.9);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aFade.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.count; i++) { this.life[i] = 1.0; this.size[i] = 0; }
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

function flameCone(r, h, color, order) {
  const geo = new THREE.ConeGeometry(1, 1, 32, 1, true);
  geo.rotateX(Math.PI);
  geo.translate(0, -0.5, 0);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = order;
  m.userData.r = r; m.userData.h = h;
  return m;
}

export class LaunchSequence {
  constructor(scene, stack, opts) {
    this.scene = scene;
    this.root = stack.root;
    this.stage1 = stack.stage1;
    this.stage2 = stack.stage2;
    this.boosters = stack.boosters || [];
    this.arms = stack.arms || [];
    this.opts = opts || {};
    this.state = 'idle';
    this.clock = 0;
    this.altitude = 0;       // 真实米
    this.velocity = 0;
    this.throttle = 0;
    this.countdown = -1;
    this.maxQ = 0;
    this.separated = { boosters: false, stage1: false, fairing: false };
    this.density = 1;
    this.events = [];
    this.timeScale = 1;

    // 真实发射的烟云规模远超 2600 粒；容量不足会直接表现为"点火几乎没烟"
    this.smoke = new Smoke(scene, 7000);
    this.trail = new Smoke(scene, 1600);

    // 原状快照，用于复位
    this._snap = [];
    for (const o of [this.stage1, this.stage2, ...this.boosters]) {
      if (!o) continue;
      this._snap.push({ o, parent: o.parent, pos: o.position.clone(), quat: o.quaternion.clone() });
    }
    this._debris = [];

    // ---- 尾焰 ----
    const base = ROCKET_BASE;
    this.plume = flameCone(1, 1, 0xff6a12, 4);
    this.mid = flameCone(1, 1, 0xffab4a, 4.5);
    this.core = flameCone(1, 1, 0xfff6e8, 5);
    // 尾焰挂在 root 下：root 会做重力转向倾斜，尾焰必须跟着箭体转，否则会脱开箭体
    for (const m of [this.plume, this.mid, this.core]) { m.position.set(0, base - 1.2, 0); this.root.add(m); }

    // 助推器尾焰 ×4
    this.bPlumes = [];
    for (let i = 0; i < 4; i++) {
      const ang = i * Math.PI / 2 + Math.PI / 4;
      const p = flameCone(1, 1, 0xffa855, 4);
      p.position.set(5.1 * Math.cos(ang), base - 1.4, 5.1 * Math.sin(ang));
      p.material.color.setHex(0xffb055);
      this.root.add(p);
      this.bPlumes.push(p);
    }

    const glowTex = softSprite();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false }));
    this.glow.renderOrder = 8;
    this.glow.position.set(0, base - 3, 0);
    this.glow.scale.set(30, 30, 1);
    this.root.add(this.glow);

    this.splash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa855, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.splash.position.set(0, 3.2, 0);
    this.splash.scale.set(60, 20, 1);
    scene.add(this.splash);

    this.engineLight = new THREE.PointLight(0xffa64d, 0, 320, 2);
    this.engineLight.position.set(0, base - 4, 0);
    this.root.add(this.engineLight);
  }

  on(fn) { this.events.push(fn); }
  emitEvent(name, payload) { for (const f of this.events) f(name, payload); }

  start() {
    if (this.state !== 'idle') return;
    this.state = 'fuel';
    this.clock = 0;
    this.countdown = -1;
    this.emitEvent('fuel');
  }

  abort() {
    this.state = 'idle';
    this.clock = 0; this.throttle = 0; this.altitude = 0; this.velocity = 0;
    this.countdown = -1; this.maxQ = 0;
    this.separated = { boosters: false, stage1: false, fairing: false };
    for (const s of this._snap) {
      if (s.o.parent !== s.parent) s.parent.attach(s.o);
      s.o.position.copy(s.pos); s.o.quaternion.copy(s.quat);
    }
    for (const d of this._debris) { this.scene.remove(d.mesh); }
    this._debris.length = 0;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;
    for (const m of [this.plume, this.mid, this.core, ...this.bPlumes]) m.material.opacity = 0;
    this.glow.material.opacity = 0;
    this.splash.material.opacity = 0;
    this.engineLight.intensity = 0;
    for (let i = 0; i < this.arms.length; i++) this.arms[i].rotation.y = 0;
    this.smoke.clear(); this.trail.clear();
    this.emitEvent('idle');
  }

  detach(node, vx, vy, vz, spin) {
    const world = new THREE.Vector3();
    node.getWorldPosition(world);
    this.scene.attach(node);
    this._debris.push({ mesh: node, v: new THREE.Vector3(vx, vy, vz), spin: spin || 0, t: 0 });
  }

  update(dt) {
    const s = this.state;

    if (s === 'idle') {
      this.throttle += (0 - this.throttle) * Math.min(1, dt * 3);
      this.countdown = -1;
    } else if (s === 'fuel') {
      this.clock += dt;
      if (this.clock > 3.2) { this.state = 'countdown'; this.clock = 0; this.emitEvent('countdown'); }
    } else if (s === 'countdown') {
      this.clock += dt;
      const remain = 10 - this.clock;
      this.countdown = remain;
      this.emitEvent('tick', remain);
      if (remain <= 3.2) this.openArms(dt);
      if (remain <= 0) { this.state = 'ignition'; this.clock = 0; this.countdown = -1; this.emitEvent('ignition'); }
    } else if (s === 'ignition') {
      this.clock += dt;
      this.throttle = Math.min(1, this.throttle + dt * 1.5);
      if (this.clock > 2.4) { this.state = 'liftoff'; this.clock = 0; this.emitEvent('liftoff'); }
    } else if (s === 'liftoff' || s === 'ascent') {
      this.clock += dt;
      this.throttle = Math.min(1, this.throttle + dt * 1.2);
      // 净加速度随高度衰减（大气阻力 + 重力）
      const a = Math.max(6.5, 19.5 - this.altitude * 0.00006);
      this.velocity += a * dt;
      this.altitude += this.velocity * dt;
      if (this.state === 'liftoff' && this.clock > 2.2) { this.state = 'ascent'; this.emitEvent('ascent'); }

      if (!this.separated.boosters && this.clock > 9.5) {
        this.separated.boosters = true;
        for (const b of this.boosters) {
          const p = new THREE.Vector3(); b.getWorldPosition(p);
          const out = new THREE.Vector3(p.x, 0, p.z).normalize();
          this.detach(b, out.x * 26, -12, out.z * 26, 0.9);
        }
        this.emitEvent('boosterSep');
      }
      if (!this.separated.stage1 && this.clock > 22) {
        this.separated.stage1 = true;
        if (this.stage1) this.detach(this.stage1, 2, -26, 0, 0.22);
        this.emitEvent('stageSep');
      }
      if (!this.separated.fairing && this.clock > 30) {
        this.separated.fairing = true;
        this.emitEvent('fairingSep');
      }
    }

    const ra = renderAlt(this.altitude);
    this.root.position.y = ra;
    // 重力转向：越飞越倾斜
    const tilt = Math.min(0.38, Math.max(0, (this.altitude - 1200) * 0.0000055));
    this.root.rotation.z = -tilt;

    for (const d of this._debris) {
      d.t += dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.v.y -= 9.8 * dt;
      d.mesh.rotation.z += d.spin * dt;
      d.mesh.rotation.x += d.spin * 0.6 * dt;
    }

    // ---- 尾焰 ----
    // 尾焰在 root 局部坐标下，不需要叠加视觉高度 ra
    const base = this.separated.stage1 ? STAGE2_Y : ROCKET_BASE;
    const vac = Math.min(1, Math.max(0, (this.altitude - 8000) / 60000));   // 真空膨胀
    const flick = 0.84 + Math.sin(performance.now() * 0.019) * 0.08 + Math.random() * 0.08;
    const th = this.throttle * flick;
    const thin = 1 - Math.min(0.35, this.altitude * 0.000004);

    this.plume.position.y = base - 1.0;
    this.mid.position.y = base - 1.0;
    this.core.position.y = base - 1.0;
    this.glow.position.y = base - 3.0;

    // 真空段：羽流膨胀但整体变暗（没有大气散射，光不会外溢）
    const vacDim = 1 - vac * 0.42;
    this.plume.material.opacity = th * (0.40 + vac * 0.10) * vacDim;
    this.mid.material.opacity = th * 0.62 * vacDim;
    this.core.material.opacity = th * (1.0 - vac * 0.55);
    // 真空段羽流：横向膨胀、纵向反而收短（真实上面级羽流是宽而短的伞状，不是长火柱）
    const w = 4.4 + th * 2.8, hh = 13 + th * 10;
    this.plume.scale.set(w * thin * (1 + vac * 1.15), hh * (1 - vac * 0.28), w * thin * (1 + vac * 1.15));
    this.mid.scale.set((2.8 + th * 1.8) * thin * (1 + vac * 0.85), (9 + th * 6.5) * (1 - vac * 0.30), (2.8 + th * 1.8) * thin * (1 + vac * 0.85));
    this.core.scale.set((1.35 + th * 0.95) * thin * (1 + vac * 0.5), (5.6 + th * 3.8) * (1 - vac * 0.25), (1.35 + th * 0.95) * thin * (1 + vac * 0.5));
    // 高空收敛：真空段没有大气散射，光晕必须收小，否则糊成白盘
    const glowK = Math.max(0.0, 1 - this.altitude / 3200);
    this.glow.material.opacity = th * 0.95 * glowK;
    this.glow.scale.setScalar((22 + th * 16 + Math.random() * 3) * (0.25 + glowK * 0.75));

    const near = Math.max(0, 1 - this.altitude / 90);
    this.splash.material.opacity = th * 0.55 * near;
    this.splash.scale.set(58 + th * 16, 18 + th * 6, 1);

    for (let i = 0; i < this.bPlumes.length; i++) {
      const p = this.bPlumes[i];
      const alive = this.separated.boosters ? 0 : 1;
      p.visible = alive > 0;
      p.material.opacity = th * 0.42;
      p.position.y = base - 1.4;
      p.scale.set(1.9 + th * 0.9, 7.5 + th * 3.4, 1.9 + th * 0.9);
    }

    this.engineLight.position.y = base - 2;
    this.engineLight.intensity = th * (600 + vac * 900);

    // ---- 排气粒子 ----（粒子在 scene 世界坐标下，需补上视觉高度 ra）
    const wbase = base + ra;
    if (this.throttle > 0.05) {
      // 大气密度因子：真空段几乎没有可见排气（这正是之前糊成白盘的根因）
      const airD = Math.exp(-this.altitude / 7000);
      const rate = Math.round((this.throttle > 0.9 ? 30 : 16) * this.density * airD);
      for (let i = 0; i < rate; i++) {
        const jitter = 1.2 + this.altitude * 0.00004;
        const tint = [0.62 + Math.random() * 0.14, 0.60 + Math.random() * 0.13, 0.57 + Math.random() * 0.12];
        this.smoke.emit(0, wbase - 6 - Math.random() * 12, 0, 4.4 + jitter, 5 + Math.random() * 5, 4.2, 9, tint, 0.17);
      }
      // 长尾迹：留在弹道后方
      // 长尾迹保留一部分（真实发射到 30 km 仍有可见尾迹），但随高度收窄变暗
      // 尾迹随大气密度指数衰减：40 km 以上基本不再生成（真空里没有可见烟柱）
      const trailRate = this.separated.stage1 ? 0 : Math.round(3 * this.density * Math.exp(-this.altitude / 6500));
      const trailDim = 0.07 * Math.exp(-this.altitude / 26000);
      for (let i = 0; i < trailRate; i++) {
        this.trail.emit(0, wbase - 14, 0, 2.2, -1.8, 6, 5, [0.70, 0.68, 0.65], trailDim);
      }
      if (this.altitude < 14) {
        // 地面翻滚烟云：真实发射在台面四周会摊开成直径百米的低矮云团
        for (let i = 0; i < Math.round(26 * this.density); i++) {
          const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 26;
          this.smoke.emit(Math.cos(a) * r, 2 + Math.random() * 6, Math.sin(a) * r,
            10 + Math.random() * 8, 3.4, 10 + Math.random() * 8, 26, [0.80, 0.78, 0.75], 0.34);
        }
        for (let sd = -1; sd <= 1; sd += 2) {
          const n = Math.round((18 + this.throttle * 18) * this.density);
          for (let i = 0; i < n; i++) {
            const ex = sd * (16 + Math.random() * 16);
            const ez = (Math.random() - 0.5) * 10;
            this.smoke.emit(ex, 1.2 + Math.random() * 6, ez, 3.6, 3.2, 3.6, 13, [1.0, 0.72, 0.34], 0.62);
          }
        }
      }
    }
    this.smoke.update(dt, this.altitude > 5 ? 0.55 : 1.6);
    this.trail.update(dt, 0.12);
  }

  openArms(dt) {
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rotation.y = Math.min(1.45, this.arms[i].rotation.y + dt * 0.9);
    }
  }
}