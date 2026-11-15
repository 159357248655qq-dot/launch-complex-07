import * as THREE from 'three';

const SKY_VERT = [
  'varying vec3 vWorldPos;',
  'void main() {',
  '  vec4 wp = modelMatrix * vec4(position, 1.0);',
  '  vWorldPos = wp.xyz;',
  '  gl_Position = projectionMatrix * viewMatrix * wp;',
  '}'
].join('\n');

const SKY_FRAG = [
  'varying vec3 vWorldPos;',
  'uniform vec3 uZenith;',
  'uniform vec3 uHorizon;',
  'uniform vec3 uGround;',
  'uniform vec3 uSun;',
  'uniform vec3 uSunColor;',
  'uniform float uNight;',
  'void main() {',
  '  vec3 dir = normalize(vWorldPos - cameraPosition);',
  '  float h = dir.y;',
  '  vec3 sd3 = normalize(uSun);',
  '  float az = max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(sd3.x, 0.0, sd3.z))), 0.0);',
  '  vec3 haze = mix(uHorizon, uSunColor, pow(az, 3.0) * 0.55 * (1.0 - uNight * 0.94));',
  '  float t = pow(1.0 - clamp(h / 0.20, 0.0, 1.0), 2.4);',
  '  vec3 col = mix(uZenith, haze, t);',
  '  col = mix(uGround, col, smoothstep(-0.08, 0.01, h));',
  '  float sd = max(dot(dir, sd3), 0.0);',
  '  col += uSunColor * pow(sd, 9000.0) * 1.35 * (1.0 - uNight);',
  '  col += uSunColor * pow(sd, 26.0) * 0.16 * (1.0 - uNight * 0.88);',
  '  float band = smoothstep(0.0, 0.18, h) * (1.0 - smoothstep(0.18, 0.55, h));',
  '  col += uSunColor * band * 0.05 * (0.4 + az * 0.6) * (1.0 - uNight * 0.9);',
  '  vec3 moonDir = normalize(vec3(-sd3.x, 0.55, -sd3.z));',
  '  float md = max(dot(dir, moonDir), 0.0);',
  '  col += vec3(0.55, 0.68, 0.95) * pow(md, 260.0) * 0.55 * uNight;',
  '  col += vec3(0.10, 0.16, 0.30) * pow(md, 8.0) * 0.20 * uNight;',
  '  gl_FragColor = vec4(col, 1.0);',
  '}'
].join('\n');

function noiseTexture(size, base, speck) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 42; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = Math.random() * 2.2 + 0.3;
    g.fillStyle = 'rgba(' + speck + ',' + (Math.random() * 0.22).toFixed(3) + ')';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, y, oct) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); f *= 2.07; amp *= 0.5; }
  return s;
}

// seamless-ish cloud sheet: horizontal wrap by mirroring the noise domain
function cloudTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const vy = y / h;
    for (let x = 0; x < w; x++) {
      const vx = x / w;
      // domain repeats around the sphere; fold x so edges meet
      const fx = (vx < 0.5 ? vx : 1 - vx) * 2;
      const n = fbm(fx * 5.5 + 11.3, vy * 3.4 + 4.7, 5);
      const n2 = fbm(fx * 13.0 + 3.1, vy * 9.0 + 8.2, 4);
      let a = Math.max(0, (n * 0.78 + n2 * 0.22) - 0.56) * 3.2;
      a = Math.min(1, a);
      a = Math.pow(a, 1.7);
      a *= Math.pow(Math.sin(Math.min(1, vy * 1.06) * Math.PI), 0.7);
      const i = (y * w + x) * 4;
      const bright = 236 + n2 * 18;
      img.data[i] = bright; img.data[i + 1] = bright - 2; img.data[i + 2] = bright - 6;
      img.data[i + 3] = Math.round(a * 168);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function buildEnvironment(scene, renderer) {
  const skyUniforms = {
    uZenith: { value: new THREE.Color(0x1b2a4a) },
    uHorizon: { value: new THREE.Color(0xa89b8a) },
    uGround: { value: new THREE.Color(0x3a3630) },
    uSun: { value: new THREE.Vector3(0.66, 0.30, -0.69).normalize() },
    uSunColor: { value: new THREE.Color(0xffd2a1) },
    uNight: { value: 0.0 }
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 48, 24),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false })
  );
  sky.name = 'Sky';
  scene.add(sky);

  // ---- image-based lighting: bake the sky shader into PMREM env maps ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.geometry, sky.material);
  envScene.add(envSky);
  const envDay = pmrem.fromScene(envScene, 0.04).texture;
  const savedZ = skyUniforms.uZenith.value.clone();
  const savedH = skyUniforms.uHorizon.value.clone();
  const savedG = skyUniforms.uGround.value.clone();
  skyUniforms.uZenith.value.setHex(0x04070f);
  skyUniforms.uHorizon.value.setHex(0x13203a);
  skyUniforms.uGround.value.setHex(0x05070b);
  skyUniforms.uNight.value = 1.0;
  const envNight = pmrem.fromScene(envScene, 0.04).texture;
  skyUniforms.uZenith.value.copy(savedZ);
  skyUniforms.uHorizon.value.copy(savedH);
  skyUniforms.uGround.value.copy(savedG);
  skyUniforms.uNight.value = 0.0;
  pmrem.dispose();
  scene.environment = envDay;

  const starGeo = new THREE.BufferGeometry();
  const N = 2400, pos = new Float32Array(N * 3), sz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * 0.92 + 0.02;
    const r = 1200;
    pos[i * 3] = Math.cos(u) * Math.sqrt(1 - v * v) * r;
    pos[i * 3 + 1] = v * r;
    pos[i * 3 + 2] = Math.sin(u) * Math.sqrt(1 - v * v) * r;
    sz[i] = Math.random() * 1.6 + 0.5;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: ['attribute float aSize;', 'varying float vS;', 'void main(){ vS = aSize;', 'vec4 mv = modelViewMatrix * vec4(position,1.0);', 'gl_PointSize = aSize * 2.2;', 'gl_Position = projectionMatrix * mv; }'].join('\n'),
    fragmentShader: ['uniform float uOpacity;', 'varying float vS;', 'void main(){', 'vec2 d = gl_PointCoord - vec2(0.5);', 'float a = smoothstep(0.5, 0.0, length(d));', 'gl_FragColor = vec4(vec3(0.85,0.9,1.0), a * uOpacity * 0.9); }'].join('\n'),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  stars.frustumCulled = false;
  scene.add(stars);

  const groundTex = noiseTexture(512, '#8b8578', '40,38,34');
  groundTex.repeat.set(26, 26);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1100, 96),
    new THREE.MeshStandardMaterial({ map: groundTex, color: 0x9a917f, roughness: 1.0, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  ground.name = 'Ground';
  scene.add(ground);

  const grid = new THREE.GridHelper(560, 56, 0x6f7a86, 0x5c6570);
  grid.material.transparent = true;
  grid.material.opacity = 0.13;
  grid.position.y = 0.02;
  scene.add(grid);

  function ridge(radius, baseH, amp, color) {
    const SEG = 200;
    const pos = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const h = baseH + amp * (0.55 + 0.45 * Math.sin(a * 3.1 + 1.2) * Math.cos(a * 7.7 + 0.4))
        + amp * 0.35 * Math.sin(a * 13.3 + 2.1) + amp * 0.18 * Math.sin(a * 27.1);
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      pos.push(x, -8, z, x, Math.max(6, h), z);
      if (i < SEG) {
        const b = i * 2;
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true }));
    return m;
  }
  const hills = new THREE.Group();
  const ridgeFar = ridge(1080, 34, 78, 0x8d8a86);
  const ridgeNear = ridge(720, 16, 46, 0x6d6f72);
  hills.add(ridgeFar, ridgeNear);
  scene.add(hills);

  // ---- cloud shell ----
  const cloudGeo = new THREE.SphereGeometry(1290, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const cloudTex = cloudTexture(1024, 512);
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: cloudTex },
      uOpacity: { value: 1.0 },
      uTint: { value: new THREE.Color(0xffffff) },
      uSun: skyUniforms.uSun,
      uSunColor: skyUniforms.uSunColor
    },
    vertexShader: [
      'varying vec3 vWorldPos;',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWorldPos = wp.xyz;',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uMap;',
      'uniform float uOpacity;',
      'uniform vec3 uTint;',
      'uniform vec3 uSun;',
      'uniform vec3 uSunColor;',
      'varying vec3 vWorldPos;',
      'void main() {',
      '  vec3 dir = normalize(vWorldPos - cameraPosition);',
      '  float h = dir.y;',
      '  if (h < 0.005) discard;',
      '  float u = atan(dir.z, dir.x) / 6.2831853 + 0.5;',
      '  float v = clamp(h / 0.62, 0.0, 1.0);',
      '  vec4 tex = texture2D(uMap, vec2(u * 3.0, 1.0 - v));',
      '  float a = tex.a * uOpacity * smoothstep(0.0, 0.10, h) * (1.0 - smoothstep(0.55, 0.95, h));',
      '  if (a < 0.004) discard;',
      '  float sd = max(dot(dir, normalize(uSun)), 0.0);',
      '  vec3 col = tex.rgb * uTint + uSunColor * pow(sd, 6.0) * 0.28;',
      '  gl_FragColor = vec4(col, a);',
      '}'
    ].join('\n'),
    transparent: true, depthWrite: false, side: THREE.BackSide, fog: false
  });
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  clouds.name = 'Clouds';
  clouds.renderOrder = -1;
  scene.add(clouds);

  // ---- sun glare sprite ----
  function glareTexture() {
    const s = 256, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g2 = cv.getContext('2d');
    const grd = g2.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0.0, 'rgba(255,244,222,0.95)');
    grd.addColorStop(0.18, 'rgba(255,214,158,0.42)');
    grd.addColorStop(0.5, 'rgba(255,190,130,0.10)');
    grd.addColorStop(1.0, 'rgba(255,180,120,0)');
    g2.fillStyle = grd; g2.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glareTexture(), transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false
  }));
  const sd = skyUniforms.uSun.value.clone().multiplyScalar(1150);
  glare.position.copy(sd);
  glare.scale.setScalar(260);
  scene.add(glare);

  const sun = new THREE.DirectionalLight(0xffd9b0, 2.6);
  sun.position.copy(skyUniforms.uSun.value).multiplyScalar(320);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -140;
  sun.shadow.camera.right = 140;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -120;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 620;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.35;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x9fb8d8, 0x4b4237, 0.85);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(0x8fb4e0, 0.45);
  fill.position.set(180, 90, 160);
  scene.add(fill);

  const moon = new THREE.DirectionalLight(0x9fc0ff, 0.0);
  moon.position.set(140, 190, 210);
  scene.add(moon);

  const flood = new THREE.Group();
  const lampPositions = [[21.2, 26.3, 21.2], [-21.2, 26.3, 21.2], [21.2, 26.3, -21.2], [-21.2, 26.3, -21.2]];
  const spots = [];
  for (const p of lampPositions) {
    const s = new THREE.SpotLight(0xffd9a0, 0.0, 260, Math.PI / 7.5, 0.55, 1.6);
    s.position.set(p[0], p[1], p[2]);
    s.target.position.set(0, 40, 0);
    flood.add(s); flood.add(s.target);
    spots.push(s);
  }
  scene.add(flood);

  scene.fog = new THREE.FogExp2(0xbcb0a0, 0.00085);

  const state = { night: 0, target: 0 };

  const dayZenith = new THREE.Color(0x14498f), dayHorizon = new THREE.Color(0xd3c3a4), dayGround = new THREE.Color(0x4a453b);
  const nightZenith = new THREE.Color(0x04070f), nightHorizon = new THREE.Color(0x13203a), nightGround = new THREE.Color(0x05070b);

  function setNight(v) { state.target = v; }

  function update(dt, t) {
    state.night += (state.target - state.night) * Math.min(1, dt * 2.2);
    const n = state.night;
    const wantEnv = n > 0.5 ? envNight : envDay;
    if (scene.environment !== wantEnv) scene.environment = wantEnv;
    skyUniforms.uZenith.value.copy(dayZenith).lerp(nightZenith, n);
    skyUniforms.uHorizon.value.copy(dayHorizon).lerp(nightHorizon, n);
    skyUniforms.uGround.value.copy(dayGround).lerp(nightGround, n);
    skyUniforms.uNight.value = n;
    stars.material.uniforms.uOpacity.value = Math.max(0, n * 1.4 - 0.35);
    sun.intensity = 2.6 * (1 - n * 0.96);
    hemi.intensity = 0.85 * (1 - n * 0.70) + 0.16;
    fill.intensity = 0.45 * (1 - n * 0.85) + 0.10 * n;
    moon.intensity = 0.55 * n;
    scene.fog.color.copy(dayHorizon).lerp(new THREE.Color(0x0a1220), n);
    scene.fog.density = 0.00085 + n * 0.00045;
    for (const s of spots) s.intensity = 24 + n * 460;
    ridgeFar.material.color.setHex(n > 0.5 ? 0x10151d : 0x8d8a86);
    ridgeNear.material.color.setHex(n > 0.5 ? 0x0b1017 : 0x6d6f72);
    clouds.rotation.y = t * 0.0022;
    cloudMat.uniforms.uOpacity.value = 0.95 * (1 - n * 0.97);
    cloudMat.uniforms.uTint.value.setRGB(1, 1 - n * 0.15, 1 - n * 0.3);
    glare.material.opacity = 0.55 * (1 - n * 0.97);
    if (scene.userData.cam) {
      glare.position.copy(scene.userData.cam.position).addScaledVector(skyUniforms.uSun.value, 1150);
    }
  }

  return { sky, stars, sun, hemi, moon, spots, clouds, glare, setNight, update, state };
}
