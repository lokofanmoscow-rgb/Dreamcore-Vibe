import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase, floatingMotes } from './common.js';
import { Terrain } from '../core/terrain.js';
import { makeNoise2D, fbm2, smoothstep, mulberry32 } from '../core/noise.js';
import { canvasTexture, glowTexture, concreteTexture, rep } from '../core/textures.js';
import { circleCollider, boxCollider, cyl, bx } from '../props/props.js';

export const skyOpts = {
  top: '#7f9cff', mid: '#f3b4dc', horizon: '#ffe2c6', midHeight: 0.3,
  sunDir: [0.75, 0.14, 0.62], sunColor: '#ffd7a8', sunGlow: 0.5, sunGlow2: 1.6, sunSize: 0.03, sunIntensity: 2.5,
  cloudCover: 0.42, cloudScale: 1.0, cloudSoft: 0.35, cloudColor: '#fff0f4', cloudShade: '#c7a6d8', cloudOpacity: 0.9,
  haze: 0.35, ground: '#f6dce8',
};

function cloudTexture() {
  const S = 256;
  return canvasTexture(S, S, (c) => {
    const img = c.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const v = 235 + Math.random() * 20;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v - 6; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  });
}

// lumpy cloud puff made from displaced spheres
function puff(rnd, size = 3, count = 7) {
  const geos = [];
  for (let i = 0; i < count; i++) {
    const r = size * (0.45 + rnd() * 0.45);
    const g = new THREE.IcosahedronGeometry(r, 3);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = 1 + 0.08 * Math.sin(x * 2.1 + y * 1.3) * Math.cos(z * 1.7 - y);
      p.setXYZ(k, x * n, y * n * 0.8, z * n);
    }
    g.translate((rnd() - 0.5) * size * 2.2, (rnd() * 0.6) * size * 0.8, (rnd() - 0.5) * size * 1.6);
    g.deleteAttribute('uv');
    geos.push(g);
  }
  const g = mergeGeometries(geos);
  g.computeVertexNormals();
  return g;
}

const seaFrag = /* glsl */`
  uniform float uTime; uniform vec3 uLit, uShade, uFog; varying vec3 vW;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
  void main() {
    vec2 p = vW.xz * 0.012 + vec2(uTime * 0.004, uTime * 0.002);
    float n = fbm(p);
    float n2 = fbm(p * 2.5 + 3.0 - uTime * 0.003);
    float h = n * 0.7 + n2 * 0.3;
    vec3 col = mix(uShade, uLit, smoothstep(0.35, 0.75, h));
    float d = length(vW.xz);
    col = mix(col, uFog, smoothstep(150.0, 700.0, d));
    gl_FragColor = vec4(col, 1.0);
  }`;

const rainbowFrag = /* glsl */`
  varying vec2 vUv;
  vec3 spectrum(float t) {
    return clamp(vec3(abs(t * 6.0 - 3.0) - 1.0, 2.0 - abs(t * 6.0 - 2.0), 2.0 - abs(t * 6.0 - 4.0)), 0.0, 1.0);
  }
  void main() {
    float t = vUv.y; // across the band
    vec3 c = spectrum(1.0 - t);
    float edge = smoothstep(0.0, 0.2, t) * smoothstep(1.0, 0.8, t);
    float ends = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
    gl_FragColor = vec4(c * edge * ends * 0.28, 1.0);
  }`;

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  L.def.skyOpts = skyOpts;
  const q = ctx.q;
  const noise = makeNoise2D(3);
  const rnd = mulberry32(8);
  const R = 62;

  // stairs to the sky
  const STAIR = { x: 0, z: -18, dirZ: -1, steps: 22, rise: 0.32, run: 0.75, width: 3.0 };
  const stairTopZ = STAIR.z - STAIR.steps * STAIR.run;
  const PLAT = { x0: -3, x1: 3, z0: stairTopZ - 6, z1: stairTopZ, y: STAIR.steps * STAIR.rise };

  const height = (x, z) => {
    const r = Math.hypot(x, z);
    const n = fbm2(noise, x * 0.05, z * 0.05, 3) * 0.6 + fbm2(noise, x * 0.015, z * 0.015, 2) * 1.6;
    const rim = smoothstep(R - 10, R + 4, r) * 4;
    return n + rim - Math.max(0, (r - R - 8) * 0.6);
  };
  const stairH = (x, z) => {
    if (Math.abs(x - STAIR.x) < STAIR.width / 2 && z <= STAIR.z && z > stairTopZ) {
      const k = Math.floor((STAIR.z - z) / STAIR.run) + 1;
      return Math.min(STAIR.steps, k) * STAIR.rise;
    }
    if (x > PLAT.x0 && x < PLAT.x1 && z > PLAT.z0 && z <= PLAT.z1) return PLAT.y;
    return null;
  };
  L.groundHeight = (x, z) => {
    const s = stairH(x, z);
    return s !== null ? Math.max(s, height(x, z)) : height(x, z);
  };
  L.surface = (x, z) => (stairH(x, z) !== null ? 'concrete' : 'cloud');

  const ctex = cloudTexture();
  const terrain = new Terrain({
    size: 200, segments: 140, fieldRes: 128, height,
    grass: () => 0, path: () => 0, tint: () => 0.5,
    groundTex: ctex, pathTex: ctex, groundColor: '#fff4fa', roughness: 1.0, groundRepeat: 0.1,
  });
  L.add(terrain.mesh);

  L.setupSky(skyOpts);
  L.setupSun({ dir: [0.75, 0.38, 0.55], color: '#ffd9b8', intensity: 2.1, area: 34 });
  L.setupHemi('#d9d2ff', '#ffd7e6', 0.75);
  L.setupFog('#f6cfe0', 90, 520);
  L.envFromSky(0.45);

  // sea of clouds below
  const seaU = { uTime: { value: 0 }, uLit: { value: new THREE.Color('#fff2f6') }, uShade: { value: new THREE.Color('#d7b6dc') }, uFog: { value: new THREE.Color('#fbd8e2') } };
  const sea = new THREE.Mesh(new THREE.CircleGeometry(900, 48).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: seaU, fog: false,
    vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vW,1.0); }',
    fragmentShader: seaFrag,
  }));
  sea.position.y = -9;
  L.add(sea);
  L.onUpdate((dt) => { seaU.uTime.value += dt; });

  // puffs
  const puffMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1.0, emissive: '#ffd6e6', emissiveIntensity: 0.06 });
  const puffs = [];
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 18 + rnd() * 55;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 6 && z < 0 && z > PLAT.z0 - 6) continue;
    if (Math.hypot(x, z - 22) < 10 || Math.abs(Math.hypot(x, z - 6) - 11) < 4) continue;
    const s = 1.5 + rnd() * 2.5;
    const m = new THREE.Mesh(puff(rnd, s, 5 + Math.floor(rnd() * 4)), puffMat);
    m.position.set(x, height(x, z) - s * 0.3, z);
    m.castShadow = true;
    m.receiveShadow = true;
    L.add(m);
    if (r < R) L.collide(circleCollider(x, z, s * 1.4));
    puffs.push(m);
  }
  // floating puffs in the sky
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 90 + rnd() * 160;
    const m = new THREE.Mesh(puff(rnd, 6 + rnd() * 8, 7), puffMat);
    m.position.set(Math.cos(a) * r, 10 + rnd() * 45, Math.sin(a) * r);
    m.userData.bob = rnd() * 6;
    m.userData.dynamic = true;
    L.add(m);
    puffs.push(m);
  }
  L.onUpdate((dt, t) => {
    for (const p of puffs) if (p.userData.bob !== undefined) p.position.y += Math.sin(t * 0.2 + p.userData.bob) * dt * 0.15;
  });

  // marble: columns ring + the staircase
  const marble = rep(concreteTexture('#f7f1f4'), 1, 2);
  const marbleMat = new THREE.MeshStandardMaterial({ map: marble, roughness: 0.35, color: '#ffffff' });
  const colGeo = [];
  const ringR = 11;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR + 6;
    if (i === 7 || i === 2) continue; // gaps: one towards the start, one towards the stairs
    const h = i % 3 === 0 ? 2.5 + rnd() * 1.5 : 6.5;
    const y = height(x, z) - 0.3;
    colGeo.push(cyl(0.42, 0.48, h, x, y + h / 2 + 0.3, z, 18), bx(1.2, 0.3, 1.2, x, y + 0.15, z));
    if (h > 6) colGeo.push(bx(1.2, 0.35, 1.2, x, y + h + 0.45, z));
    L.collide(circleCollider(x, z, 0.6));
  }
  // stairs
  for (let k = 0; k < STAIR.steps; k++) {
    const zc = STAIR.z - (k + 0.5) * STAIR.run;
    const y = (k + 1) * STAIR.rise;
    colGeo.push(bx(STAIR.width, y + 1.2, STAIR.run, STAIR.x, y - (y + 1.2) / 2, zc));
  }
  colGeo.push(bx(PLAT.x1 - PLAT.x0, 1.6, PLAT.z1 - PLAT.z0, (PLAT.x0 + PLAT.x1) / 2, PLAT.y - 0.8, (PLAT.z0 + PLAT.z1) / 2));
  // little balusters on the platform edge
  for (let x = PLAT.x0 + 0.3; x <= PLAT.x1 - 0.2; x += 0.6) colGeo.push(cyl(0.07, 0.09, 0.8, x, PLAT.y + 0.4, PLAT.z0 + 0.2, 8));
  colGeo.push(bx(PLAT.x1 - PLAT.x0, 0.12, 0.3, 0, PLAT.y + 0.85, PLAT.z0 + 0.2));
  const cols = new THREE.Mesh(mergeGeometries(colGeo.map((g) => { g.deleteAttribute('uv'); return g; })), marbleMat);
  cols.castShadow = true;
  cols.receiveShadow = true;
  L.add(cols);
  // stairs block from the sides when standing beside them (only below a certain height)
  L.collide(boxCollider(STAIR.x - STAIR.width / 2 - 0.15, (STAIR.z + stairTopZ) / 2 - 3, 0.2, STAIR.steps * STAIR.run - 6));
  L.collide(boxCollider(STAIR.x + STAIR.width / 2 + 0.15, (STAIR.z + stairTopZ) / 2 - 3, 0.2, STAIR.steps * STAIR.run - 6));

  // rainbow
  const rb = new THREE.Mesh(new THREE.RingGeometry(150, 175, 96, 1, 0, Math.PI), new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vec3 p = position; float a = atan(p.y, p.x); float r = length(p.xy); vUv = vec2(a / 3.14159, (r - 150.0) / 25.0); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: rainbowFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  }));
  rb.position.set(-90, -30, -250);
  rb.rotation.y = 0.35;
  L.add(rb);

  // doors: decoys stand on the clouds, the real one waits at the top of the stairs
  const decoys = [[-22, 8, 1.2], [24, -4, -1.6], [-12, 30, 2.6], [20, 26, -2.4]];
  const pastel = ['#ffd1e8', '#d7d0ff', '#fff2b8', '#c8f2e6'];
  decoys.forEach(([x, z, r], i) => L.makeDecoy({ color: pastel[i], frameColor: '#ffffff' }, x, height(x, z) - 0.05, z, r));
  L.makeDoor({ color: '#ffffff', frameColor: '#ffe6f2', glow: '#fff0d6', style: 'panel' }, 0, PLAT.y, PLAT.z0 + 2.2, 0);

  const sparkle = floatingMotes(Math.round(220 * q.particles), { color: '#fff0f8', size: 0.07, area: 16, height: 7, speed: 0.1, opacity: 0.8, tex: glowTexture() });
  L.add(sparkle);
  L.onUpdate((dt, t, player) => sparkle.userData.update(t, player.pos, player.pos.y - 1));

  L.bounds = { type: 'circle', x: 0, z: 0, r: R };
  L.spawn = { x: 0, z: 22, yaw: 0, pitch: 0.12 };
  L.menuCam = { x: 3, z: 26, yaw: 0.05, y: 1.6, pitch: 0.15 };
  L.far = 1100;
  return L;
}
