import * as THREE from 'three';
import { LevelBase } from './common.js';
import { Terrain, grassLayers } from '../core/terrain.js';
import { makeNoise2D, fbm2, smoothstep, mulberry32 } from '../core/noise.js';
import { sunflowerHeadTexture, leafTexture, dirtTexture, leafyTexture } from '../core/textures.js';
import { boxCollider, bench } from '../props/props.js';

export const skyOpts = {
  top: '#2f78c8', mid: '#5aa3dc', horizon: '#a9d3ec', midHeight: 0.35,
  sunDir: [0.3, 0.72, 0.62], sunGlow: 0.15, sunGlow2: 0.9, sunSize: 0.0,
  cloudCover: 0.0, haze: 0.3,
  moons: [[0.07, 0.42, -0.9, 0.035], [0.16, 0.33, -0.93, 0.05], [-0.02, 0.5, -0.86, 0.016]],
  moonColor: '#e9ecf7',
};

function headGeometry(R = 0.34, rings = 6, segs = 22, cup = 0.5) {
  const pos = [], uv = [], idx = [];
  pos.push(0, 0, 0.02); uv.push(0.5, 0.5);
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * R;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      pos.push(x, y, -cup * rr * rr + (r === 1 ? 0.015 : 0));
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

function leafGeometry() {
  const g = new THREE.PlaneGeometry(0.32, 0.42, 1, 3);
  g.translate(0, 0.21, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setZ(i, (y * y) * 0.9);
  }
  g.rotateX(-1.0);
  g.computeVertexNormals();
  return g;
}

// gentle wind sway shared by all sunflower parts (world space, after instancing)
function swayMaterial(mat, uniforms, amount = 0.06) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          float hAbove = max(0.0, mvPosition.y - instanceMatrix[3].y);
          float sw = sin(uTime * 1.2 + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.22)
                   + 0.4 * sin(uTime * 2.3 + instanceMatrix[3].z * 0.9);
          mvPosition.x += sw * ${amount.toFixed(3)} * hAbove * hAbove * 0.25;
          mvPosition.z += sw * ${(amount * 0.5).toFixed(3)} * hAbove * hAbove * 0.25;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      `);
  };
  mat.customProgramCacheKey = () => 'sway' + amount;
  return mat;
}

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  L.def.skyOpts = skyOpts;
  const q = ctx.q;
  const noise = makeNoise2D(5);

  // layout: main path along -Z, one cross path
  const MAIN = { z0: 10, z1: -112, half: 1.25 };
  const CROSS = { z: -62, x0: -27, x1: 27, half: 1.2 };
  const pathDist = (x, z) => {
    let d = Infinity;
    if (z < MAIN.z0 && z > MAIN.z1 - 3) d = Math.abs(x);
    if (x > CROSS.x0 - 3 && x < CROSS.x1 + 3) d = Math.min(d, Math.abs(z - CROSS.z));
    return d;
  };
  const height = (x, z) => fbm2(noise, x * 0.01, z * 0.01, 3) * 1.2 + fbm2(noise, x * 0.004 + 9, z * 0.004, 2) * 6 * smoothstep(60, 160, Math.hypot(x, z + 50));
  const terrain = new Terrain({
    size: 420, segments: 120, fieldRes: 512, height,
    grass: (x, z) => {
      const p = pathDist(x, z);
      return 0.35 * smoothstep(1.4, 2.2, p) + 0.0;
    },
    path: (x, z) => 1 - smoothstep(MAIN.half * 0.7, MAIN.half + 0.5, pathDist(x, z)),
    tint: (x, z) => 0.35 + 0.3 * fbm2(noise, x * 0.05, z * 0.05, 2),
    groundTex: leafyTexture('#7a8a44', 'fieldGround'),
    pathTex: dirtTexture('#e6caa2'),
    groundRepeat: 0.4,
    pathRepeat: 0.3,
  });
  L.add(terrain.mesh);
  L.groundHeight = height;
  L.surface = (x, z) => 'dirt';

  // short weedy grass along the path edges
  const grass = grassLayers(terrain, q, { height: 0.35, width: 0.07, base: '#3e5f1c', tip: '#a7c45a', nearCount: 30000, farCount: 12000, farPatch: 34 });
  grass.meshes.forEach((m) => L.add(m));

  L.setupSky(skyOpts);
  L.setupSun({ dir: skyOpts.sunDir, color: '#fff1d8', intensity: 2.8, area: 28 });
  L.setupHemi('#bcdcf2', '#8a7a4a', 1.15);
  L.setupFog('#b5d6ea', 25, 190);
  L.envFromSky(0.5);

  // ---------------------------------------------------------------- sunflowers
  const uniforms = { uTime: { value: 0 } };
  L.onUpdate((dt) => { uniforms.uTime.value += dt; grass.update(dt, ctx.camera.position); });
  const headTex = sunflowerHeadTexture();
  const headMat = swayMaterial(new THREE.MeshStandardMaterial({ map: headTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 }), uniforms);
  const stemMat = swayMaterial(new THREE.MeshStandardMaterial({ color: '#5e8a3a', roughness: 0.8 }), uniforms);
  const leafMat = swayMaterial(new THREE.MeshStandardMaterial({ map: leafTexture('#5d9a3c'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }), uniforms);
  const backMat = swayMaterial(new THREE.MeshStandardMaterial({ color: '#4d7a2e', roughness: 0.9 }), uniforms);

  const rnd = mulberry32(42);
  const plants = [];
  const density = Math.max(0.4, q.detail);
  const LEAVES = q.detail >= 1 ? 3 : 2;
  const addRows = (x0, x1, spacingX, spacingZ, near) => {
    for (let x = x0; x <= x1; x += spacingX) {
      for (const side of [-1, 1]) {
        const rx = side * x;
        for (let z = MAIN.z0 + 6; z > MAIN.z1 - 40; z -= spacingZ) {
          const jx = rx + (rnd() - 0.5) * 0.25, jz = z + (rnd() - 0.5) * 0.3;
          if (pathDist(jx, jz) < 1.75) continue;
          plants.push({ x: jx, z: jz, near });
        }
      }
    }
  };
  const nearRows = 6 + Math.round(6 * density);
  addRows(1.85, 1.85 + nearRows * 0.95, 0.95, 0.72 / Math.min(1.2, density), true);
  addRows(2.0 + nearRows * 0.95, 44, 1.5 / density, 1.1 / density, false);
  // a ring behind the start and around the end so the field feels endless
  for (let i = 0; i < 1400 * density; i++) {
    const x = (rnd() - 0.5) * 100, z = MAIN.z0 + 6 + rnd() * 30;
    plants.push({ x, z, near: false });
  }

  const headGeo = headGeometry(0.34, 4, 16);
  const headGeoLo = headGeometry(0.34, 2, 10);
  const stemGeo = new THREE.CylinderGeometry(0.022, 0.032, 1, 5, 1, true).translate(0, 0.5, 0);
  const backGeo = new THREE.ConeGeometry(0.13, 0.12, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.08);
  const leafGeo = leafGeometry();

  // split the field into chunks along the path so cameras (and the shadow
  // camera) can cull what they don't see
  const CHUNK = 14;
  const chunks = new Map();
  for (const pl of plants) {
    const key = Math.floor(pl.z / CHUNK) + ':' + (pl.x < 0 ? 'l' : 'r');
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(pl);
  }
  const m = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (const list of chunks.values()) {
    const nNear = list.filter((pl) => pl.near).length;
    const nFar = list.length - nNear;
    const headsNear = nNear ? new THREE.InstancedMesh(headGeo, headMat, nNear) : null;
    const backs = nNear ? new THREE.InstancedMesh(backGeo, backMat, nNear) : null;
    const leaves = nNear ? new THREE.InstancedMesh(leafGeo, leafMat, nNear * LEAVES) : null;
    const headsFar = nFar ? new THREE.InstancedMesh(headGeoLo, headMat, nFar) : null;
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, list.length);
    let iN = 0, iF = 0, iS = 0, iL = 0;
    for (const pl of list) {
      const gy = height(pl.x, pl.z);
      const h = 1.55 + rnd() * 0.7;
      p.set(pl.x, gy, pl.z);
      e.set((rnd() - 0.5) * 0.08, 0, (rnd() - 0.5) * 0.08);
      q4.setFromEuler(e);
      s.set(1, h, 1);
      m.compose(p, q4, s);
      stems.setMatrixAt(iS++, m);
      // head facing +Z (toward the start of the path), nodding a little
      p.set(pl.x + e.z * -h * 0.5, gy + h, pl.z + e.x * h * 0.5);
      e.set(-0.25 - rnd() * 0.35, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.4);
      q4.setFromEuler(e);
      const hs = 0.85 + rnd() * 0.35;
      s.set(hs, hs, hs);
      m.compose(p, q4, s);
      if (pl.near) {
        headsNear.setMatrixAt(iN, m);
        backs.setMatrixAt(iN, m);
        iN++;
        for (let k = 0; k < LEAVES; k++) {
          p.set(pl.x, gy + h * (0.35 + k * (0.4 / LEAVES)), pl.z);
          e.set(0, rnd() * Math.PI * 2, 0);
          q4.setFromEuler(e);
          const ls = 0.8 + rnd() * 0.5;
          s.set(ls, ls, ls);
          m.compose(p, q4, s);
          leaves.setMatrixAt(iL++, m);
        }
      } else {
        headsFar.setMatrixAt(iF++, m);
      }
    }
    for (const im of [headsNear, backs, leaves, headsFar, stems]) {
      if (!im) continue;
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = im !== headsFar && (im !== leaves || q.detail >= 1);
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.boundingSphere.radius += 1.5; // room for the wind sway
      L.add(im);
    }
  }

  // walls of sunflowers: keep the player on the paths
  const t = 0.4;
  const wall = (x, z, w, d) => L.collide(boxCollider(x, z, w, d));
  const cz = CROSS.z, ch = CROSS.half + 0.35;
  const mh = MAIN.half + 0.35;
  // left & right of main path, split by the cross path
  wall(-mh - t / 2, (MAIN.z0 + cz + ch) / 2, t, MAIN.z0 - (cz + ch));
  wall(mh + t / 2, (MAIN.z0 + cz + ch) / 2, t, MAIN.z0 - (cz + ch));
  wall(-mh - t / 2, (cz - ch + MAIN.z1) / 2, t, (cz - ch) - MAIN.z1);
  wall(mh + t / 2, (cz - ch + MAIN.z1) / 2, t, (cz - ch) - MAIN.z1);
  // cross path sides
  wall((CROSS.x0 - mh) / 2, cz + ch + t / 2, -mh - CROSS.x0, t);
  wall((CROSS.x0 - mh) / 2, cz - ch - t / 2, -mh - CROSS.x0, t);
  wall((CROSS.x1 + mh) / 2, cz + ch + t / 2, CROSS.x1 - mh, t);
  wall((CROSS.x1 + mh) / 2, cz - ch - t / 2, CROSS.x1 - mh, t);
  // ends
  wall(0, MAIN.z0 + t / 2, mh * 2 + 1, t);
  wall(0, MAIN.z1 - t / 2, mh * 2 + 1, t);
  wall(CROSS.x0 - t / 2, cz, t, ch * 2 + 1);
  wall(CROSS.x1 + t / 2, cz, t, ch * 2 + 1);

  // doors: the one at the end of the main path is locked; the real one waits on the left
  L.makeDecoy({ color: '#f6a6c8', frameColor: '#f3b6d2' }, 0, height(0, MAIN.z1 + 0.6), MAIN.z1 + 0.6, 0);
  L.makeDecoy({ color: '#f6a6c8', frameColor: '#f3b6d2' }, CROSS.x1 - 0.6, height(CROSS.x1 - 0.6, cz), cz, -Math.PI / 2);
  L.makeDoor({ color: '#ff9cc6', frameColor: '#ffb4d4', glow: '#ffe6f2', style: 'panel' }, CROSS.x0 + 0.6, height(CROSS.x0 + 0.6, cz), cz, Math.PI / 2);

  const b = bench('#8a6a48');
  b.position.set(0.0, height(0, -30), -30);
  b.rotation.y = Math.PI / 2;
  b.position.x = 0.9;
  L.add(b);
  L.collide(boxCollider(0.9, -30, 0.6, 1.9));

  L.spawn = { x: 0, z: 6, yaw: 0, pitch: 0.02 };
  L.menuCam = { x: 0, z: 6, yaw: 0, y: 1.6, pitch: 0.04 };
  L.far = 260;
  L.bounds = { type: 'box', x0: CROSS.x0 - 1, x1: CROSS.x1 + 1, z0: MAIN.z1 - 1, z1: MAIN.z0 + 1 };
  return L;
}
