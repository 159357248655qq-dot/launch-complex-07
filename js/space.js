import * as THREE from 'three';

// 地球半径（米）。发射台所在的海平面即 y=0，球心在 y=-R。
// 半径决定"看得见多大地平线"：视觉顶点高度约 2500 m 时，
//   R=2600  → 地平线俯角 59°，永远沉在画面外；
//   R=12000 → 地平线俯角 34°，正好落在广角画面下半部，能看清弧形边缘。
export const EARTH_R = 12000;
const CENTER_Y = -EARTH_R;
const CY = CENTER_Y.toFixed(1);

const NOISE_GLSL = [
  'float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0;',
  '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
  'float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);',
  '  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),',
  '                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),',
  '             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),',
  '                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }',
  'float fbm3(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }'
].join('\n');

const EARTH_VERT = [
  'varying vec3 vWorld;',
  'varying vec3 vNormalW;',
  'void main(){',
  '  vec4 wp = modelMatrix * vec4(position, 1.0);',
  '  vWorld = wp.xyz;',
  '  vNormalW = normalize(mat3(modelMatrix) * normal);',
  '  gl_Position = projectionMatrix * viewMatrix * wp;',
  '}'
].join('\n');

const EARTH_FRAG = [
  'varying vec3 vWorld;',
  'varying vec3 vNormalW;',
  'uniform vec3 uSun;',
  'uniform vec3 uSunColor;',
  'uniform float uNight;',
  'uniform float uReveal;',
  NOISE_GLSL,
  'void main(){',
  '  vec3 n = normalize(vWorld - vec3(0.0, ' + CY + ', 0.0));',
  '  float lat = n.y;',
  '  vec3 p = n * 13.0;',
  '  float cont = fbm3(p * 1.35 + vec3(4.2, 1.7, 9.1));',
  '  float detail = fbm3(p * 6.2 + vec3(11.0, 3.3, 2.4));',
  '  float land = smoothstep(0.505, 0.545, cont + detail * 0.06);',
  '  float ice = smoothstep(0.80, 0.94, abs(lat)) * (1.0 - smoothstep(0.93, 0.99, abs(lat)));',
  '  vec3 ocean = mix(vec3(0.012, 0.045, 0.115), vec3(0.02, 0.10, 0.22), detail);',
  '  vec3 soil = mix(vec3(0.10, 0.13, 0.075), vec3(0.30, 0.24, 0.145), detail);',
  '  soil = mix(soil, vec3(0.40, 0.33, 0.20), smoothstep(0.62, 0.86, cont));',
  '  vec3 col = mix(ocean, soil, land);',
  '  col = mix(col, vec3(0.88, 0.92, 0.96), ice);',
  '  // 海岸线微光',
  '  col += vec3(0.05, 0.12, 0.18) * (1.0 - abs(land * 2.0 - 1.0)) * 0.35;',
  '  vec3 sd = normalize(uSun);',
  '  float ndl = dot(n, sd);',
  '  float lit = smoothstep(-0.16, 0.28, ndl);',
  '  // 掠射角处海面镜面反射与视线对齐，pow 高光会被 ACES 直接推成纯白 —— 收窄并压低',
  '  float spec = pow(max(dot(reflect(-sd, n), normalize(cameraPosition - vWorld)), 0.0), 120.0) * (1.0 - land) * 0.5;',
  '  vec3 day = col * (0.14 + lit * 0.78) + uSunColor * spec * 0.16;',
  '  // 夜侧城市灯光（只落在陆地）',
  '  float city = pow(fbm3(p * 22.0 + vec3(7.0)), 3.4) * land * (1.0 - ice);',
  '  vec3 night = vec3(0.02, 0.028, 0.05) + vec3(1.0, 0.72, 0.36) * city * 2.6;',
  '  vec3 outc = mix(night, day, lit);',
  '  // 大气边缘（沿切线方向的散射）',
  '  vec3 vd = normalize(cameraPosition - vWorld);',
  '  float rim = pow(1.0 - max(dot(vd, n), 0.0), 5.5);',
  '  outc += vec3(0.14, 0.30, 0.62) * rim * (0.06 + lit * 0.30);',
  '  // 软上限：0.72 以上按曲线压缩，保留层次而不是一刀切白',
  '  outc = mix(outc, vec3(0.86) * (1.0 - exp(-outc * 1.6)), step(0.62, max(max(outc.r, outc.g), outc.b)));',
  '  gl_FragColor = vec4(outc, uReveal);',
  '}'
].join('\n');

const ATMO_FRAG = [
  'varying vec3 vWorld;',
  'varying vec3 vNormalW;',
  'uniform vec3 uSun;',
  'uniform float uReveal;',
  'void main(){',
  '  vec3 n = normalize(vNormalW);',
  '  vec3 vd = normalize(cameraPosition - vWorld);',
  '  float rim = pow(clamp(1.0 - abs(dot(vd, n)), 0.0, 1.0), 7.0);',
  '  float sun = clamp(dot(n, normalize(uSun)) * 0.5 + 0.5, 0.0, 1.0);',
  '  vec3 col = mix(vec3(0.10, 0.26, 0.68), vec3(0.48, 0.68, 1.0), pow(sun, 3.0));',
  '  float a = rim * (0.05 + 0.55 * sun) * uReveal;',
  '  gl_FragColor = vec4(col * a * 0.34, a * 0.34);',
  '}'
].join('\n');

export function buildSpace(scene, opts) {
  const sunDir = (opts && opts.sun) || new THREE.Vector3(0.66, 0.30, -0.69).normalize();

  const group = new THREE.Group();
  group.name = 'Space';
  group.visible = false;
  scene.add(group);

  // ---- 地球本体 ----
  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir.clone() },
      uSunColor: { value: new THREE.Color(0xffd2a1) },
      uNight: { value: 0 },
      uReveal: { value: 0 }
    },
    vertexShader: EARTH_VERT,
    fragmentShader: EARTH_FRAG,
    transparent: true,
    depthWrite: true
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 256, 144), earthMat);
  earth.position.y = CENTER_Y;
  earth.name = 'Earth';
  group.add(earth);

  // ---- 大气辉光（外侧，从太空看）----
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir.clone() }, uReveal: { value: 0 } },
    vertexShader: EARTH_VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.028, 256, 144), atmoMat);
  atmo.position.copy(earth.position);
  atmo.renderOrder = 2;
  group.add(atmo);

  // ---- 云层（贴在球面上方）----
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir.clone() }, uReveal: { value: 0 } },
    vertexShader: EARTH_VERT,
    fragmentShader: [
      'varying vec3 vWorld;',
      'varying vec3 vNormalW;',
      'uniform vec3 uSun;',
      'uniform float uReveal;',
      NOISE_GLSL,
      'void main(){',
      '  vec3 n = normalize(vWorld - vec3(0.0, ' + (CENTER_Y + 12).toFixed(1) + ', 0.0));',
      '  vec3 p = n * 22.0;',
      '  float c = fbm3(p * 2.4 + vec3(3.0, 8.0, 1.0));',
      '  float c2 = fbm3(p * 8.5 + vec3(12.0, 2.0, 6.0));',
      '  float a = smoothstep(0.52, 0.80, c * 0.75 + c2 * 0.25);',
      '  // 掠射角处视线穿过云层的路径变长，alpha 会累积成白环 —— 按视线与法线夹角淡出',
      '  vec3 vdir = normalize(cameraPosition - vWorld);',
      '  // 掠射角处球壳边缘会织成一圈梳齿噪点，门槛必须抬高',
      '  float graze = smoothstep(0.14, 0.58, dot(vdir, n));',
      '  a *= 0.30 * graze;',
      '  if (a < 0.01) discard;',
      '  float lit = smoothstep(-0.18, 0.30, dot(n, normalize(uSun)));',
      '  // 背光侧也要是灰云而不是近黑色，否则会在明亮的地球边缘压出一圈暗弧',
      '  vec3 col = mix(vec3(0.34, 0.37, 0.44), vec3(0.80, 0.82, 0.86), lit);',
      '  gl_FragColor = vec4(col, a * uReveal);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false
  });
  const cloudShell = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.004, 128, 72), cloudMat);
  cloudShell.position.copy(earth.position);
  group.add(cloudShell);

  const state = { reveal: 0, target: 0 };

  function setReveal(v) { state.target = v; }

  function update(dt, camY, night) {
    state.reveal += (state.target - state.reveal) * Math.min(1, dt * 1.4);
    const r = state.reveal;
    group.visible = r > 0.004;
    earthMat.uniforms.uReveal.value = r;
    atmoMat.uniforms.uReveal.value = r;
    cloudMat.uniforms.uReveal.value = r;
    earthMat.uniforms.uNight.value = night;
    earth.visible = atmo.visible = cloudShell.visible = group.visible;
    return r;
  }

  return { group, earth, atmo, cloudShell, setReveal, update, state, sunDir };
}