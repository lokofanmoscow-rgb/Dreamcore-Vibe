import * as THREE from 'three';

const skyVert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
    gl_Position = p.xyww;
  }`;

const skyFrag = /* glsl */`
  uniform vec3 uTop, uMid, uHorizon, uGround;
  uniform vec3 uSunDir, uSunColor;
  uniform float uSunSize, uSunGlow, uSunGlow2;
  uniform float uCloudCover, uCloudScale, uCloudSoft, uCloudOpacity;
  uniform vec3 uCloudColor, uCloudShade;
  uniform vec2 uWind;
  uniform float uTime, uHaze, uExposure, uMidHeight, uStars;
  uniform vec4 uMoons[3];
  uniform vec3 uMoonColor;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col;
    if (h >= 0.0) {
      col = mix(uHorizon, uMid, smoothstep(0.0, uMidHeight, h));
      col = mix(col, uTop, smoothstep(uMidHeight * 0.6, 1.0, h));
    } else {
      col = mix(uHorizon, uGround, smoothstep(0.0, -0.25, h));
    }

    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(sd, 6.0) * uSunGlow + pow(sd, 48.0) * uSunGlow2);

    // stars for dusk skies
    if (uStars > 0.0 && h > 0.05) {
      vec2 sp = d.xz / (h + 0.3) * 180.0;
      float st = step(0.997, hash(floor(sp))) * smoothstep(0.05, 0.4, h);
      col += vec3(st) * uStars;
    }

    // clouds projected on a dome
    if (uCloudCover > 0.0 && h > 0.0) {
      vec2 p = d.xz / (h + 0.12) * uCloudScale + uWind * uTime;
      float n = fbm(p);
      float n2 = fbm(p * 2.3 + 7.1);
      float cov = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + uCloudSoft, n * 0.75 + n2 * 0.25);
      // light from sun side: sample offset towards the sun
      vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.08;
      float nl = fbm(p + toSun * 3.0);
      float lit = clamp(0.55 + (n - nl) * 3.0, 0.0, 1.0);
      vec3 cc = mix(uCloudShade, uCloudColor, lit);
      cc += uSunColor * pow(sd, 10.0) * 0.6 * (1.0 - cov * 0.5);
      float fadeH = smoothstep(0.0, 0.18, h);
      col = mix(col, cc, cov * fadeH * uCloudOpacity);
    }

    // moons
    for (int i = 0; i < 3; i++) {
      vec4 m = uMoons[i];
      if (m.w <= 0.0) continue;
      vec3 md = normalize(m.xyz);
      float c = dot(d, md);
      float ang = acos(clamp(c, -1.0, 1.0));
      float disc = 1.0 - smoothstep(m.w * 0.92, m.w, ang);
      // limb darkening + subtle craters
      float rr = clamp(ang / m.w, 0.0, 1.0);
      vec3 tang = normalize(cross(md, vec3(0.0, 1.0, 0.0)));
      vec3 bit = cross(tang, md);
      vec2 lp = vec2(dot(d - md, tang), dot(d - md, bit)) / m.w;
      float crater = vnoise(lp * 6.0 + float(i) * 13.0) * 0.18 + vnoise(lp * 15.0) * 0.08;
      vec3 mc = uMoonColor * (1.0 - rr * rr * 0.35 - crater);
      col = mix(col, mc, disc * 0.82);
      col += uMoonColor * 0.06 * (1.0 - smoothstep(m.w, m.w * 2.5, ang));
    }

    // horizon haze
    col = mix(col, uHorizon, uHaze * (1.0 - smoothstep(0.0, 0.1, abs(h))));

    gl_FragColor = vec4(col * uExposure, 1.0);
  }`;

const v3 = (a) => new THREE.Color(a[0], a[1], a[2]);
function colorOf(c) {
  if (c instanceof THREE.Color) return c;
  if (Array.isArray(c)) return v3(c);
  return new THREE.Color(c);
}

export const SKY_DEFAULTS = {
  top: '#2a6fd6',
  mid: '#5aa6ee',
  horizon: '#bfe3ff',
  ground: '#9fbf8f',
  midHeight: 0.35,
  sunDir: [0.4, 0.55, -0.6],
  sunColor: '#fff4dc',
  sunGlow: 0.25,
  sunGlow2: 1.6,
  sunSize: 0.03,
  cloudCover: 0.35,
  cloudScale: 1.1,
  cloudSoft: 0.3,
  cloudOpacity: 0.95,
  cloudColor: '#ffffff',
  cloudShade: '#b9cbe6',
  wind: [0.004, 0.002],
  haze: 0.35,
  exposure: 1.0,
  sunIntensity: 4.0,
  stars: 0.0,
  moons: [],
  moonColor: '#eef1ff',
};

export function createSky(opts = {}) {
  const o = { ...SKY_DEFAULTS, ...opts };
  const moons = [];
  for (let i = 0; i < 3; i++) {
    const m = o.moons[i];
    if (m) {
      const v = new THREE.Vector3(m[0], m[1], m[2]).normalize();
      moons.push(new THREE.Vector4(v.x, v.y, v.z, m[3]));
    } else moons.push(new THREE.Vector4(0, 1, 0, 0));
  }
  const uniforms = {
    uTop: { value: colorOf(o.top) },
    uMid: { value: colorOf(o.mid) },
    uHorizon: { value: colorOf(o.horizon) },
    uGround: { value: colorOf(o.ground) },
    uMidHeight: { value: o.midHeight },
    uSunDir: { value: new THREE.Vector3(...o.sunDir).normalize() },
    uSunColor: { value: colorOf(o.sunColor) },
    uSunSize: { value: o.sunSize },
    uSunGlow: { value: o.sunGlow },
    uSunGlow2: { value: o.sunGlow2 },
    uCloudCover: { value: o.cloudCover },
    uCloudScale: { value: o.cloudScale },
    uCloudSoft: { value: o.cloudSoft },
    uCloudOpacity: { value: o.cloudOpacity },
    uCloudColor: { value: colorOf(o.cloudColor) },
    uCloudShade: { value: colorOf(o.cloudShade) },
    uWind: { value: new THREE.Vector2(...o.wind) },
    uTime: { value: 0 },
    uHaze: { value: o.haze },
    uExposure: { value: o.exposure },
    uStars: { value: o.stars },
    uMoons: { value: moons },
    uMoonColor: { value: colorOf(o.moonColor) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const geo = new THREE.SphereGeometry(500, 48, 24);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  mesh.userData.update = (dt) => { uniforms.uTime.value += dt; };

  // sun disc as a separate HDR sprite so bloom catches it
  const sunMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: colorOf(o.sunColor).clone().multiplyScalar(o.sunIntensity) } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying vec2 vUv;
      void main(){ float r = length(vUv-0.5)*2.0; float a = smoothstep(1.0,0.85,r); gl_FragColor = vec4(uColor, a); }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sunMat);
  sun.visible = o.sunSize > 0;
  sun.renderOrder = -999;
  sun.frustumCulled = false;
  mesh.add(sun);
  const sunDir = uniforms.uSunDir.value;
  const sunDist = 450;
  const sunScale = 2 * sunDist * Math.tan(o.sunSize);
  mesh.userData.placeSun = (camera) => {
    sun.position.copy(sunDir).multiplyScalar(sunDist).add(camera.position);
    sun.scale.setScalar(sunScale);
    sun.quaternion.copy(camera.quaternion);
  };
  mesh.userData.uniforms = uniforms;
  return mesh;
}

export function skyHorizonColor(opts) {
  return colorOf({ ...SKY_DEFAULTS, ...opts }.horizon);
}
