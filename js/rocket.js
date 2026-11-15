import * as THREE from 'three';

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
  'varying float vLife;',
  'varying vec3 vColor;',
  'void main() {',
  '  vLife = aLife; vColor = aColor;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  gl_PointSize = aSize * (320.0 / max(1.0, -mv.z));',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');

const SMOKE_FRAG = [
  'uniform sampler2D uMap;',
  'varying float vLife;',
  'varying vec3 vColor;',
  'void main() {',
  '  vec4 tex = texture2D(uMap, gl_PointCoord);',
  '  float a = tex.a * smoothstep(0.0, 0.25, vLife) * (1.0 - smoothstep(0.55, 1.0, vLife));',
  '  if (a < 0.004) discard;',
  '  gl_FragColor = vec4(vColor, a * 0.72);',
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
    this.cursor = 0;
    for (let i = 0; i < count; i++) this.life[i] = 1.0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
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

  emit(x, y, z, spread, up, life, size, tint) {
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
      this.size[i] = this.base[i] * (0.55 + this.life[i] * 2.4);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

export class LaunchSequence {
  constructor(scene, rocketPivot, arms, opts) {
    this.scene = scene;
    this.pivot = rocketPivot;
    this.arms = arms;
    this.opts = opts || {};
    this.baseY = rocketPivot.position.y;
    this.state = 'idle';
    this.t = 0;
    this.clock = 0;
    this.altitude = 0;
    this.velocity = 0;
    this.throttle = 0;
    this.smoke = new Smoke(scene, 1500);
    this.density = 1;
    this.events = [];

    const plumeGeo = new THREE.ConeGeometry(1, 1, 26, 1, true);
    plumeGeo.rotateX(Math.PI);
    plumeGeo.translate(0, -0.5, 0);
    const plumeMat = new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const midMat = new THREE.MeshBasicMaterial({ color: 0xffb257, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.plume = new THREE.Mesh(plumeGeo, plumeMat);
    this.mid = new THREE.Mesh(plumeGeo, midMat);
    this.core = new THREE.Mesh(plumeGeo, coreMat);
    this.mid.position.y = 12.4;
    this.mid.renderOrder = 4.5;
    this.plume.position.y = 12.4;
    this.core.position.y = 12.4;
    this.plumeY = 12.4;
    this.plume.renderOrder = 4;
    this.core.renderOrder = 5;
    scene.add(this.plume, this.mid, this.core);

    const glowTex = softSprite();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    this.glow.renderOrder = 8;
    this.glow.position.set(0, 10.8, 0);
    this.glow.scale.set(30, 30, 1);
    scene.add(this.glow);

    this.splash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa855, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.splash.position.set(0, 3.2, 0);
    this.splash.scale.set(50, 18, 1);
    scene.add(this.splash);

    this.engineLight = new THREE.PointLight(0xffa64d, 0, 240, 2);
    this.engineLight.position.set(0, 7, 0);
    scene.add(this.engineLight);
  }

  on(fn) { this.events.push(fn); }
  emitEvent(name, payload) { for (const f of this.events) f(name, payload); }

  start() {
    if (this.state !== 'idle') return;
    this.state = 'fuel';
    this.clock = 0;
    this.emitEvent('fuel');
  }

  abort() {
    this.state = 'idle';
    this.clock = 0; this.t = 0; this.throttle = 0;
    this.altitude = 0; this.velocity = 0;
    this.pivot.position.y = this.baseY;
    this.pivot.rotation.z = 0;
    this.plume.material.opacity = 0; this.mid.material.opacity = 0; this.core.material.opacity = 0;
    this.glow.material.opacity = 0;
    this.splash.material.opacity = 0;
    this.engineLight.intensity = 0;
    for (let i = 0; i < this.arms.length; i++) this.arms[i].rotation.y = 0;
    this.emitEvent('idle');
  }

  update(dt) {
    const s = this.state;
    if (s === 'idle') {
      this.throttle += (0 - this.throttle) * Math.min(1, dt * 3);
    } else if (s === 'fuel') {
      this.clock += dt;
      if (this.clock > 3.0) { this.state = 'countdown'; this.clock = 0; this.emitEvent('countdown'); }
    } else if (s === 'countdown') {
      this.clock += dt;
      const remain = 10 - this.clock;
      this.emitEvent('tick', remain);
      if (remain <= 3.2) this.openArms(dt);
      if (remain <= 0) { this.state = 'ignition'; this.clock = 0; this.emitEvent('ignition'); }
    } else if (s === 'ignition') {
      this.clock += dt;
      this.throttle = Math.min(1, this.throttle + dt * 1.6);
      if (this.clock > 2.2) { this.state = 'liftoff'; this.clock = 0; this.emitEvent('liftoff'); }
    } else if (s === 'liftoff' || s === 'ascent') {
      this.clock += dt;
      this.throttle = Math.min(1, this.throttle + dt * 1.2);
      this.velocity += (5.5 + this.altitude * 0.006) * dt;
      this.altitude += this.velocity * dt;
      this.pivot.position.y = this.baseY + this.altitude;
      const tilt = Math.min(0.34, Math.max(0, (this.altitude - 55) * 0.0016));
      this.pivot.rotation.z = -tilt;
      if (this.state === 'liftoff' && this.clock > 2.0) { this.state = 'ascent'; this.emitEvent('ascent'); }
    }

    // flame stays welded to the engine bell while the stack climbs
    const py = 12.4 + this.altitude;
    this.plume.position.y = py;
    this.mid.position.y = py;
    this.core.position.y = py;
    this.glow.position.y = py - 1.6;

    const flick = 0.82 + Math.sin(performance.now() * 0.021) * 0.09 + Math.random() * 0.09;
    const th = this.throttle * flick;
    const thin = 1 - Math.min(0.45, this.altitude * 0.004);
    this.plume.material.opacity = th * 0.42;
    this.mid.material.opacity = th * 0.62;
    this.core.material.opacity = th * 1.0;
    this.plume.scale.set((4.2 + th * 2.6) * thin, 11 + th * 8, (4.2 + th * 2.6) * thin);
    this.mid.scale.set((2.7 + th * 1.7) * thin, 8.5 + th * 6.2, (2.7 + th * 1.7) * thin);
    this.core.scale.set((1.3 + th * 0.9) * thin, 5.4 + th * 3.6, (1.3 + th * 0.9) * thin);
    this.glow.material.opacity = th * 0.95;
    this.glow.scale.setScalar(20 + th * 14 + Math.random() * 3);
    // ground splash fades as the rocket climbs away
    const near = Math.max(0, 1 - this.altitude / 70);
    this.splash.material.opacity = th * 0.5 * near;
    this.splash.scale.set(46 + th * 12, 16 + th * 5, 1);
    this.engineLight.position.y = py + 2;
    this.engineLight.intensity = th * 1500;

    const exhaustY = this.baseY + this.altitude - 4;
    if (this.throttle > 0.05) {
      const rate = Math.round((this.throttle > 0.9 ? 14 : 6) * this.density);
      for (let i = 0; i < rate; i++) {
        const jitter = 1.2 + this.altitude * 0.02;
        const tint = [0.74 + Math.random() * 0.16, 0.71 + Math.random() * 0.15, 0.66 + Math.random() * 0.14];
        this.smoke.emit(0, exhaustY - Math.random() * 8, 0, 4.2 + jitter, 5 + Math.random() * 5, 4.0, 14 + this.altitude * 0.06, tint);
      }
      if (this.altitude < 10) {
        for (let i = 0; i < Math.round(8 * this.density); i++) {
          const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 10;
          this.smoke.emit(Math.cos(a) * r, 2 + Math.random() * 3, Math.sin(a) * r, 6, 2.6, 6.0, 20, [0.86, 0.83, 0.78]);
        }
        // flame roaring out of both trench exits
        for (let s = -1; s <= 1; s += 2) {
          for (let i = 0; i < Math.round(5 * this.density); i++) {
            const ex = s * (17 + Math.random() * 12);
            const ez = (Math.random() - 0.5) * 7;
            const j = this.smoke.emit(ex, 1.5 + Math.random() * 4, ez, 3.0, 3.4, 3.6, 13, [0.96, 0.90, 0.84]);
          }
        }
      }
    }
    this.smoke.update(dt, this.altitude > 5 ? 0.55 : 1.6);
  }

  openArms(dt) {
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rotation.y = Math.min(1.45, this.arms[i].rotation.y + dt * 0.9);
    }
  }
}
