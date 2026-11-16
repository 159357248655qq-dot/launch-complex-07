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
  // vdir0 必须最先声明：下面的 horizonK/grazeK/spec 都要用它，
  // 若放在后面会报 "undeclared identifier"，整个地球材质编译失败 → 地球直接不渲染。
  '  vec3 vdir0 = normalize(cameraPosition - vWorld);',
  '  float lat = n.y;',
  '  vec3 p = n * 13.0;',
  '  float cont = fbm3(p * 1.35 + vec3(4.2, 1.7, 9.1));',
  '  float detail = fbm3(p * 6.2 + vec3(11.0, 3.3, 2.4));',
  // 远处一个像素要跨过几十个噪声格子，硬阈值判定会逐像素跳变 0/1 —— 正是地平线上那圈
  // 白梳齿。用屏幕空间导数 fwidth 把过渡带撑到一个像素的尺度，等于免费的解析抗锯齿。
  '  float lw = fwidth(cont) * 1.6 + 0.002;',
  '  float land = smoothstep(0.505 - lw, 0.545 + lw, cont + detail * 0.06);',
  // 中尺度地形分区：从 100 km 看下去只看到几度经纬度，只用一个频率会是一片均匀土色
  '  float biome = fbm3(p * 17.0 + vec3(23.0, 5.5, 14.7));',
  '  float relief = fbm3(p * 42.0 + vec3(2.0, 30.0, 8.0));',
  // 一个像素跨过多个噪声格时，细节项只会变成随机噪点（地平线那圈白梳齿就是它）。
  // 用屏幕空间导数算出当前像素覆盖多少格，超采样了就淡到均值色 —— 等价于自动 LOD。
  // 注意：cont 是低频噪声，fwidth(cont) 在远处也很小，用它算 LOD 等于没算。
  // 真正决定"这个像素跨了多少格"的是视线与法线的夹角：地平线处 dot→0，
  // 一个像素横扫几十公里，任何高频项都只能变成噪点，必须强制压到均值。
  '  float horizonK = 1.0 - smoothstep(0.0, 0.42, dot(vdir0, n));',
  '  float lod = clamp(max(fwidth(relief) * 40.0, horizonK), 0.0, 1.0);',
  '  detail = mix(detail, 0.5, lod);',
  '  biome = mix(biome, 0.5, lod);',
  '  relief = mix(relief, 0.5, lod);',
  '  float ice = smoothstep(0.80, 0.94, abs(lat)) * (1.0 - smoothstep(0.93, 0.99, abs(lat)));',
  '  vec3 ocean = mix(vec3(0.055, 0.175, 0.400), vec3(0.115, 0.345, 0.640), detail);',
  '  vec3 soil = mix(vec3(0.20, 0.25, 0.14), vec3(0.50, 0.42, 0.26), detail);',
  '  soil = mix(soil, vec3(0.40, 0.33, 0.20), smoothstep(0.62, 0.86, cont));',
  // 绿洲 / 荒漠 / 山地 三档分区，让近景有可辨认的地貌而不是一块布
  '  soil = mix(soil, vec3(0.085, 0.145, 0.075), smoothstep(0.42, 0.66, biome) * 0.75);',
  '  soil = mix(soil, vec3(0.42, 0.34, 0.235), smoothstep(0.60, 0.80, biome) * 0.55);',
  '  soil *= 0.86 + relief * 0.32;',
  '  vec3 col = mix(ocean, soil, land);',
  '  col = mix(col, vec3(0.88, 0.92, 0.96), ice);',
  '  // 掠射角（地平线附近）一个像素要跨过几十个噪声格子，高频陆地/海洋判定会抖动成',
  '  // 一圈白斑点。这里按视线-法线夹角淡到只含低频信息的平均色，边缘交给大气壳。',
  // 注意：地平线处 dot(vdir,n) = sqrt(2h/R)，相机 2599 m、R 12000 m 时约 0.66 —— 不是 0。
  // 阈值必须覆盖这个值，否则 grazeK 恒为 1，下面的降频分支等于没写。
  // 地平线处 dot(vdir0,n)≈0.66、圆盘中心=1.0。阈值若从 0.52 起，圆盘 80% 面积都会被
  // 洗成平均色 —— 表现就是"地球是一颗灰蓝玻璃球，看不到陆地"。只该覆盖最外那一圈。
  '  float grazeK = smoothstep(0.615, 0.775, dot(vdir0, n));',
  '  float landLow = smoothstep(0.46, 0.60, fbm3(p * 0.30 + vec3(4.2, 1.7, 9.1)));',
  '  vec3 colSmooth = mix(vec3(0.075, 0.175, 0.370), vec3(0.26, 0.225, 0.155), 0.30 + landLow * 0.10);',
  '  col = mix(colSmooth, col, grazeK);',
  '  // 海岸线微光',
  '  // 海岸线微光必须同样按掠射角淡出：land 在地平线处逐像素跳变 0/1，',
  '  // (1-|2*land-1|) 因此在地平线上随机点亮，正是那圈白梳齿的真凶。',
  '  col += vec3(0.05, 0.12, 0.18) * (1.0 - abs(land * 2.0 - 1.0)) * 0.35 * grazeK * grazeK;',
  '  vec3 sd = normalize(uSun);',
  '  float ndl = dot(n, sd);',
  '  float lit = smoothstep(-0.16, 0.28, ndl);',
  '  // 掠射角处海面镜面反射与视线对齐，pow 高光会被 ACES 直接推成纯白 —— 收窄并压低。',
  '  // 边缘（视线与法线接近垂直）高光方向随像素剧烈扫动，按掠射程度压掉，光交给大气壳。',
  '  float edge = smoothstep(0.10, 0.62, dot(vdir0, n));',
  '  float landM = mix(landLow, land, grazeK);',
  '  float spec = pow(max(dot(reflect(-sd, n), vdir0), 0.0), 120.0) * (1.0 - landM) * 0.34 * edge * edge * edge * grazeK;',
  // 增益不能再高：2.10 叠 ACES(exposure 1.16) + Bloom(0.52) 会把整个盘面推到 175 以上，
  // 海陆对比全被压平成一团灰蓝（实测 71% 像素 >175、std 仅 41）。
  '  vec3 day = col * (0.30 + lit * 1.15) + uSunColor * spec * 0.18;',
  '  // 夜侧城市灯光（只落在陆地）',
  // 城市灯光是全片唯一没做 LOD 的高频项：p*22 的 pow 3.4 硬阈值在地平线处
  // 一个像素横扫几十公里，逐像素随机点亮 —— 这就是弧线内侧那圈暖白斑点的真凶。
  // 必须同时乘 (1-lod) 和 grazeK，并用已经做过 AA 的 landM 代替逐像素跳变的 land。
  '  float city = pow(fbm3(p * 22.0 + vec3(7.0)), 3.4) * landM * (1.0 - ice) * (1.0 - lod) * grazeK;',
  '  vec3 night = vec3(0.02, 0.028, 0.05) + vec3(1.0, 0.72, 0.36) * city * 2.6;',
  '  vec3 outc = mix(night, day, lit);',
  '  // 大气边缘（沿切线方向的散射）',
  '  vec3 vd = normalize(cameraPosition - vWorld);',
  '  float rim = pow(1.0 - max(dot(vd, n), 0.0), 5.5);',
  '  outc += vec3(0.20, 0.42, 0.85) * rim * (0.06 + lit * 0.34) * mix(0.55, 1.0, grazeK);',
  '  // 软上限：0.72 以上按曲线压缩，保留层次而不是一刀切白',
  '  float capK = smoothstep(0.42, 0.92, max(max(outc.r, outc.g), outc.b));',
  '  outc = mix(outc, vec3(0.86) * (1.0 - exp(-outc * 1.6)), capK);',
  // 几何轮廓的硬边只靠 MSAA 压不住，地平线会碎成一圈梳齿。
  // 用极窄的 alpha 渐隐（约 1–2 px）；渐隐露出的背景由大气壳那 45 km 的密度带填住，
  // 两者颜色同为蓝，接缝就看不出来了。不要在这里混亮蓝——那会画出一圈蓝色虚线。
  '  float edgeAA = smoothstep(0.0, 0.014, dot(vd, n));',
  '  gl_FragColor = vec4(outc, uReveal * edgeAA);',
  '}'
].join('\n');

// 大气辉光。原来的写法是"球壳边缘 rim 高光"，光带只能长在**壳**的轮廓上（半径 12336），
// 而地球轮廓在 12000 —— 两者差 336 km，从 183 km 高空看就是画面里那条 12–24 px 的黑缝。
// 改成按视线到地心的最近距离（冲击参数 b）算指数密度：密度峰值就在 b=R，也就是地球轮廓本身，
// 光带天然从地球边缘往外淡出，黑缝消失，而且物理上就是这么回事（大气质量沿视线积分）。
const ATMO_FRAG = [
  'varying vec3 vWorld;',
  'varying vec3 vNormalW;',
  'uniform vec3 uSun;',
  'uniform float uReveal;',
  'void main(){',
  '  vec3 C = vec3(0.0, ' + CY + ', 0.0);',
  '  vec3 ro = cameraPosition;',
  '  vec3 rd = normalize(vWorld - ro);',
  '  vec3 oc = C - ro;',
  '  float tca = dot(oc, rd);',
  '  float b = sqrt(max(dot(oc, oc) - tca * tca, 0.0));',
  '  float hgt = b - ' + EARTH_R.toFixed(1) + ';',
  // 圆盘内部（hgt<0）也保持满密度：地球最外几像素 alpha 渐变到 0 时，
  // 底下必须有大气填着，否则露出黑背景 —— 那就是弧线上那圈黑锯齿。
  // 盘面内部（hgt 远小于 0）必须归零：大气在地球后面，被地球挡住。
  // 但轮廓处要保留约 2 px（≈45 km）的渐变密度去填地球 alpha 渐隐露出的背景，否则又是黑锯齿。
  '  float dens = exp(-max(hgt, 0.0) / 130.0) * smoothstep(-45.0, 0.0, hgt);',
  '  vec3 nn = normalize(ro + rd * tca - C);',
  '  float sun = clamp(dot(nn, normalize(uSun)) * 0.5 + 0.5, 0.0, 1.0);',
  '  // 边缘必须是饱和蓝而不是灰白：真实从 100 km 看地球，大气层是一条发光的青蓝弧线',
  '  vec3 col = mix(vec3(0.05, 0.24, 0.95), vec3(0.46, 0.76, 1.0), pow(sun, 3.0));',
  '  float a = dens * (0.10 + 0.90 * sun) * uReveal;',
  '  gl_FragColor = vec4(col * a * 1.10, a * 1.10);',
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
  // 256 段时地球轮廓每段在屏幕上约 5 px，几何锯齿比任何着色器抗锯齿都粗 —— 提到 512。
const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 512, 288), earthMat);
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
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.028, 512, 288), atmoMat);
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
      // 地平线处一个像素要跨几十个云格，高频项会碎成一圈白颗粒 —— 按屏幕空间导数淡掉
      '  float clod = clamp(fwidth(c) * 26.0, 0.0, 1.0);',
      '  c2 = mix(c2, 0.5, clod);',
      '  float a = smoothstep(0.52, 0.80, c * 0.75 + c2 * 0.25);',
      '  // 掠射角处视线穿过云层的路径变长，alpha 会累积成白环 —— 按视线与法线夹角淡出',
      '  vec3 vdir = normalize(cameraPosition - vWorld);',
      '  // 掠射角处球壳边缘会织成一圈梳齿噪点，门槛必须抬高',
      // 云壳半径 12048、相机 2599 m 时，地平线 dot(vdir,n) ≈ 0.66，阈值必须覆盖它
      '  float graze = smoothstep(0.26, 0.78, dot(vdir, n));',
      '  a *= 0.85 * graze;',
      '  if (a < 0.01) discard;',
      '  float lit = smoothstep(-0.18, 0.30, dot(n, normalize(uSun)));',
      '  // 背光侧也要是灰云而不是近黑色，否则会在明亮的地球边缘压出一圈暗弧',
      '  vec3 col = mix(vec3(0.30, 0.34, 0.43), vec3(0.88, 0.90, 0.94), lit);',
      '  float cloudAA = smoothstep(0.0, 0.035, dot(vdir, n));',
      '  gl_FragColor = vec4(col, a * uReveal * cloudAA);',
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