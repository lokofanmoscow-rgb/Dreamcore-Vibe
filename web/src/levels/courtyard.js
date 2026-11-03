import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase } from './common.js';
import { Terrain, grassLayers } from '../core/terrain.js';
import { canvasTexture, concreteTexture, tileTexture, rep } from '../core/textures.js';
import { mulberry32 } from '../core/noise.js';
import { bench, streetLamp, trashBin, boxCollider, circleCollider } from '../props/props.js';

// Courtyard wells: three yards closed in by ten-storey walls full of windows,
// joined by arched passages through the buildings. Lawns, paving, dusk.

const HB = 33;                // building height
const FLOOR = 3.2;
const YARDS = [
  { x0: -30, x1: 30, z0: -20, z1: 20 },
  { x0: -25, x1: 25, z0: -90, z1: -40 },
  { x0: -20, x1: 40, z0: -150, z1: -110 },
];
const PASSES = [
  { x0: -2, x1: 2, z0: -40, z1: -20, axis: 'z' },
  { x0: 8, x1: 12, z0: -110, z1: -90, axis: 'z' },
];
const PASS_H = 4.6;

function facadeTexture() {
  return canvasTexture(256, 272, (c, w, h) => {
    c.fillStyle = '#dcdad6'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { c.fillStyle = `rgba(90,90,100,${Math.random() * 0.06})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    c.fillStyle = 'rgba(120,118,128,0.55)';
    c.fillRect(0, h - 3, w, 3);            // floor seam
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,60,70,0.12)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
}

function windowTexture() {
  return canvasTexture(128, 112, (c, w, h) => {
    c.fillStyle = '#161a1e'; c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#5c6670'); g.addColorStop(0.5, '#2a3038'); g.addColorStop(1, '#3e4650');
    c.fillStyle = g; c.fillRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#1a1e22'; c.fillRect(w / 2 - 3, 8, 6, h - 16); c.fillRect(8, h * 0.42, w - 16, 5);
  }, { wrap: false });
}

function litTexture() {
  return canvasTexture(128, 112, (c, w, h) => {
    c.fillStyle = '#161a1e'; c.fillRect(0, 0, w, h);
    const g = c.createRadialGradient(w / 2, h * 0.3, 4, w / 2, h / 2, w * 0.7);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#b0a898');
    c.fillStyle = g; c.fillRect(8, 8, w - 16, h - 16);
    c.fillStyle = 'rgba(40,36,30,0.5)'; c.fillRect(w / 2 - 3, 8, 6, h - 16); c.fillRect(8, h * 0.42, w - 16, 5);
    if (Math.random() < 1) { c.fillStyle = 'rgba(60,50,40,0.25)'; c.fillRect(8, 8, w * 0.3, h - 16); }
  }, { wrap: false });
}

export const skyOpts = {
  top: '#5d5a78', mid: '#8a86a0', horizon: '#c4bccb', midHeight: 0.4,
  sunDir: [0.2, 0.3, -0.9], sunGlow: 0.15, sunGlow2: 0.3, sunSize: 0.0,
  cloudCover: 0.7, cloudScale: 0.5, cloudSoft: 0.6, cloudColor: '#b8b2c4', cloudShade: '#6e6a84', haze: 0.4, stars: 0.0,
};

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  L.def.skyOpts = skyOpts;
  const q = ctx.q;
  const rnd = mulberry32(404);

  // ---------------------------------------------------------------- lawns & paving
  const lawns = [];
  for (const y of YARDS) {
    const cx = (y.x0 + y.x1) / 2, cz = (y.z0 + y.z1) / 2;
    const m = 3.0, p = 1.6;
    lawns.push({ x0: y.x0 + m, x1: cx - p, z0: y.z0 + m, z1: cz - p }, { x0: cx + p, x1: y.x1 - m, z0: y.z0 + m, z1: cz - p },
      { x0: y.x0 + m, x1: cx - p, z0: cz + p, z1: y.z1 - m }, { x0: cx + p, x1: y.x1 - m, z0: cz + p, z1: y.z1 - m });
    y.cx = cx; y.cz = cz;
  }
  const onLawn = (x, z) => lawns.some((l) => x > l.x0 && x < l.x1 && z > l.z0 && z < l.z1) && YARDS.every((y) => Math.hypot(x - y.cx, z - y.cz) > 4.2);
  const terrain = new Terrain({
    size: 230, segments: 60, fieldRes: 512, cx: 5, cz: -65,
    height: () => 0,
    grass: (x, z) => (onLawn(x, z) ? 1 : 0),
    path: (x, z) => (onLawn(x, z) ? 0 : 1),
    tint: () => 0.45,
    pathTex: tileTexture('#b8b4ac', '#8a8680', 2, 'paving', 0.05),
    pathRepeat: 0.5,
    groundColor: '#c8d4b8',
  });
  L.add(terrain.mesh);
  const grass = grassLayers(terrain, q, { height: 0.2, width: 0.06, base: '#2a4a1e', tip: '#7f9a52', wind: 0.4, densityMul: 1.1 });
  grass.meshes.forEach((m) => L.add(m));
  L.onUpdate((dt) => grass.update(dt, ctx.camera.position));
  // curbs around the lawns
  const curb = [];
  for (const l of lawns) {
    curb.push(new THREE.BoxGeometry(l.x1 - l.x0, 0.12, 0.12).translate((l.x0 + l.x1) / 2, 0.06, l.z0), new THREE.BoxGeometry(l.x1 - l.x0, 0.12, 0.12).translate((l.x0 + l.x1) / 2, 0.06, l.z1),
      new THREE.BoxGeometry(0.12, 0.12, l.z1 - l.z0).translate(l.x0, 0.06, (l.z0 + l.z1) / 2), new THREE.BoxGeometry(0.12, 0.12, l.z1 - l.z0).translate(l.x1, 0.06, (l.z0 + l.z1) / 2));
  }
  L.add(new THREE.Mesh(mergeGeometries(curb), new THREE.MeshStandardMaterial({ color: '#a8a49a', roughness: 0.9 })));
  for (const y of YARDS) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.9, 4.2, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8f8a82', roughness: 0.9 }));
    ring.position.set(y.cx, 0.02, y.cz);
    L.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.9, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: rep(concreteTexture('#a8a096'), 0.3, 0.3), roughness: 0.85 }));
    disc.position.set(y.cx, 0.015, y.cz);
    L.add(disc);
  }

  // ---------------------------------------------------------------- facades
  const ftex = facadeTexture();
  ftex.repeat.set(1 / 3, 1 / FLOOR);
  const facadeMat = new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.92 });
  const fgeo = [];
  const windows = [];   // [x, y, z, rotY]
  const plane = (x0, z0, x1, z1, y0, y1, nx, nz) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.PlaneGeometry(len, y1 - y0);
    g.rotateY(Math.atan2(nx, nz));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    const horiz = Math.abs(z1 - z0) < 1e-6;
    for (let i = 0; i < p.count; i++) uv.setXY(i, horiz ? p.getX(i) : p.getZ(i), p.getY(i));
    fgeo.push(g);
  };
  // a facade along one side of a yard, facing into the yard, with optional passage gaps
  const facade = (x0, z0, x1, z1, nx, nz, gaps) => {
    const horiz = Math.abs(z1 - z0) < 1e-6;
    const a0 = horiz ? Math.min(x0, x1) : Math.min(z0, z1), a1 = horiz ? Math.max(x0, x1) : Math.max(z0, z1);
    const at = horiz ? z0 : x0;
    const seg = (s0, s1, y0, y1) => (horiz ? plane(s0, at, s1, at, y0, y1, nx, nz) : plane(at, s0, at, s1, y0, y1, nx, nz));
    let s = a0;
    for (const [g0, g1] of gaps) { seg(s, g0, 0, HB); seg(g0, g1, PASS_H, HB); s = g1; }
    seg(s, a1, 0, HB);
    // windows: bays every 3 m, ten floors
    for (let u = a0 + 1.5; u < a1 - 1; u += 3) {
      for (let f = 0; f < 10; f++) {
        const y = 1.9 + f * FLOOR;
        if (f === 0 && gaps.some(([g0, g1]) => u > g0 - 1.5 && u < g1 + 1.5)) continue;
        if (f === 1 && gaps.some(([g0, g1]) => u > g0 - 0.5 && u < g1 + 0.5)) continue;
        const px = horiz ? u : at + nx * 0.03, pz = horiz ? at + nz * 0.03 : u;
        windows.push([px, y, pz, Math.atan2(nx, nz)]);
      }
    }
    // parapet at the roof line
    if (horiz) fgeo.push(new THREE.BoxGeometry(a1 - a0, 0.6, 0.5).translate((a0 + a1) / 2, HB + 0.3, at - nz * 0.25));
    else fgeo.push(new THREE.BoxGeometry(0.5, 0.6, a1 - a0).translate(at - nx * 0.25, HB + 0.3, (a0 + a1) / 2));
  };
  const Y = YARDS;
  // yard 1
  facade(Y[0].x0, Y[0].z1, Y[0].x1, Y[0].z1, 0, -1, []);
  facade(Y[0].x0, Y[0].z0, Y[0].x1, Y[0].z0, 0, 1, [[-2, 2]]);
  facade(Y[0].x0, Y[0].z0, Y[0].x0, Y[0].z1, 1, 0, []);
  facade(Y[0].x1, Y[0].z0, Y[0].x1, Y[0].z1, -1, 0, []);
  // yard 2
  facade(Y[1].x0, Y[1].z1, Y[1].x1, Y[1].z1, 0, -1, [[-2, 2]]);
  facade(Y[1].x0, Y[1].z0, Y[1].x1, Y[1].z0, 0, 1, [[8, 12]]);
  facade(Y[1].x0, Y[1].z0, Y[1].x0, Y[1].z1, 1, 0, []);
  facade(Y[1].x1, Y[1].z0, Y[1].x1, Y[1].z1, -1, 0, []);
  // yard 3
  facade(Y[2].x0, Y[2].z1, Y[2].x1, Y[2].z1, 0, -1, [[8, 12]]);
  facade(Y[2].x0, Y[2].z0, Y[2].x1, Y[2].z0, 0, 1, []);
  facade(Y[2].x0, Y[2].z0, Y[2].x0, Y[2].z1, 1, 0, []);
  facade(Y[2].x1, Y[2].z0, Y[2].x1, Y[2].z1, -1, 0, []);
  // roofs that close the space between the yards (seen only from far above)
  const facades = new THREE.Mesh(mergeGeometries(fgeo.map((g) => (g.index ? g.toNonIndexed() : g))), facadeMat);
  facades.receiveShadow = true;
  facades.castShadow = true;
  L.add(facades);
  // passages through the buildings
  const passMat = new THREE.MeshStandardMaterial({ map: rep(concreteTexture('#bcb8b0'), 0.4, 0.4), roughness: 0.9, side: THREE.DoubleSide });
  for (const p of PASSES) {
    const len = p.z1 - p.z0, cz = (p.z0 + p.z1) / 2;
    const g = mergeGeometries([
      new THREE.PlaneGeometry(len, PASS_H).rotateY(Math.PI / 2).translate(p.x0, PASS_H / 2, cz),
      new THREE.PlaneGeometry(len, PASS_H).rotateY(-Math.PI / 2).translate(p.x1, PASS_H / 2, cz),
      new THREE.PlaneGeometry(p.x1 - p.x0, len).rotateX(Math.PI / 2).translate((p.x0 + p.x1) / 2, PASS_H, cz),
    ]);
    L.add(new THREE.Mesh(g, passMat));
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2b0').multiplyScalar(2.2) }));
    lamp.position.set((p.x0 + p.x1) / 2, PASS_H - 0.05, cz);
    L.add(lamp);
  }

  // ---------------------------------------------------------------- windows (one instanced draw for the dark ones, one for the lit ones)
  const winGeo = new THREE.PlaneGeometry(1.3, 1.1);
  const dark = [], lit = [];
  for (const w of windows) (rnd() < 0.11 ? lit : dark).push(w);
  const darkMesh = new THREE.InstancedMesh(winGeo, new THREE.MeshStandardMaterial({ map: windowTexture(), roughness: 0.15, metalness: 0.4 }), dark.length);
  const litMesh = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ map: litTexture() }), lit.length);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  const tints = ['#ffd9a0', '#ffe8c8', '#d8e8ff', '#fff4e0', '#ffc890', '#c8d8ff'];
  dark.forEach(([x, y, z, r], i) => { m4.compose(pv.set(x, y, z), qq.setFromAxisAngle(up, r), one); darkMesh.setMatrixAt(i, m4); });
  const c = new THREE.Color();
  lit.forEach(([x, y, z, r], i) => {
    m4.compose(pv.set(x, y, z), qq.setFromAxisAngle(up, r), one);
    litMesh.setMatrixAt(i, m4);
    c.set(tints[Math.floor(rnd() * tints.length)]).multiplyScalar(1.1 + rnd() * 0.9);
    litMesh.setColorAt(i, c);
  });
  L.add(darkMesh, litMesh);
  // a window or two switching on and off now and then
  const toggles = lit.slice(0, 12).map((_, i) => i);
  L.onUpdate((dt, t) => {
    if (Math.floor(t * 0.5) === Math.floor((t - dt) * 0.5)) return;
    const i = toggles[Math.floor(Math.random() * toggles.length)];
    if (i === undefined) return;
    c.set(tints[i % tints.length]).multiplyScalar(Math.random() < 0.5 ? 0.05 : 1.6);
    litMesh.setColorAt(i, c);
    litMesh.instanceColor.needsUpdate = true;
  });

  // ---------------------------------------------------------------- yard furniture
  for (const y of Y) {
    for (const [ox, oz, r] of [[-7, -2.3, 0], [7, 2.3, Math.PI], [-7, 2.3, Math.PI], [7, -2.3, 0]]) {
      const b = bench('#6a5a48');
      b.position.set(y.cx + ox, 0, y.cz + oz);
      b.rotation.y = r;
      L.add(b);
      L.collide(boxCollider(y.cx + ox, y.cz + oz, 1.9, 0.7));
    }
    for (const [ox, oz] of [[-1.4, (y.z1 - y.z0) / 2 - 1.6], [1.4, -(y.z1 - y.z0) / 2 + 1.6]]) {
      const l = streetLamp('#ffe0b0');
      l.position.set(y.cx + ox, 0, y.cz + oz);
      l.scale.setScalar(0.75);
      L.add(l);
      L.collide(circleCollider(y.cx + ox, y.cz + oz, 0.15));
    }
    const tb = trashBin('#4a5a4a');
    tb.position.set(y.x0 + 1.2, 0, y.cz + 2.5);
    L.add(tb);
    L.collide(circleCollider(y.x0 + 1.2, y.cz + 2.5, 0.38));
    // outdoor AC units by the walls
    const ac = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.7), new THREE.MeshStandardMaterial({ color: '#d8d8d2', roughness: 0.6 }));
    ac.position.set(y.x1 - 2.5, 0.45, y.z0 + 0.45);
    L.add(ac);
    L.collide(boxCollider(y.x1 - 2.5, y.z0 + 0.45, 1.6, 0.8));
  }

  // ---------------------------------------------------------------- light & air
  L.setupSky(skyOpts);
  L.setupSun({ dir: [0.25, 0.85, 0.3], color: '#c8c4dc', intensity: 0.9, area: 40 });
  L.setupHemi('#bfb8d2', '#4a4a42', 0.95);
  L.setupFogExp('#8e8aa0', 0.0055);
  L.envFromSky(0.5);

  // ---------------------------------------------------------------- doors (entrances into the buildings)
  const entrance = (x, z, rot, real) => {
    const nx = Math.sin(rot), nz = Math.cos(rot);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 1.4), new THREE.MeshStandardMaterial({ color: '#a8a4a0', roughness: 0.9 }));
    canopy.position.set(x + nx * 0.7, 2.9, z + nz * 0.7);
    canopy.rotation.y = rot;
    L.add(canopy);
    const opts = { color: real ? '#8a6a52' : '#6a6e72', frameColor: '#4a4c4e', glow: '#fff2dc', style: 'glass', width: 1.1 };
    if (real) L.makeDoor({ ...opts, beacon: true }, x + nx * 0.05, 0, z + nz * 0.05, rot);
    else L.makeDecoy(opts, x + nx * 0.05, 0, z + nz * 0.05, rot);
  };
  entrance(-15, Y[0].z1, Math.PI, false);
  entrance(Y[1].x0, -60, Math.PI / 2, false);
  entrance(Y[2].x1, -125, -Math.PI / 2, false);
  entrance(30, Y[2].z0, 0, true);

  // ---------------------------------------------------------------- walkable area: the yards and passages
  const rects = [...Y, ...PASSES].map((r) => ({ x0: r.x0 + 0.35, x1: r.x1 - 0.35, z0: r.z0 + 0.35, z1: r.z1 - 0.35 }));
  // passages need their ends to meet the yards
  rects[3].z0 = PASSES[0].z0 - 1; rects[3].z1 = PASSES[0].z1 + 1;
  rects[4].z0 = PASSES[1].z0 - 1; rects[4].z1 = PASSES[1].z1 + 1;
  L.bounds = {
    type: 'fn',
    fn: (pos) => {
      if (rects.some((r) => pos.x >= r.x0 && pos.x <= r.x1 && pos.z >= r.z0 && pos.z <= r.z1)) return;
      let best = null, bd = Infinity;
      for (const r of rects) {
        const x = Math.max(r.x0, Math.min(r.x1, pos.x)), z = Math.max(r.z0, Math.min(r.z1, pos.z));
        const d = Math.hypot(x - pos.x, z - pos.z);
        if (d < bd) { bd = d; best = [x, z]; }
      }
      pos.x = best[0]; pos.z = best[1];
    },
  };
  L.groundHeight = () => 0;
  L.surface = (x, z) => (onLawn(x, z) ? 'grass' : 'concrete');
  L.spawn = { x: 0, z: 17, yaw: 0, pitch: 0.12 };
  L.menuCam = { x: -24, z: 15, yaw: -0.7, y: 1.6, pitch: 0.18 };
  L.far = 600;
  return L;
}
