import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildEnvironment } from './env.js';
import { LaunchSequence } from './rocket.js';

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
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 3000);
camera.position.set(152, 74, 132);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 48, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 26;
controls.maxDistance = 460;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 0.55;

const env = buildEnvironment(scene, renderer);
scene.userData.cam = camera;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.52, 0.72, 0.70);
composer.addPass(bloom);
composer.addPass(new OutputPass());

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

const tip = document.getElementById('tip');
const markers = [];
const markerGroup = new THREE.Group();
scene.add(markerGroup);
for (const h of HOTSPOTS) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;width:9px;height:9px;border-radius:50%;background:#59c2ff;box-shadow:0 0 0 3px rgba(89,194,255,.22),0 0 14px rgba(89,194,255,.8);transform:translate(-50%,-50%);pointer-events:none;transition:opacity .2s';
  document.body.appendChild(el);
  markers.push({ el, pos: new THREE.Vector3(...h.p), info: h });
}

let gltfRoot = null, rocketPivot = null, arms = [];
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
        m.envMapIntensity = 0.85;
        if (m.name === 'Lamp') m.emissiveIntensity = 3.2;
        if (m.name === 'RocketWhite') { m.color.setHex(0xeef0f3); m.metalness = 0.08; m.roughness = 0.52; }
        if (m.name === 'TankWhite') { m.color.setHex(0xd8dce1); m.metalness = 0.12; m.roughness = 0.45; }
        if (m.name === 'Steel') { m.metalness = 0.6; m.roughness = 0.62; }
        if (m.name === 'SteelDark') { m.metalness = 0.55; m.roughness = 0.55; }
      }
    }
  });
  scene.add(gltfRoot);

  rocketPivot = new THREE.Group();
  const rocketNode = gltfRoot.getObjectByName('Rocket');
  const nozzleNode = gltfRoot.getObjectByName('Rocket_Nozzles');
  if (rocketNode) rocketPivot.add(rocketNode);
  if (nozzleNode) rocketPivot.add(nozzleNode);
  rocketPivot.position.set(0, 0, 0);
  scene.add(rocketPivot);

  for (const n of ['Arm_Low', 'Arm_Mid', 'Arm_High']) {
    const a = gltfRoot.getObjectByName(n);
    if (a) {
      const pivot = new THREE.Group();
      pivot.position.copy(a.position);
      const child = a;
      child.position.set(0, 0, 0);
      pivot.add(child);
      gltfRoot.add(pivot);
      arms.push(pivot);
    }
  }

  seq = new LaunchSequence(scene, rocketPivot, arms, {});
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
  if (name === 'liftoff') { clockEl.textContent = 'T+00:00'; }
  if (PHASES[name]) phaseEl.textContent = PHASES[name];
  if (name === 'idle') { clockEl.textContent = 'T-00:10'; }
  const btn = document.getElementById('btnLaunch');
  if (name === 'fuel') { btn.disabled = true; btn.textContent = '发射中…'; }
  if (name === 'idle') { btn.disabled = false; btn.textContent = '点火发射'; }
}

function bindLaunch() {
  const btn = document.getElementById('btnLaunch');
  btn.addEventListener('click', () => { if (seq && seq.state === 'idle') seq.start(); });
  document.getElementById('btnReset').addEventListener('click', () => { if (seq) seq.abort(); });
}

let camMode = 0;
const CAMS = [
  { pos: [152, 74, 132], tgt: [0, 48, 0], fov: 42 },
  { pos: [22, 30, 46], tgt: [0, 52, 0], fov: 52 },
  { pos: [150, 8, 40], tgt: [0, 70, 0], fov: 40 },
  { pos: [-64, 96, 96], tgt: [0, 40, 0], fov: 48 }
];
document.getElementById('btnCam').addEventListener('click', () => {
  camMode = (camMode + 1) % CAMS.length;
  const c = CAMS[camMode];
  camAnim = { from: camera.position.clone(), to: new THREE.Vector3(...c.pos),
    tf: controls.target.clone(), tt: new THREE.Vector3(...c.tgt), f0: camera.fov, f1: c.fov, t: 0 };
});
let camAnim = null;

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

addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'l') { e.preventDefault(); if (seq && seq.state === 'idle') seq.start(); }
  else if (k === 'r') { if (seq) seq.abort(); }
  else if (k === 'c') { document.getElementById('btnCam').click(); }
  else if (k === 'n') { applyNight(env.state.target > 0.5 ? 0 : 1); }
  else if (k === 'h') { hotChk.checked = !hotChk.checked; hotChk.dispatchEvent(new Event('change')); }
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  mouse.x = e.clientX; mouse.y = e.clientY;
});
const mouse = { x: 0, y: 0 };

const tmp = new THREE.Vector3();
let last = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const scaled = dt * timeScale;

  if (seq) seq.update(scaled);
  env.update(dt, now * 0.001);

  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + dt * 1.5);
    const k = 1 - Math.pow(1 - camAnim.t, 3);
    camera.position.lerpVectors(camAnim.from, camAnim.to, k);
    controls.target.lerpVectors(camAnim.tf, camAnim.tt, k);
    camera.fov = camAnim.f0 + (camAnim.f1 - camAnim.f0) * k;
    camera.updateProjectionMatrix();
    if (camAnim.t >= 1) camAnim = null;
  }

  controls.update();

  if (seq && seq.altitude > 1) {
    const tgt = 34 + Math.min(seq.altitude * 0.55, 190);
    controls.target.y += (tgt - controls.target.y) * Math.min(1, dt * 1.6);
  }

  for (const m of markers) {
    if (!hotChk.checked) { m.el.style.opacity = '0'; continue; }
    tmp.copy(m.pos);
    if (rocketPivot && m.pos.y > 12 && m.pos.y < 92 && Math.abs(m.pos.x) < 6) tmp.y += rocketPivot.position.y;
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
  bloom.setSize(innerWidth, innerHeight);
});

window.__pad = {
  scene, camera, controls, env, renderer, composer,
  seq: () => seq,
  sim(seconds, dt) {
    dt = dt || 1 / 30;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      if (seq) seq.update(dt);
      env.update(dt, performance.now() * 0.001);
    }
    controls.update();
    composer.render();
    return seq ? { state: seq.state, alt: +seq.altitude.toFixed(1), clock: +seq.clock.toFixed(2), throttle: +seq.throttle.toFixed(2) } : null;
  }
};
