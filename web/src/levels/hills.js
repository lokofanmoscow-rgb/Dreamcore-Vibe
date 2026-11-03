import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase, distToPolyline } from './common.js';
import { Terrain } from '../core/terrain.js';
import { makeNoise2D, fbm2, smoothstep, mulberry32 } from '../core/noise.js';
import { canvasTexture } from '../core/textures.js';
import { picketFence, house, houseColliders, circleCollider } from '../props/props.js';

// Old console-era hills: soft low-poly slopes, long white fences snaking over
// them, little houses far away and poles with loudspeakers that sometimes chime.
// Rendered at a lower resolution for that blurry 2003 look.

export const skyOpts = {
  top: '#2f6ec0', mid: '#5a92d6', horizon: '#c6dcef', midHeight: 0.35,
  sunDir: [0.5, 0.7, 0.3], sunGlow: 0.1, sunGlow2: 0.5, sunSize: 0.0,
  cloudCover: 0.5, cloudScale: 0.55, cloudSoft: 0.22, cloudColor: '#ffffff', cloudShade: '#b6c4d8', haze: 0.3,
};

function retroGrass() {
  const rnd = mulberry32(12);
  return canvasTexture(64, 64, (c, w, h) => {
    const img = c.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const k = 0.85 + rnd() * 0.3;
      img.data[i * 4] = 168 * k; img.data[i * 4 + 1] = 172 * k; img.data[i * 4 + 2] = 98 * k; img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  });
}

function retroDirt() {
  const rnd = mulberry32(13);
  return canvasTexture(64, 64, (c, w, h) => {
    const img = c.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const k = 0.85 + rnd() * 0.3;
      img.data[i * 4] = 190 * k; img.data[i * 4 + 1] = 168 * k; img.data[i * 4 + 2] = 120 * k; img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  });
}

function speakerPole() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.8 });
  const grey = new THREE.MeshStandardMaterial({ color: '#9a9a94', roughness: 0.5, metalness: 0.4 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6.5, 6).translate(0, 3.25, 0), dark));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6).translate(0, 6.55, 0), dark));
  const horns = [];
  for (let i = 0; i < 4; i++) {
    const h = new THREE.CylinderGeometry(0.32, 0.06, 0.7, 10, 1, true);
    h.rotateZ(-Math.PI / 2);
    h.translate(0.45, 0, 0);
    h.rotateY((i / 4) * Math.PI * 2 + 0.3);
    h.translate(0, 6.2, 0);
    horns.push(h);
  }
  g.add(new THREE.Mesh(mergeGeometries(horns), new THREE.MeshStandardMaterial({ color: '#b8b8b0', roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide })));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06).translate(0, 5.9, 0), grey));
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  L.def.skyOpts = skyOpts;
  const q = ctx.q;
  const noise = makeNoise2D(71);
  const rnd = mulberry32(2003);
  L.renderScale = 0.55;

  // winding dirt path from the start to the big house
  const pathPts = [];
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const z = 40 - t * 330;
    pathPts.push({ x: Math.sin(t * 6.0) * 35 + Math.sin(t * 2.3) * 22, z });
  }
  const dPath = (x, z) => distToPolyline(x, z, pathPts);
  const height = (x, z) => {
    const big = fbm2(noise, x * 0.004, z * 0.004, 3) * 46;
    const mid = fbm2(noise, x * 0.011 + 7, z * 0.011, 2) * 9;
    const dp = dPath(x, z);
    const flat = 1 - 0.6 * Math.exp(-(dp * dp) / 300);
    return (big + mid) * flat;
  };
  const terrain = new Terrain({
    size: 760, segments: 70, fieldRes: 384, cz: -120,
    height,
    grass: () => 0,
    path: (x, z) => 1 - smoothstep(2.0, 3.4, dPath(x, z)),
    tint: (x, z) => 0.45 + fbm2(noise, x * 0.02, z * 0.02, 2) * 0.5,
    groundTex: retroGrass(), pathTex: retroDirt(), groundRepeat: 0.18, pathRepeat: 0.25, roughness: 1.0,
    outer: { size: 1800, segments: 50 },
  });
  L.add(terrain.mesh);
  L.groundHeight = height;
  L.surface = () => 'grass';

  L.setupSky(skyOpts);
  L.setupSun({ dir: skyOpts.sunDir, color: '#fff6e0', intensity: 2.6, area: 40 });
  L.setupHemi('#cfe0f2', '#8a8a5a', 1.15);
  L.setupFog('#c8dcea', 120, 700);
  L.envFromSky(0.4);

  // ---------------------------------------------------------------- the long fences
  const fenceCurve = (x0, z0, dirA, len, wobble, seed) => {
    const r = mulberry32(seed);
    const pts = [];
    let x = x0, z = z0, a = dirA;
    for (let s = 0; s < len; s += 3) {
      pts.push([x, z]);
      a += Math.sin(s * 0.02 + seed) * wobble + (r() - 0.5) * 0.04;
      x += Math.sin(a) * 3; z += Math.cos(a) * 3;
    }
    return pts;
  };
  const fences = [
    fenceCurve(-6, 30, Math.PI, 360, 0.05, 1),
    fenceCurve(8, 32, Math.PI * 1.02, 340, 0.06, 2),
    fenceCurve(-60, -20, Math.PI * 0.7, 260, 0.08, 3),
    fenceCurve(70, -60, Math.PI * 1.3, 300, 0.07, 4),
    fenceCurve(-120, -150, Math.PI * 0.4, 280, 0.06, 5),
    fenceCurve(40, -200, -Math.PI * 0.6, 240, 0.09, 6),
  ];
  fences.forEach((pts, i) => {
    // keep fences off the path
    const keep = pts.filter(([x, z]) => dPath(x, z) > 4);
    if (keep.length < 4) return;
    const runs = [];
    let cur = [];
    for (const p of pts) {
      if (dPath(p[0], p[1]) > 4) cur.push(p);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    for (const run of runs) {
      if (run.length < 2) continue;
      const f = picketFence(run, { heightAt: height, seed: 40 + i, spacing: 0.24, height: 1.15, color: '#ecebe4' });
      L.add(f.object);
      L.collide(f.colliders);
    }
  });

  // ---------------------------------------------------------------- houses on the hills
  const farHouse = (x, z, s, rot, col) => {
    const h = house({ w: 7 * s, d: 6 * s, h: 3 * s, wall: col, roof: '#7a4a3a', roofH: 2.4 * s, seed: Math.floor(x * 3 + z), chimney: rnd() < 0.4 });
    h.object.position.set(x, height(x, z) - 0.2, z);
    h.object.rotation.y = rot;
    L.add(h.object);
    L.collide(houseColliders(h.object));
    return h.object;
  };
  const cols = ['#d8cfb8', '#c8c0a8', '#e0d8c4', '#bcb4a0'];
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, r = 90 + rnd() * 200;
    const x = Math.sin(a) * r, z = -120 + Math.cos(a) * r;
    if (dPath(x, z) < 12) continue;
    farHouse(x, z, 0.9 + rnd() * 0.4, rnd() * 6, cols[i % cols.length]);
  }
  const endP = pathPts[pathPts.length - 1];
  const big = farHouse(endP.x - 14, endP.z - 10, 1.6, 0.4, '#e6dcc4');
  void big;

  // ---------------------------------------------------------------- loudspeaker poles
  const poles = [];
  for (const k of [6, 22, 40, 58, 76, 94]) {
    const p = pathPts[k];
    const x = p.x + (k % 2 ? 4 : -4), z = p.z;
    const s = speakerPole();
    s.position.set(x, height(x, z), z);
    L.add(s);
    L.collide(circleCollider(x, z, 0.2));
    poles.push(new THREE.Vector3(x, height(x, z) + 6, z));
  }
  // every so often the speakers play a soft four-note chime
  let next = 6;
  L.onUpdate((dt, t, player) => {
    if (t < next || !ctx.audio) return;
    next = t + 26 + Math.random() * 18;
    let d = Infinity;
    for (const p of poles) d = Math.min(d, p.distanceTo(player.pos));
    const vol = 0.05 * Math.max(0, 1 - d / 160);
    if (vol < 0.004) return;
    [659.25, 523.25, 587.33, 392.0].forEach((f, i) => setTimeout(() => ctx.audio.chime(f, vol), i * 650));
  });

  // ---------------------------------------------------------------- doors
  const doorX = endP.x + 2, doorZ = endP.z - 3;
  L.makeDoor({ color: '#f2f0ea', frameColor: '#ffffff', glow: '#fff8e6', style: 'panel', beacon: true }, doorX, height(doorX, doorZ), doorZ, Math.atan2(pathPts[95].x - doorX, pathPts[95].z - doorZ));
  for (const k of [30, 64]) {
    const p = pathPts[k];
    const x = p.x + 18, z = p.z + 6;
    L.makeDecoy({ color: '#ecebe4', frameColor: '#ffffff' }, x, height(x, z), z, Math.atan2(p.x - x, p.z - z));
  }

  L.bounds = { type: 'circle', x: 0, z: -120, r: 300 };
  const s0 = pathPts[1];
  L.spawn = { x: s0.x, z: s0.z + 2, yaw: 0, pitch: 0.02 };
  L.menuCam = { x: s0.x + 1, z: s0.z + 4, yaw: 0.1, y: 1.7, pitch: 0.05 };
  L.far = 1500;
  return L;
}
