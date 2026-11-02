import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { grassGroundTexture, dirtTexture, noiseDataTexture } from './textures.js';

// A heightfield terrain + a "field" texture (height, grass density, path blend,
// tint) that both the ground material and the GPU grass read from.
export class Terrain {
  constructor({
    size = 300,
    segments = 160,
    fieldRes = 256,
    height = () => 0,
    grass = () => 1,
    path = () => 0,
    tint = () => 0.5,
    groundTex = null,
    pathTex = null,
    groundRepeat = 0.25,
    pathRepeat = 0.35,
    groundColor = '#ffffff',
    roughness = 0.95,
    receiveShadow = true,
    outer = null,
  }) {
    this.size = size;
    this.heightFn = height;
    this.grassFn = grass;
    this.pathFn = path;
    this.min = -size / 2;

    // field data texture (half float, linear filtered)
    const N = fieldRes;
    const data = new Uint16Array(N * N * 4);
    const toH = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = this.min + (i + 0.5) / N * size;
        const z = this.min + (j + 0.5) / N * size;
        const k = (j * N + i) * 4;
        data[k] = toH(height(x, z));
        data[k + 1] = toH(Math.max(0, Math.min(1, grass(x, z))));
        data[k + 2] = toH(Math.max(0, Math.min(1, path(x, z))));
        data[k + 3] = toH(tint(x, z));
      }
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.fieldTex = tex;
    this.fieldMin = new THREE.Vector2(this.min, this.min);
    this.fieldSize = new THREE.Vector2(size, size);

    // mesh
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, height(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();

    const gTex = groundTex || grassGroundTexture();
    const pTex = pathTex || dirtTexture();
    const mat = new THREE.MeshStandardMaterial({
      color: groundColor,
      map: gTex,
      roughness,
      metalness: 0,
    });
    const uniforms = {
      uField: { value: tex },
      uFieldMin: { value: this.fieldMin },
      uFieldSize: { value: this.fieldSize },
      uPathMap: { value: pTex },
      uGroundRepeat: { value: groundRepeat },
      uPathRepeat: { value: pathRepeat },
      uNoise: { value: noiseDataTexture() },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos;
          uniform sampler2D uField, uPathMap, uNoise;
          uniform vec2 uFieldMin, uFieldSize;
          uniform float uGroundRepeat, uPathRepeat;`)
        .replace('#include <map_fragment>', `
          vec2 fuv = (vWPos.xz - uFieldMin) / uFieldSize;
          vec4 field = texture2D(uField, fuv);
          vec4 g1 = texture2D(map, vWPos.xz * uGroundRepeat);
          vec4 g2 = texture2D(map, vWPos.xz * uGroundRepeat * 0.21 + 0.37);
          vec3 gcol = mix(g1.rgb, g2.rgb, 0.35);
          float big = texture2D(uNoise, vWPos.xz * 0.004).r;
          gcol *= 0.82 + big * 0.36 + (field.a - 0.5) * 0.3;
          vec3 pcol = texture2D(uPathMap, vWPos.xz * uPathRepeat).rgb;
          float pn = texture2D(uNoise, vWPos.xz * 0.05).g;
          float pb = smoothstep(0.35, 0.65, field.b + (pn - 0.5) * 0.35);
          diffuseColor.rgb *= mix(gcol, pcol, pb);
        `);
    };
    mat.customProgramCacheKey = () => 'terrain';
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = receiveShadow;
    this.mesh.name = 'terrain';
    if (outer) {
      // coarse ring for far hills; sunk below the detailed terrain inside its area
      const og = new THREE.PlaneGeometry(outer.size, outer.size, outer.segments, outer.segments);
      og.rotateX(-Math.PI / 2);
      const op = og.attributes.position;
      const lim = size / 2 - 1;
      for (let i = 0; i < op.count; i++) {
        const x = op.getX(i), z = op.getZ(i);
        const inside = Math.abs(x) < lim && Math.abs(z) < lim;
        op.setY(i, height(x, z) - (inside ? 4 : 0));
      }
      og.computeVertexNormals();
      const om = new THREE.Mesh(og, mat);
      om.name = 'terrain-outer';
      this.mesh.add(om);
    }
  }

  heightAt(x, z) { return this.heightFn(x, z); }
}

// ----------------------------------------------------------------- grass
function bladeGeometry(segments = 4) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const w = (1 - Math.pow(t, 1.4)) * 0.5;
    if (i < segments) {
      pos.push(-w, t, 0, w, t, 0);
    } else {
      pos.push(0, 1, 0);
    }
  }
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const last = (segments - 1) * 2;
  idx.push(last, last + 1, segments * 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const normals = [];
  for (let i = 0; i < pos.length / 3; i++) normals.push(0, 0, 1);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor({
    terrain,
    count = 60000,
    patch = 50,
    height = 0.55,
    width = 0.09,
    base = '#2f6b1f',
    tip = '#a9de5a',
    wind = 1.0,
    seed = 1,
    shadows = true,
    fadeStart = 0.3,
    inner = 0,
  }) {
    this.terrain = terrain;
    const geo = bladeGeometry(4);
    const rnd = mulberry32(seed);
    const offsets = new Float32Array(count * 2);
    const params = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      offsets[i * 2] = (rnd() - 0.5) * patch;
      offsets[i * 2 + 1] = (rnd() - 0.5) * patch;
      params[i * 4] = rnd() * Math.PI * 2;
      params[i * 4 + 1] = height * (0.55 + rnd() * 0.9);
      params[i * 4 + 2] = width * (0.7 + rnd() * 0.6);
      params[i * 4 + 3] = rnd();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const uniforms = {
      uField: { value: terrain.fieldTex },
      uFieldMin: { value: terrain.fieldMin },
      uFieldSize: { value: terrain.fieldSize },
      uCenter: { value: new THREE.Vector2() },
      uPatch: { value: patch },
      uFadeStart: { value: fadeStart },
      uInner: { value: inner },
      uTime: { value: 0 },
      uWind: { value: wind },
      uNoise: { value: noiseDataTexture() },
      uBase: { value: new THREE.Color(base) },
      uTip: { value: new THREE.Color(tip) },
    };
    this.uniforms = uniforms;

    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aOffset;
          attribute vec4 aParams;
          uniform sampler2D uField, uNoise;
          uniform vec2 uFieldMin, uFieldSize, uCenter;
          uniform float uPatch, uTime, uWind, uFadeStart, uInner;
          uniform vec3 uBase, uTip;
          varying vec3 vGrassCol;`)
        .replace('#include <beginnormal_vertex>', `
          vec2 rel = mod(aOffset - uCenter + uPatch * 0.5, uPatch) - uPatch * 0.5;
          vec2 wxz = uCenter + rel;
          vec2 fuv = (wxz - uFieldMin) / uFieldSize;
          vec4 field = texture2D(uField, fuv);
          float inside = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
          float dist = length(rel);
          float fade = 1.0 - smoothstep(uPatch * uFadeStart, uPatch * 0.5, dist);
          fade *= smoothstep(uInner * 0.7, uInner, dist);
          float keep = step(aParams.w, field.g) * inside;
          float sH = aParams.y * fade * keep * (0.55 + 0.45 * field.g);
          float ca = cos(aParams.x), sa = sin(aParams.x);
          vec3 objectNormal = normalize(vec3(sa * 0.35, 1.0, ca * 0.35));
        `)
        .replace('#include <begin_vertex>', `
          float hN = position.y;
          vec3 p = vec3(position.x * aParams.z, position.y * sH, 0.0);
          p = vec3(p.x * ca, p.y, -p.x * sa);
          float gust = texture2D(uNoise, wxz * 0.015 + vec2(uTime * 0.035, uTime * 0.02)).r;
          float w1 = sin(uTime * 1.6 + wxz.x * 0.35 + wxz.y * 0.22 + aParams.x);
          float bend = (0.18 + aParams.w * 0.25 + (w1 * 0.15 + gust * 0.9) * uWind) * hN * hN * sH;
          vec2 wdir = normalize(vec2(0.8, 0.45));
          p.xz += wdir * bend + vec2(sa, ca) * 0.08 * hN * hN * sH;
          p.y -= bend * bend * 0.35;
          vec3 transformed = vec3(wxz.x, field.r, wxz.y) + p;
          float ao = mix(0.35, 1.0, smoothstep(0.0, 0.7, hN));
          vec3 gc = mix(uBase, uTip, smoothstep(0.0, 1.0, hN)) * (0.82 + aParams.w * 0.32 + (field.a - 0.5) * 0.4);
          float dry = fract(aParams.w * 17.31);
          gc = mix(gc, gc * vec3(1.25, 1.05, 0.55), step(0.82, dry) * 0.6 * hN);
          gc = mix(gc, gc * vec3(0.7, 0.85, 0.75), step(dry, 0.18) * 0.5);
          gc *= 0.9 + gust * 0.25;
          vGrassCol = gc * ao;
        `);
      sh.fragmentShader = '#undef DOUBLE_SIDED\n' + sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassCol;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb *= vGrassCol;');
    };
    mat.customProgramCacheKey = () => 'grass';
    this.patch = patch;
    this.material = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = shadows;
    mesh.castShadow = false;
    mesh.name = 'grass';
    this.mesh = mesh;
  }

  update(dt, camPos) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCenter.value.set(camPos.x, camPos.z);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// Scatter small flower sprites (crossed quads) on the terrain.
export function scatterFlowers({ terrain, count, area, texture, size = 0.25, seed = 3, filter = () => true, color = '#ffffff' }) {
  const rnd = mulberry32(seed);
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const q2 = quad.clone().rotateY(Math.PI / 2);
  const geo = mergeTwo(quad, q2);
  const mat = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide, color });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let n = 0;
  for (let tries = 0; tries < count * 4 && n < count; tries++) {
    const x = area[0] + rnd() * (area[2] - area[0]);
    const z = area[1] + rnd() * (area[3] - area[1]);
    if (!filter(x, z)) continue;
    const sc = size * (0.6 + rnd() * 0.8);
    p.set(x, terrain.heightAt(x, z) + 0.02, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    s.set(sc, sc * 1.1, sc);
    m.compose(p, q, s);
    mesh.setMatrixAt(n++, m);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array, pb = b.attributes.position.array;
  const na = a.attributes.normal.array, nb = b.attributes.normal.array;
  const ua = a.attributes.uv.array, ub = b.attributes.uv.array;
  const pos = new Float32Array(pa.length + pb.length); pos.set(pa); pos.set(pb, pa.length);
  const nor = new Float32Array(na.length + nb.length); nor.set(na); nor.set(nb, na.length);
  const uv = new Float32Array(ua.length + ub.length); uv.set(ua); uv.set(ub, ua.length);
  const ia = a.index.array, ib = b.index.array;
  const off = pa.length / 3;
  const idx = new Uint16Array(ia.length + ib.length);
  idx.set(ia); for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + off;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Two grass layers: a very dense near patch and a sparser wide patch.
export function grassLayers(terrain, q, opts = {}) {
  const density = q.grass;
  const nearPatch = opts.nearPatch || 18;
  const farPatch = (opts.farPatch || 46) + 14 * Math.min(1.5, density);
  const near = new Grass({
    ...opts, terrain, count: Math.round((opts.nearCount || 60000) * density), patch: nearPatch,
    width: (opts.width || 0.08) * 0.75, fadeStart: 0.32, seed: 3,
  });
  const far = new Grass({
    ...opts, terrain, count: Math.round((opts.farCount || 42000) * density), patch: farPatch,
    width: (opts.width || 0.08) * 1.15, fadeStart: 0.3, inner: 0, seed: 9,
  });
  return {
    meshes: [near.mesh, far.mesh],
    update(dt, camPos) { near.update(dt, camPos); far.update(dt, camPos); },
    layers: [near, far],
  };
}
