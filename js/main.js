import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildEnvironment } from './env.js';
import { buildSpace } from './space.js';
import { LaunchSequence, renderAlt, ROCKET_BASE, STAGE2_Y } from './rocket.js';
import { LaunchAudio } from './audio.js';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 1.2, 20000);
camera.position.set(152, 74, 132);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 48, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 26;
controls.maxDistance = 900;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 0.55;

const env = buildEnvironment(scene, renderer);
const space = buildSpace(scene, { sun: env.sun ? undefined : undefined });
scene.userData.cam = camera;

// EffectComposer 默认的 render target 不带 MSAA —— renderer 上的 antialias:true
// 对后期链路无效，地球边缘因此是一圈阶梯状硬边。必须显式开 samples。
const composerRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
  type: THREE.HalfFloatType,
  samples: 4
});
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.52, 0.72, 0.70);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const audio = new LaunchAudio();

const HOTSPOTS = [
  { p: [0, 88, 0], t: '有效载荷整流罩', d: '直径 4.2 m · 双瓣分离' },
  { p: [0, 66, 0], t: '二级贮箱', d: '液氧 / 煤油 · 真空推力 88 kN' },
  { p: [0, 34, 0], t: '一级芯级', d: '4 台助推 + 1 台主机并联' },
  { p: [-7, 48, 0], t: '勤务塔摆杆', d: '3 组 · 点火前 3 s 摆开' },
  { p: [-13, 100, 0], t: '勤务塔 + 吊车', d: '高 92 m · 顶部避雷针' },
  { p: [0, 8, 9], t: '导流槽 / 导流锥', d: '燃气向两侧排出' },
  { p: [-44, 14, 22], t: '液氧球罐', d: '容积 300 m³ · 真空绝热' },
  { p: [46, 22, -18], t: '高位水塔', d: '发射降噪喷水 220 m³' }
];

const markers = [];
const markerGroup = new THREE.Group();
scene.add(markerGroup);
for (const h of HOTSPOTS) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;width:9px;height:9px;border-radius:50%;background:#59c2ff;box-shadow:0 0 0 3px rgba(89,194,255,.22),0 0 14px rgba(89,194,255,.8);transform:translate(-50%,-50%);pointer-events:none;transition:opacity .2s';
  document.body.appendChild(el);
  markers.push({ el, pos: new THREE.Vector3(...h.p), info: h });
}

let gltfRoot = null, stackRoot = null, arms = [], stage1G = null, stage2G = null, boosters = [];
const loader = new GLTFLoader();
const lbar = document.getElementById('lbar');
const loadEl = document.getElementById('load');

loader.load('./assets/launchpad.glb', (gltf) => {
  gltfRoot = gltf.scene;
  gltfRoot.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.envMapIntensity = 1.0;
        if (m.name === 'Lamp') { m.emissiveIntensity = 3.2; }
        if (m.name === 'RocketWhite') { m.color.setHex(0xe8ebef); m.metalness = 0.10; m.roughness = 0.46; m.envMapIntensity = 0.8; }
        if (m.name === 'TankWhite') { m.color.setHex(0xd2d7dd); m.metalness = 0.14; m.roughness = 0.42; m.envMapIntensity = 0.8; }
        if (m.name === 'Steel') { m.metalness = 0.42; m.roughness = 0.58; m.color.setHex(0x6b7280); m.envMapIntensity = 0.55; }
        if (m.name === 'SteelDark') { m.metalness = 0.40; m.roughness = 0.62; m.color.setHex(0x4a5058); m.envMapIntensity = 0.5; }
        if (m.name === 'Concrete') { m.roughness = 0.92; m.color.setHex(0x7d7e82); }
        if (m.name === 'ConcreteDark') { m.roughness = 0.95; }
        if (m.name === 'Nozzle') { m.metalness = 0.9; m.roughness = 0.32; }
      }
    }
  });
  scene.add(gltfRoot);

  stackRoot = new THREE.Group();
  stackRoot.name = 'Stack';
  scene.add(stackRoot);

  const take = (name) => {
    const o = gltfRoot.getObjectByName(name);
    if (!o) return null;
    gltfRoot.remove(o);
    stackRoot.add(o);
    return o;
  };

  const s1 = take('Stage1');
  const noz = take('Rocket_Nozzles');
  const s2 = take('Stage2');
  for (let i = 1; i <= 4; i++) {
    const b = take('Booster_L' + i);
    if (b) boosters.push(b);
  }

  if (s1) {
    stage1G = new THREE.Group();
    stage1G.position.copy(s1.position);
    s1.position.set(0, 0, 0);
    stage1G.add(s1);
    if (noz) { noz.position.set(0, 0, 0); stage1G.add(noz); }
    stackRoot.add(stage1G);
  }
  if (s2) {
    stage2G = new THREE.Group();
    stage2G.position.copy(s2.position);
    s2.position.set(0, 0, 0);
    stage2G.add(s2);
    stackRoot.add(stage2G);
  }

  for (const n of ['Arm_Low', 'Arm_Mid', 'Arm_High']) {
    const a = gltfRoot.getObjectByName(n);
    if (a) {
      const pivot = new THREE.Group();
      pivot.position.copy(a.position);
      a.position.set(0, 0, 0);
      pivot.add(a);
      gltfRoot.add(pivot);
      arms.push(pivot);
    }
  }

  seq = new LaunchSequence(scene, { root: stackRoot, stage1: stage1G, stage2: stage2G, boosters, arms }, {});
  seq.density = smokeFactor;
  seq.on(handleEvent);
  bindLaunch();
  renderer.shadowMap.needsUpdate = true;

  loadEl.classList.add('hidden');
  setTimeout(() => loadEl.remove(), 800);
}, (ev) => {
  if (ev.total) lbar.style.width = Math.max(12, (ev.loaded / ev.total) * 100) + '%';
}, (err) => {
  lbar.style.width = '100%';
  lbar.style.background = '#e0533a';
  console.error('GLB load failed', err);
});

let seq = null;
const clockEl = document.getElementById('clock');
const phaseEl = document.getElementById('phase');
const altEl = document.getElementById('alt');
const altUEl = document.getElementById('altU');
const velEl = document.getElementById('vel');
const machEl = document.getElementById('mach');
const thrEl = document.getElementById('thr');
let lastStep = '';

const PHASES = {
  idle: '待机 STANDBY', fuel: '加注推进剂 FUELING', countdown: '倒计时 COUNTDOWN',
  ignition: '点火 IGNITION', liftoff: '起飞 LIFTOFF', ascent: '上升 ASCENT'
};

function handleEvent(name, payload) {
  if (name === 'tick') {
    const r = Math.max(0, payload);
    clockEl.textContent = 'T-' + r.toFixed(2).padStart(5, '0');
    if (r < 3.2) phaseEl.textContent = '摆杆回收 RETRACT';
    return;
  }
  if (name === 'fuel') { audio.purge(); }
  if (name === 'ignition') { audio.boom(1.15); audio.purge(); shake(2.2); }
  if (name === 'liftoff') { clockEl.textContent = 'T+00:00'; audio.boom(0.7); shake(1.6); setCam('follow'); }
  if (name === 'boosterSep') { audio.boom(0.85); audio.clank(); shake(0.9); note('助推器分离 BOOSTER SEP'); }
  if (name === 'stageSep') { audio.boom(0.9); audio.clank(); shake(0.8); note('一级分离 STAGE SEP'); }
  if (name === 'fairingSep') { audio.clank(); note('整流罩分离 FAIRING SEP'); }
  if (PHASES[name]) phaseEl.textContent = PHASES[name];
  if (name === 'idle') { clockEl.textContent = 'T-00:10'; phaseEl.textContent = PHASES.idle; }
  const btn = document.getElementById('btnLaunch');
  if (name === 'fuel') { btn.disabled = true; btn.textContent = '发射中…'; }
  if (name === 'idle') { btn.disabled = false; btn.textContent = '点火发射'; }
}

// 镜头震动：点火与分离时给一点高频抖动，让"推力"有体感
let shakeAmp = 0, shakeT = 0;
function shake(amp) { shakeAmp = Math.max(shakeAmp, amp); shakeT = 0; }

let noteTimer = 0;
function note(text) {
  const el = document.getElementById('note');
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  noteTimer = 3.2;
}

function bindLaunch() {
  const btn = document.getElementById('btnLaunch');
  btn.addEventListener('click', () => {
    audio.enable();
    if (seq && seq.state === 'idle') { seq.start(); setCam(1); }
  });
  document.getElementById('btnReset').addEventListener('click', () => {
    if (seq) { seq.abort(); setCam(0); space.setReveal(0); }
  });
}

// ---------------------------------------------------------------- camera
const CAMS = [
  { name: '全景', pos: [152, 74, 132], tgt: [0, 48, 0], fov: 42 },
  { name: '近景', pos: [30, 26, 44], tgt: [0, 50, 0], fov: 54 },
  { name: '塔架', pos: [148, 9, 34], tgt: [0, 72, 0], fov: 38 },
  { name: '仰拍', pos: [-58, 12, 62], tgt: [0, 60, 0], fov: 62 }
];
let camMode = 0;      // 0..3 固定机位
let camFree = true;   // false = 追拍
let camAnim = null;

function setCam(i) {
  if (i === 'follow') { camFree = false; document.getElementById('btnFollow').classList.add('on'); return; }
  camFree = true;
  camMode = i;
  document.getElementById('btnFollow').classList.remove('on');
  const c = CAMS[i];
  camAnim = {
    from: camera.position.clone(), to: new THREE.Vector3(...c.pos),
    tf: controls.target.clone(), tt: new THREE.Vector3(...c.tgt),
    f0: camera.fov, f1: c.fov, t: 0
  };
}

document.getElementById('btnCam').addEventListener('click', () => { setCam((camMode + 1) % CAMS.length); });
document.getElementById('btnFollow').addEventListener('click', () => { camFree ? setCam('follow') : setCam(camMode); });

// 太空补光：地球反照（earthshine）+ 相机侧补光，避免箭体在真空里变成纯黑剪影
const spaceFill = new THREE.DirectionalLight(0x9fc2ff, 0);
spaceFill.position.set(1, 0.6, 1);
scene.add(spaceFill);
const spaceFill2 = new THREE.DirectionalLight(0xffffff, 0);
spaceFill2.position.set(0.6, 1, -0.4);
scene.add(spaceFill2);

const followPos = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const followTgt = new THREE.Vector3();
let followAz = 0;

// 追拍：机位始终在地面一侧、略高于箭体，随视觉高度抬升并后退。
// 到高空后机位压到火箭侧后方，让地球弧形地平线进入画面下缘。
function updateFollow(dt) {
  const ra = stackRoot ? stackRoot.position.y : 0;        // 视觉高度
  const k = Math.min(1, Math.max(0, (ra - 300) / 2200));  // 0 = 贴地, 1 = 太空段

  // 几何按"箭体完整入画 + 地球弧线入画"反解：
  //   k=0：dist 150 / 相机 ra+26 / 目标 ra+52，fov 46 —— 箭体占画面 47%
  //   k=1：dist 180 / 相机 ra+77 / 目标 ra-25，fov 74 —— 箭体在中心上方 18.5°，
  //        地球边缘在中心下方 29.6°，两者同框
  // 近地段箭体是满箭 92 m，必须比太空段退得更远；随级间分离逐步推近
  const dist = 200 - k * 20;
  followAz += dt * (0.055 + k * 0.025);
  const az = followAz + 0.9;

  // 相机与目标都抬到箭体中段附近，避免"从下往上拍"把箭顶推出画面
  const lift = 40 + k * 37;
  followPos.set(Math.cos(az) * dist, ra + lift, Math.sin(az) * dist);

  followTgt.set(0, ra + 46 - k * 71, 0);

  // 补光随太空揭示强度升起，方向跟着相机（永远照到朝向观众的一面）
  const fill = Math.min(1, Math.max(0, (ra - 500) / 1200));
  spaceFill.intensity = fill * 3.2;
  spaceFill2.intensity = fill * 1.4;
  tmpV.copy(camera.position).sub(controls.target).normalize();
  spaceFill.position.copy(controls.target).addScaledVector(tmpV, 200);
  spaceFill.target.position.copy(controls.target);
  spaceFill.target.updateMatrixWorld();

  // 用指数平滑而不是 dt*2 线性插值：火箭起飞段加速度很大，
  // 线性插值在 133 m/s 时会滞后约 63 m，直接把箭顶推出画面。
  camera.position.lerp(followPos, 1 - Math.exp(-dt * 8.0));
  controls.target.lerp(followTgt, 1 - Math.exp(-dt * 9.0));
  const wantFov = 46 + k * 28;                            // 46 → 74 广角容纳地球弧线
  camera.fov += (wantFov - camera.fov) * (1 - Math.exp(-dt * 3.0));
  camera.updateProjectionMatrix();
}

// 真实高度 → 太空层揭示进度（与 renderAlt 的视觉压缩配套）
export function spaceReveal(alt) {
  // 必须与天空变暗（env.js 的 sp）重叠：地球 6 km 开始浮现，40 km 完全成形。
  // 原来 12 km 才开始，和 8 km 全黑的天空之间留下一条纯黑真空带。
  return Math.min(1, Math.max(0, (alt - 6000) / 34000));
}

const nightSlider = document.getElementById('night');
const btnNight = document.getElementById('btnNight');
function applyNight(v) { env.setNight(v); nightSlider.value = String(Math.round(v * 100)); btnNight.classList.toggle('on', v > 0.5); }
nightSlider.addEventListener('input', () => applyNight(Number(nightSlider.value) / 100));
btnNight.addEventListener('click', () => applyNight(env.state.target > 0.5 ? 0 : 1));

const orbitChk = document.getElementById('orbit');
orbitChk.checked = false;
orbitChk.addEventListener('change', (e) => { controls.autoRotate = e.target.checked; });
let timeScale = 1;
document.getElementById('slow').addEventListener('change', (e) => { timeScale = e.target.checked ? 0.35 : 1; });
const hotChk = document.getElementById('hot');
hotChk.addEventListener('change', () => { markerGroup.visible = hotChk.checked; for (const m of markers) m.el.style.opacity = hotChk.checked ? '1' : '0'; });
controls.autoRotate = false;

const smokeSlider = document.getElementById('smoke');
let smokeFactor = 1;
smokeSlider.addEventListener('input', () => {
  smokeFactor = Number(smokeSlider.value) / 100;
  if (seq) seq.density = smokeFactor;
});

const btnAudio = document.getElementById('btnAudio');
let audioOn = false;
btnAudio.addEventListener('click', async () => {
  if (!audioOn) {
    const ok = await audio.enable();
    audioOn = ok;
    btnAudio.textContent = ok ? '音效 开' : '音效不可用';
    btnAudio.classList.toggle('on', ok);
  } else {
    audioOn = false;
    audio.setMuted(true);
    btnAudio.textContent = '音效 关';
    btnAudio.classList.remove('on');
  }
});
// 首次任意交互时预热音频上下文（只创建，不改按钮状态，避免与按钮点击互相打架）
addEventListener('pointerdown', () => { if (!audio.ctx) audio.enable().then((ok) => { if (ok) { audioOn = true; btnAudio.textContent = '音效 开'; btnAudio.classList.add('on'); } }); }, { once: true });

addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'l') { e.preventDefault(); if (seq && seq.state === 'idle') { audio.enable(); seq.start(); setCam(1); } }
  else if (k === 'r') { if (seq) { seq.abort(); setCam(0); space.setReveal(0); } }
  else if (k === 'c') { setCam((camMode + 1) % CAMS.length); }
  else if (k === 'f') { camFree ? setCam('follow') : setCam(camMode); }
  else if (k === 'n') { applyNight(env.state.target > 0.5 ? 0 : 1); }
  else if (k === 'h') { hotChk.checked = !hotChk.checked; hotChk.dispatchEvent(new Event('change')); }
});

const tmp = new THREE.Vector3();
let last = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const scaled = dt * timeScale;

  if (seq) seq.update(scaled);
  const alt = seq ? seq.altitude : 0;
  env.update(dt, now * 0.001, alt);

  // 太空层：40 km 起淡入，90 km 全显
  if (space) {
    space.setReveal(spaceReveal(alt));
    space.update(dt, camera.position.y, env.state.night);
  }

  if (!camFree && stackRoot) {
    updateFollow(dt);
  } else if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + dt * 1.5);
    const k = 1 - Math.pow(1 - camAnim.t, 3);
    camera.position.lerpVectors(camAnim.from, camAnim.to, k);
    controls.target.lerpVectors(camAnim.tf, camAnim.tt, k);
    camera.fov = camAnim.f0 + (camAnim.f1 - camAnim.f0) * k;
    camera.updateProjectionMatrix();
    if (camAnim.t >= 1) camAnim = null;
  }

  // 震动：点火后随推力持续，升空后衰减；分离时给一次短促冲击
  if (seq && seq.throttle > 0.4 && seq.altitude < 900) {
    shakeAmp = Math.max(shakeAmp, 0.55 * seq.throttle * (1 - seq.altitude / 900));
  }
  if (shakeAmp > 0.0005) {
    shakeT += dt;
    const f = shakeAmp * Math.exp(-shakeT * 1.2);
    camera.position.x += Math.sin(shakeT * 63.1) * f;
    camera.position.y += Math.sin(shakeT * 71.7) * f * 0.7;
    camera.position.z += Math.sin(shakeT * 57.3) * f;
    shakeAmp *= Math.pow(0.06, dt);
  }

  controls.update();

  if (noteTimer > 0) {
    noteTimer -= dt;
    if (noteTimer <= 0) { const el = document.getElementById('note'); if (el) el.classList.remove('on'); }
  }

  if (seq) {
    const a = seq.altitude;
    if (seq.state === 'liftoff' || seq.state === 'ascent') {
      const T = seq.clock;
      clockEl.textContent = 'T+' + String(Math.floor(T / 60)).padStart(2, '0') + ':' + String(Math.floor(T % 60)).padStart(2, '0');
    }
    if (a < 1000) { altEl.textContent = a.toFixed(0); if (altUEl) altUEl.textContent = 'm'; }
    else { altEl.textContent = (a / 1000).toFixed(2); if (altUEl) altUEl.textContent = 'km'; }
    if (velEl) velEl.textContent = (seq.velocity * 3.6).toFixed(0);
    if (machEl) machEl.textContent = (seq.velocity / 340).toFixed(1);
    if (thrEl) thrEl.textContent = Math.round(seq.throttle * 100);
    const stepKey = a > 40000 ? 'space' : seq.state;
    if (stepKey !== lastStep) {
      lastStep = stepKey;
      const order = ['fuel', 'countdown', 'ignition', 'liftoff', 'ascent', 'space'];
      const idx = order.indexOf(stepKey);
      document.querySelectorAll('#steps .s').forEach((el, i) => {
        el.classList.toggle('on', i === idx);
        el.classList.toggle('done', idx >= 0 && i < idx);
      });
    }
    audio.update(dt, { throttle: seq.throttle, altitude: a, countdown: seq.countdown, mach: seq.velocity / 340 });
  }

  const markerVisible = hotChk.checked && (!seq || seq.altitude < 20000);
  for (const m of markers) {
    if (!markerVisible) { m.el.style.opacity = '0'; continue; }
    tmp.copy(m.pos);
    if (stackRoot && m.pos.y > 12 && m.pos.y < 92 && Math.abs(m.pos.x) < 6) tmp.y += stackRoot.position.y;
    tmp.project(camera);
    const vis = tmp.z < 1;
    m.el.style.opacity = vis ? '1' : '0';
    if (vis) {
      m.el.style.left = ((tmp.x * 0.5 + 0.5) * innerWidth) + 'px';
      m.el.style.top = ((-tmp.y * 0.5 + 0.5) * innerHeight) + 'px';
    }
  }

  composer.render();
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  composerRT.samples = 4;
  bloom.setSize(innerWidth, innerHeight);
});

window.__pad = {
  scene, camera, controls, env, space, renderer, composer, audio,
  seq: () => seq,
  setCam,
  // 测量：箭体在屏幕上的归一化坐标（|x|,|y| < 1 即在画面内）
  probe() {
    if (!stackRoot) return null;
    const v = new THREE.Vector3();
    stackRoot.getWorldPosition(v);
    const ndc = v.clone().project(camera);
    // 箭体包围盒的上下端在屏幕上的位置，用来判断有没有被画面切掉
    const bb = new THREE.Box3().setFromObject(stackRoot);
    const topN = bb.max.clone().project(camera);
    const botN = bb.min.clone().project(camera);
    return {
      state: seq ? seq.state : '',
      alt: seq ? +seq.altitude.toFixed(0) : 0,
      ndc: [+ndc.x.toFixed(3), +ndc.y.toFixed(3)],
      topY: +topN.y.toFixed(3),
      botY: +botN.y.toFixed(3),
      fits: topN.y < 0.96 && botN.y > -0.96,
      inFrame: Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && ndc.z < 1,
      camY: +camera.position.y.toFixed(0),
      fov: +camera.fov.toFixed(0)
    };
  },
  sim(seconds, dt) {
    dt = dt || 1 / 30;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      if (seq) seq.update(dt);
      const a = seq ? seq.altitude : 0;
      env.update(dt, performance.now() * 0.001, a);
      if (space) { space.setReveal(spaceReveal(a)); space.update(dt, camera.position.y, env.state.night); }
      if (!camFree) updateFollow(dt);
    }
    controls.update();
    composer.render();
    return seq ? { state: seq.state, alt: +seq.altitude.toFixed(1), clock: +seq.clock.toFixed(2), throttle: +seq.throttle.toFixed(2), cam: [camera.position.x, camera.position.y, camera.position.z].map(v => +v.toFixed(0)) } : null;
  }
};