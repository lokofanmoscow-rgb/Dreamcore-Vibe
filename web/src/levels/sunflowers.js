import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase } from './common.js';
import { Terrain, grassLayers } from '../core/terrain.js';
import { makeNoise2D, fbm2, smoothstep } from '../core/noise.js';
import { sunflowerHeadTexture, leafTexture, dirtTexture, leafyTexture } from '../core/textures.js';
import { bench, scarecrow } from '../props/props.js';

export const skyOpts = {
  top: '#2f78c8', mid: '#5aa3dc', horizon: '#a9d3ec', midHeight: 0.35,
  sunDir: [0.3, 0.72, 0.62], sunGlow: 0.15, sunGlow2: 0.9, sunSize: 0.0,
  cloudCover: 0.0, haze: 0.3,
  moons: [[0.07, 0.42, -0.9, 0.035], [0.16, 0.33, -0.93, 0.05], [-0.02, 0.5, -0.86, 0.016]],
  moonColor: '#e9ecf7',
};

const SX = 0.95, SZ = 0.75; // row spacing / plant spacing
const H0 = 1.9;             // nominal stem height of the body geometry

function headGeometry(R = 0.34, rings = 6, segs = 22, cup = 0.5) {
  const pos = [], uv = [], idx = [];
  pos.push(0, 0, 0.02); uv.push(0.5, 0.5);
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * R;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * rr, Math.sin(a) * rr, -cup * rr * rr + (r === 1 ? 0.015 : 0));
      uv.push(0.5 + 0.5 * (rr / R) * Math.cos(a), 0.5 + 0.5 * (rr / R) * Math.sin(a));
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segs));
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs, a1 = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a1 + s, a1 + s1, a0 + s, a1 + s1, a0 + s1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function leafGeometry(y, yaw) {
  const g = new THREE.PlaneGeometry(0.32, 0.42, 1, 3);
  g.translate(0, 0.21, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const yy = p.getY(i); p.setZ(i, yy * yy * 0.9); }
  g.rotateX(-1.0);
  g.rotateY(yaw);
  g.translate(0, y, 0);
  g.computeVertexNormals();
  return g;
}

function bodyGeometry(leaves) {
  const stem = new THREE.CylinderGeometry(0.022, 0.032, H0, 5, 1, true).translate(0, H0 / 2, 0);
  if (!leaves) return stem;
  const parts = [stem.toNonIndexed()];
  const n = leaves;
  for (let k = 0; k < n; k++) parts.push(leafGeometry(H0 * (0.3 + k * (0.42 / n)), k * 2.3 + 0.4).toNonIndexed());
  return mergeGeometries(parts);
}

// all sunflower placement happens in the vertex shader on a world grid around
// the camera, so the field is endless and never needs to be rebuilt
const plantGLSL = /* glsl */`
  uniform vec2 uCamCell, uGrid, uSpacing, uFieldMin, uFieldSize;
  uniform vec3 uCam;
  uniform vec4 uRange;     // inner radius, outer radius, jitter, scale
  uniform float uStride, uTime, uIsHead;
  uniform sampler2D uField;
  attribute vec2 aCell;
  varying float vPlantShade;
  float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
  void plant(out vec3 base, out mat3 R, out float sc, out vec3 top, out vec2 sway) {
    vec2 cell = uCamCell + (aCell - floor(uGrid * 0.5)) * uStride;
    float r1 = hsh(cell), r2 = hsh(cell + 17.31), r3 = hsh(cell + 41.77), r4 = hsh(cell + 73.13);
    vec2 xz = cell * uSpacing + vec2(uSpacing.x * 0.5, 0.0) + (vec2(r1, r2) - 0.5) * vec2(0.24, 0.32);
    vec2 fuv = (xz - uFieldMin) / uFieldSize;
    vec4 f = texture2D(uField, fuv);
    float inside = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
    float d = length(xz - uCam.xz);
    float th = (r3 - 0.5) * uRange.z;
    float alive = step(uRange.x + th, d) * step(d, uRange.y + th) * step(f.b, 0.22) * inside;
    float hgt = 1.55 + r4 * 0.7;
    base = vec3(xz.x, f.r, xz.y);
    vec3 tilt = vec3((r2 - 0.5) * 0.08, 0.0, (r1 - 0.5) * 0.08);
    top = base + vec3(tilt.z * -hgt * 0.5, hgt, tilt.x * hgt * 0.5);
    float sw = sin(uTime * 1.2 + xz.x * 0.35 + xz.y * 0.22) + 0.4 * sin(uTime * 2.3 + xz.y * 0.9);
    sway = vec2(sw * 0.05, sw * 0.025);
    vPlantShade = 0.85 + r3 * 0.3;
    if (uIsHead > 0.5) {
      R = rotY((r3 - 0.5) * 0.6) * rotX(-0.25 - r2 * 0.35) * rotZ((r4 - 0.5) * 0.4);
      sc = alive * (0.85 + r1 * 0.35) * uRange.w;
    } else {
      R = rotY(r1 * 6.2831) * rotX(tilt.x) * rotZ(tilt.z);
      sc = alive * hgt / ${H0.toFixed(2)};
    }
  }`;

const plantTransform = /* glsl */`
  vec3 transformed;
  if (uIsHead > 0.5) {
    transformed = pTop + pR * (position * pSc);
    transformed.xz += pSway * step(0.001, pSc);
  } else {
    vec3 lp = position * pSc;
    transformed = pBase + pR * lp;
    float swk = clamp(lp.y / 2.2, 0.0, 1.0);
    transformed.xz += pSway * swk * swk;
  }`;
const plantCall = 'vec3 pBase, pTop; mat3 pR; float pSc; vec2 pSway;\n plant(pBase, pR, pSc, pTop, pSway);';

function injectPlant(mat, uniforms, isHead, depth = false) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.uniforms.uIsHead = { value: isHead ? 1 : 0 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + plantGLSL);
    if (depth) {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', plantCall + plantTransform);
    } else {
      sh.vertexShader = sh.vertexShader
        .replace('#include <beginnormal_vertex>', plantCall + '\n vec3 objectNormal = pR * normal;')
        .replace('#include <begin_vertex>', plantTransform);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPlantShade;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= vPlantShade;
          ${isHead ? `if (!gl_FrontFacing) {
            float rr = length(vMapUv - 0.5);
            diffuseColor.rgb = mix(vec3(0.24, 0.38, 0.14), diffuseColor.rgb, smoothstep(0.19, 0.25, rr));
          }` : ''}`);
    }
    if (depth) {
      // depth shaders need the varying declared too (unused)
      sh.vertexShader = sh.vertexShader;
    }
  };
  mat.customProgramCacheKey = () => `plant${isHead}${depth}`;
  return mat;
}

class SunflowerLayer {
  constructor({ inner, outer, jitter, stride, headGeo, bodyGeo, headMat, bodyMat, headDepth, bodyDepth, field, scale = 1, shadows = true }) {
    const n = Math.ceil(((outer + jitter) * 2) / (SX * stride)) + 2;
    const m = Math.ceil(((outer + jitter) * 2) / (SZ * stride)) + 2;
    const cells = new Float32Array(n * m * 2);
    let k = 0;
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { cells[k++] = i; cells[k++] = j; }
    this.stride = stride;
    this.uniforms = {
      uCamCell: { value: new THREE.Vector2() },
      uGrid: { value: new THREE.Vector2(n, m) },
      uSpacing: { value: new THREE.Vector2(SX, SZ) },
      uFieldMin: { value: field.fieldMin },
      uFieldSize: { value: field.fieldSize },
      uField: { value: field.fieldTex },
      uCam: { value: new THREE.Vector3() },
      uRange: { value: new THREE.Vector4(inner, outer, jitter, scale) },
      uStride: { value: stride },
      uTime: { value: 0 },
    };
    this.meshes = [];
    const make = (src, mat, depthMat, isHead) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = src.index;
      for (const key of Object.keys(src.attributes)) g.setAttribute(key, src.attributes[key]);
      g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
      g.instanceCount = n * m;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mm = mat.clone();
      injectPlant(mm, this.uniforms, isHead);
      const mesh = new THREE.Mesh(g, mm);
      mesh.frustumCulled = false;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      if (shadows) {
        const dm = depthMat.clone();
        injectPlant(dm, this.uniforms, isHead, true);
        mesh.customDepthMaterial = dm;
      }
      this.meshes.push(mesh);
    };
    make(bodyGeo, bodyMat, bodyDepth, false);
    make(headGeo, headMat, headDepth, true);
  }

  update(dt, cam) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(cam);
    const s = this.stride;
    u.uCamCell.value.set(Math.floor(cam.x / (SX * s)) * s, Math.floor(cam.z / (SZ * s)) * s);
  }
}

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  L.def.skyOpts = skyOpts;
  const q = ctx.q;
  const noise = makeNoise2D(5);

  // ---------------------------------------------------------------- layout
  const crossZ = [70, -30, -130];
  const sideX = [-100, 100];
  const clearings = [
    { x: 0, z: 118, r: 9 },          // start
    { x: 0, z: -205, r: 9 },         // end of the main path (locked door)
    { x: -170, z: -30, r: 8 },       // west (locked door)
    { x: 170, z: 70, r: 8 },         // east (locked door)
    { x: 100, z: -130, r: 9 },       // the real door
    { x: -100, z: 70, r: 7 },
    { x: -60, z: -170, r: 7 },       // hidden glade, no path
    { x: 140, z: -60, r: 6 },        // hidden glade, no path
  ];
  const pathDist = (x, z) => {
    let d = Math.hypot(x, Math.max(0, z - 120, -205 - z));
    for (const cz of crossZ) d = Math.min(d, Math.hypot(z - cz, Math.max(0, Math.abs(x) - 170)));
    for (const sx of sideX) d = Math.min(d, Math.hypot(x - sx, Math.max(0, z - 70, -130 - z)));
    return d;
  };
  const clearD = (x, z) => {
    let best = Infinity;
    for (const c of clearings) best = Math.min(best, Math.hypot(x - c.x, z - c.z) - c.r);
    return best;
  };
  const height = (x, z) => fbm2(noise, x * 0.01, z * 0.01, 3) * 1.4 + fbm2(noise, x * 0.003 + 9, z * 0.003, 2) * 8 * smoothstep(230, 330, Math.hypot(x, z + 40));
  const open = (x, z) => Math.max(1 - smoothstep(1.0, 1.9, pathDist(x, z)), 1 - smoothstep(0, 1.2, clearD(x, z)));
  const terrain = new Terrain({
    size: 720, segments: 200, fieldRes: 720, height,
    grass: (x, z) => 0.3 * (1 - open(x, z)) + 0.55 * smoothstep(1.3, 2.4, pathDist(x, z)) * (1 - smoothstep(2.4, 3.5, pathDist(x, z))),
    path: (x, z) => open(x, z),
    tint: (x, z) => 0.35 + 0.3 * fbm2(noise, x * 0.05, z * 0.05, 2),
    groundTex: leafyTexture('#7a8a44', 'fieldGround'),
    pathTex: dirtTexture('#e6caa2'),
    groundRepeat: 0.4,
    pathRepeat: 0.3,
  });
  L.add(terrain.mesh);
  L.groundHeight = height;
  L.surface = (x, z) => (open(x, z) > 0.5 ? 'dirt' : 'grass');

  const grass = grassLayers(terrain, q, { height: 0.32, width: 0.07, base: '#3e5f1c', tip: '#a7c45a', densityMul: 0.45 });
  grass.meshes.forEach((m) => L.add(m));

  L.setupSky(skyOpts);
  L.setupSun({ dir: skyOpts.sunDir, color: '#fff1d8', intensity: 2.8, area: 28 });
  L.setupHemi('#bcdcf2', '#8a7a4a', 1.15);
  L.setupFog('#b5d6ea', 30, 230);
  L.envFromSky(0.5);

  // ---------------------------------------------------------------- the endless sunflowers
  const headMat = new THREE.MeshStandardMaterial({ map: sunflowerHeadTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 });
  const bodyMat = new THREE.MeshStandardMaterial({ map: leafTexture('#5d9a3c'), color: '#ffffff', alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  const stemMat = new THREE.MeshStandardMaterial({ color: '#5e8a3a', roughness: 0.8 });
  const headDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: sunflowerHeadTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
  const bodyDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTexture('#5d9a3c'), alphaTest: 0.5, side: THREE.DoubleSide });
  const plainDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  // leaves share the leaf texture; the stem samples its centre (opaque green)
  const nearBody = bodyGeometry(q.detail >= 1 ? 3 : 2);
  {
    // stem UVs point at the middle of the leaf texture so one material fits all
    const uv = nearBody.attributes.uv;
    const stemVerts = new THREE.CylinderGeometry(0.022, 0.032, H0, 5, 1, true).toNonIndexed().attributes.position.count;
    for (let i = 0; i < stemVerts; i++) uv.setXY(i, 0.4, 0.5);
  }
  const R = {
    low: [10, 26, 0], medium: [14, 34, 62], high: [19, 46, 92], ultra: [24, 56, 115],
  }[ctx.qualityName] || [15, 38, 72];
  const field = terrain;
  const layers = [
    new SunflowerLayer({ inner: -10, outer: R[0], jitter: 5, stride: 1, headGeo: headGeometry(0.34, 4, 16), bodyGeo: nearBody, headMat, bodyMat, headDepth, bodyDepth, field, shadows: q.shadows }),
    new SunflowerLayer({ inner: R[0], outer: R[1], jitter: 5, stride: 1, headGeo: headGeometry(0.34, 2, 10), bodyGeo: bodyGeometry(0), headMat, bodyMat: stemMat, headDepth, bodyDepth: plainDepth, field, shadows: q.shadows && q.detail >= 1 }),
  ];
  if (R[2] > 0) {
    layers.push(new SunflowerLayer({ inner: R[1], outer: R[2], jitter: 5, stride: 2, headGeo: headGeometry(0.34, 2, 9), bodyGeo: bodyGeometry(0), headMat, bodyMat: stemMat, headDepth, bodyDepth: plainDepth, field, scale: 1.3, shadows: false }));
  }
  for (const ly of layers) ly.meshes.forEach((m) => L.add(m));
  L.onUpdate((dt) => {
    const c = ctx.camera.position;
    for (const ly of layers) ly.update(dt, c);
    grass.update(dt, c);
  });

  // ---------------------------------------------------------------- props on the clearings
  const b = bench('#8a6a48');
  b.position.set(4, height(4, 112), 112);
  b.rotation.y = -Math.PI / 2;
  L.add(b);
  for (const [x, z, r] of [[-100, 70, 0.6], [-60, -170, 2.2], [140, -60, -1.0]]) {
    const s = scarecrow();
    s.position.set(x, height(x, z), z);
    s.rotation.y = r;
    L.add(s);
  }

  // doors: locked ones at the ends of the paths, the real one waits on the east-south clearing
  const pink = { color: '#f6a6c8', frameColor: '#f3b6d2' };
  L.makeDecoy(pink, 0, height(0, -207), -207, 0);
  L.makeDecoy(pink, -172, height(-172, -30), -30, Math.PI / 2);
  L.makeDecoy(pink, 172, height(172, 70), 70, -Math.PI / 2);
  L.makeDoor({ color: '#ff9cc6', frameColor: '#ffb4d4', glow: '#ffe6f2', style: 'panel', beacon: true }, 103, height(103, -130), -130, -Math.PI / 2);

  L.spawn = { x: 0, z: 116, yaw: 0, pitch: 0.02 };
  L.menuCam = { x: 0, z: 116, yaw: 0, y: 1.6, pitch: 0.04 };
  L.bounds = { type: 'circle', x: 0, z: -40, r: 245 };
  L.far = 320;
  return L;
}
