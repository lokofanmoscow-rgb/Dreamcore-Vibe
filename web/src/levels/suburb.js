import * as THREE from 'three';
import { LevelBase, ribbon, distToPolyline } from './common.js';
import { Terrain, grassLayers } from '../core/terrain.js';
import { makeNoise2D, fbm2, smoothstep, mulberry32 } from '../core/noise.js';
import { asphaltTexture, canvasTexture, concreteTexture, nrm, rep } from '../core/textures.js';
import {
  house, houseColliders, picketFence, hedge, cypress, trashBin, mailbox, hydrant, lawnDeer, stationWagon,
  streetLamp, barricade, windTurbine, boxCollider, circleCollider, roundTree,
} from '../props/props.js';

export const skyOpts = {
  top: '#3a2a78', mid: '#a560b4', horizon: '#ffb08a', midHeight: 0.28,
  sunDir: [0.3, 0.06, -0.95], sunColor: '#ffc078', sunGlow: 0.55, sunGlow2: 1.6, sunSize: 0.026, sunIntensity: 2.2,
  cloudCover: 0.33, cloudScale: 1.3, cloudSoft: 0.25, cloudColor: '#ffc8d2', cloudShade: '#7a4f96', cloudOpacity: 0.85,
  haze: 0.35, stars: 0.5, ground: '#6a4a5a',
};

function roadTexture() {
  const asp = asphaltTexture();
  return canvasTexture(512, 512, (c, w, h) => {
    c.drawImage(asp.image, 0, 0, w, h);
    // worn darker tyre tracks
    c.fillStyle = 'rgba(20,18,22,0.12)';
    c.fillRect(w * 0.12, 0, w * 0.12, h); c.fillRect(w * 0.76, 0, w * 0.12, h);
    // double yellow centre line
    c.fillStyle = '#e8b830';
    c.fillRect(w * 0.5 - 14, 0, 9, h);
    c.fillRect(w * 0.5 + 5, 0, 9, h);
    // faded edge lines
    c.fillStyle = 'rgba(235,230,220,0.6)';
    c.fillRect(10, 0, 6, h); c.fillRect(w - 16, 0, 6, h);
    // patches
    for (let i = 0; i < 6; i++) {
      c.fillStyle = 'rgba(30,28,30,0.35)';
      c.fillRect(Math.random() * w * 0.8, Math.random() * h, 30 + Math.random() * 50, 20 + Math.random() * 30);
    }
  });
}

function sidewalkTexture() {
  const con = concreteTexture('#cfc8bc');
  return canvasTexture(256, 256, (c, w, h) => {
    c.drawImage(con.image, 0, 0, w, h);
    c.strokeStyle = 'rgba(70,64,60,0.45)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
    c.beginPath(); c.moveTo(0, 1); c.lineTo(w, 1); c.stroke();
  });
}

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  L.def.skyOpts = skyOpts;
  const q = ctx.q;
  const noise = makeNoise2D(17);
  const rnd = mulberry32(99);

  // road centre line
  const road = [];
  for (let z = 30; z >= -160; z -= 2) road.push({ x: 9 * Math.sin((z + 10) / 42) - 4, z });
  const ROAD_HALF = 3.8, WALK_IN = 3.8, WALK_OUT = 6.0;
  const dRoad = (x, z) => distToPolyline(x, z, road);
  const height = (x, z) => {
    const d = dRoad(x, z);
    const base = d < ROAD_HALF + 1.2 ? -0.12 : 0.14;
    const hills = fbm2(noise, x * 0.008, z * 0.008, 4) * 14 * smoothstep(55, 140, d) + Math.max(0, fbm2(noise, x * 0.002, z * 0.002, 2)) * 30 * smoothstep(120, 260, d);
    return base + hills;
  };
  const terrain = new Terrain({
    size: 300, segments: Math.round(300 * Math.min(1, Math.max(0.6, q.detail))), fieldRes: 512, height,
    outer: { size: 1100, segments: 110 },
    grass: (x, z) => {
      const d = dRoad(x, z);
      return smoothstep(WALK_OUT + 0.3, WALK_OUT + 1.2, d) * (0.85 + 0.15 * fbm2(noise, x * 0.1, z * 0.1, 2));
    },
    path: () => 0,
    tint: (x, z) => 0.5 + 0.4 * fbm2(noise, x * 0.03, z * 0.03, 2),
    groundRepeat: 0.25,
  });
  L.add(terrain.mesh);
  L.groundHeight = (x, z) => {
    const d = dRoad(x, z);
    if (d < ROAD_HALF) return 0;
    if (d < WALK_OUT) return 0.15;
    return height(x, z);
  };
  L.surface = (x, z) => (dRoad(x, z) < WALK_OUT ? 'concrete' : 'grass');

  const grass = grassLayers(terrain, q, { height: 0.32, width: 0.07, base: '#3a5a1c', tip: '#b8c85a', wind: 0.6, nearCount: 45000, farCount: 30000 });
  grass.meshes.forEach((m) => L.add(m));
  L.onUpdate((dt) => grass.update(dt, ctx.camera.position));

  // ---------------------------------------------------------------- road + sidewalks
  const rt = roadTexture();
  rt.repeat.set(1, 1);
  const roadMat = new THREE.MeshStandardMaterial({ map: rt, normalMap: nrm(asphaltTexture()), roughness: 0.92 });
  const roadMesh = new THREE.Mesh(ribbon(road, ROAD_HALF * 2, { uvScale: 1 / 7.6, y: 0.01 }), roadMat);
  roadMesh.receiveShadow = true;
  L.add(roadMesh);
  const sw = sidewalkTexture();
  const swMat = new THREE.MeshStandardMaterial({ map: sw, roughness: 0.9 });
  const offsetLine = (off) => road.map((p, i) => {
    const a = road[Math.max(0, i - 1)], b = road[Math.min(road.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    return { x: p.x - dz / l * off, z: p.z + dx / l * off };
  });
  for (const s of [-1, 1]) {
    const mid = offsetLine(s * (WALK_IN + WALK_OUT) / 2);
    const m = new THREE.Mesh(ribbon(mid, WALK_OUT - WALK_IN, { uvScale: 1 / 2.2, y: 0.15 }), swMat);
    m.receiveShadow = true;
    L.add(m);
    // curb face
    const edge = offsetLine(s * WALK_IN);
    const pos = [], idx = [];
    edge.forEach((p, i) => { pos.push(p.x, 0, p.z, p.x, 0.15, p.z); if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); } });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const curb = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#bdb5a8', roughness: 0.9, side: THREE.DoubleSide }));
    L.add(curb);
  }

  // ---------------------------------------------------------------- sky & light
  L.setupSky(skyOpts);
  L.setupSun({ dir: skyOpts.sunDir.map((v, i) => (i === 1 ? 0.16 : v)), color: '#ffae6a', intensity: 3.0, area: 36, far: 260 });
  L.setupHemi('#c7a0e6', '#6a4a40', 0.9);
  L.setupFog('#e7a7a6', 40, 330);
  L.envFromSky(0.7);

  // ---------------------------------------------------------------- houses along the road
  const walls = ['#e9d6b4', '#cfe0c2', '#f1c7a8', '#d8d2e8', '#efe4c8', '#c8dcd8', '#f3d0d0'];
  const roofs = ['#7a2f28', '#6a3a2c', '#8a4030', '#5a2e2a'];
  const lots = [];
  for (let i = 4; i < road.length - 14; i += 8) {
    for (const s of [-1, 1]) {
      if (rnd() < 0.12) continue;
      const p = road[i], a = road[i - 1], b = road[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      const nx = -dz / l * s, nz = dx / l * s;
      const setback = 17 + rnd() * 3;
      const x = p.x + nx * setback, z = p.z + nz * setback;
      const facing = Math.atan2(-nx, -nz); // front (+z local) towards the road
      lots.push({ x, z, facing, nx, nz, p, s, tan: { x: dx / l, z: dz / l } });
    }
  }
  lots.forEach((lot, k) => {
    const w = 9 + rnd() * 4, d = 7 + rnd() * 2;
    const h = house({
      w, d, h: 2.9 + rnd() * 0.4, wall: walls[k % walls.length], roof: roofs[k % roofs.length],
      roofH: 1.8 + rnd() * 0.8, garage: rnd() < 0.6, windowGlow: rnd() < 0.55 ? '#ffb45a' : null, seed: k + 3, chimney: rnd() < 0.3,
    });
    h.object.position.set(lot.x, height(lot.x, lot.z) - 0.05, lot.z);
    h.object.rotation.y = lot.facing;
    L.add(h.object);
    L.collide(houseColliders(h.object));
    // driveway
    const dw = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 9), new THREE.MeshStandardMaterial({ map: rep(concreteTexture('#c9c2b6'), 1, 3), roughness: 0.9 }));
    const gx = lot.x - lot.nx * (d / 2 + 4.3) + Math.cos(lot.facing) * w * 0.25;
    const gz = lot.z - lot.nz * (d / 2 + 4.3) - Math.sin(lot.facing) * w * 0.25;
    dw.position.set(gx, 0.15, gz);
    dw.rotation.y = lot.facing;
    dw.receiveShadow = true;
    L.add(dw);
    // fences between lots
    const back = { x: lot.x + lot.nx * (d / 2 + 6), z: lot.z + lot.nz * (d / 2 + 6) };
    const side = (sg) => [lot.x - lot.tan.x * sg * 8.5, lot.z - lot.tan.z * sg * 8.5];
    if (rnd() < 0.8) {
      const f0 = side(1);
      const pts = [[f0[0] - lot.nx * 7, f0[1] - lot.nz * 7], [f0[0] + lot.nx * 6, f0[1] + lot.nz * 6], [back.x + lot.tan.x * 2, back.z + lot.tan.z * 2]];
      const f = picketFence(pts, { heightAt: height, seed: k, height: 1.1 });
      L.add(f.object);
      L.collide(f.colliders);
    }
    // front props
    const fx = lot.p.x + lot.nx * (WALK_OUT + 0.6), fz = lot.p.z + lot.nz * (WALK_OUT + 0.6);
    const mb = mailbox();
    mb.position.set(fx + lot.tan.x * 2.2, height(fx, fz), fz + lot.tan.z * 2.2);
    mb.rotation.y = lot.facing;
    L.add(mb);
    if (rnd() < 0.6) {
      const tb = trashBin(rnd() < 0.5 ? '#7a3a28' : '#3a5a3a');
      const tx = fx - lot.tan.x * 1.5, tz = fz - lot.tan.z * 1.5;
      tb.position.set(tx, height(tx, tz), tz);
      L.add(tb);
      L.collide(circleCollider(tx, tz, 0.38));
    }
    if (rnd() < 0.5) {
      const hd = hedge(5 + rnd() * 3, 1.0 + rnd() * 0.3, 1.0, '#4f8a35');
      const hx = lot.x - lot.nx * (d / 2 + 1.6) - Math.cos(lot.facing) * w * 0.15;
      const hz = lot.z - lot.nz * (d / 2 + 1.6) + Math.sin(lot.facing) * w * 0.15;
      hd.position.set(hx, height(hx, hz), hz);
      hd.rotation.y = lot.facing;
      L.add(hd);
      L.collide(boxCollider(hx, hz, 5.5, 1.1, lot.facing));
    }
    if (rnd() < 0.5) {
      const cy = cypress(5 + rnd() * 3, '#3d6a32');
      const cx = lot.x + Math.cos(lot.facing) * (w / 2 + 1.5), cz = lot.z - Math.sin(lot.facing) * (w / 2 + 1.5);
      cy.position.set(cx, height(cx, cz), cz);
      L.add(cy);
      L.collide(circleCollider(cx, cz, 0.6));
    } else if (rnd() < 0.4) {
      const tr = roundTree(6 + rnd() * 2, '#5a8a3a', k);
      const cx = lot.x + Math.cos(lot.facing) * (w / 2 + 2.5), cz = lot.z - Math.sin(lot.facing) * (w / 2 + 2.5);
      tr.position.set(cx, height(cx, cz), cz);
      L.add(tr);
      L.collide(circleCollider(cx, cz, 0.4));
    }
    if (k % 5 === 2) {
      const deer = lawnDeer();
      const dx2 = fx + lot.nx * 3 + lot.tan.x * 4, dz2 = fz + lot.nz * 3 + lot.tan.z * 4;
      deer.position.set(dx2, height(dx2, dz2), dz2);
      deer.rotation.y = lot.facing + 1.2;
      L.add(deer);
    }
    if (k % 6 === 1) {
      const car = stationWagon(['#8a3226', '#3a5a7a', '#c8b88a'][k % 3]);
      car.position.set(gx, 0.2, gz);
      car.rotation.y = lot.facing;
      L.add(car);
      L.collide(boxCollider(gx, gz, 2.0, 5.1, lot.facing));
    }
    if (k % 4 === 0) {
      const hy = hydrant();
      const hx2 = fx - lot.tan.x * 5, hz2 = fz - lot.tan.z * 5;
      hy.position.set(hx2, 0.14, hz2);
      L.add(hy);
      L.collide(circleCollider(hx2, hz2, 0.2));
    }
  });

  // street lamps
  for (let i = 6; i < road.length - 12; i += 14) {
    const p = road[i], a = road[i - 1], b = road[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    const nx = -dz / l, nz = dx / l;
    const x = p.x + nx * (WALK_IN + 0.4), z = p.z + nz * (WALK_IN + 0.4);
    const lamp = streetLamp();
    lamp.position.set(x, 0.14, z);
    lamp.rotation.y = Math.atan2(-nx, -nz);
    L.add(lamp);
    L.collide(circleCollider(x, z, 0.15));
  }

  // barricades block the road near the end
  const endI = road.length - 14;
  const pe = road[endI], ae = road[endI - 1], be = road[endI + 1];
  const tdx = be.x - ae.x, tdz = be.z - ae.z, tl = Math.hypot(tdx, tdz);
  const enx = -tdz / tl, enz = tdx / tl;
  for (let k = -2; k <= 2; k++) {
    const bb = barricade();
    const x = pe.x + enx * k * 1.5, z = pe.z + enz * k * 1.5;
    bb.position.set(x, 0, z);
    bb.rotation.y = Math.atan2(tdx, tdz) + Math.PI / 2 + (rnd() - 0.5) * 0.3;
    L.add(bb);
    L.collide(boxCollider(x, z, 1.3, 0.5, bb.rotation.y));
  }

  // wind turbines on the hills, silhouetted against the sunset
  const turbines = [];
  for (let i = 0; i < 12; i++) {
    const a = -1.3 + (i / 11) * 2.6 + (rnd() - 0.5) * 0.1;
    const r = 170 + rnd() * 110;
    const x = Math.sin(a) * r, z = -Math.cos(a) * r - 40;
    const t = windTurbine({ height: 40 + rnd() * 14 });
    t.position.set(x, height(x, z) - 2, z);
    t.rotation.y = rnd() * 0.5;
    t.traverse((o) => { o.castShadow = false; });
    L.add(t);
    turbines.push(t);
  }
  L.onUpdate((dt) => turbines.forEach((t) => t.userData.update(dt)));

  // the door waits on the closed road, past the barricades
  const di = road.length - 7;
  const pd = road[di], ad = road[di - 1], bd = road[di + 1];
  const rot = Math.atan2(-(bd.x - ad.x), -(bd.z - ad.z));
  L.makeDoor({ color: '#a8d8ff', frameColor: '#eef6ff', glow: '#fff0e0', style: 'panel' }, pd.x, 0.0, pd.z, rot);

  // keep the player near the street
  L.bounds = {
    type: 'fn',
    fn: (pos) => {
      let best = Infinity, bx = 0, bz = 0;
      for (let i = 0; i < road.length - 1; i++) {
        const a = road[i], b = road[i + 1];
        const abx = b.x - a.x, abz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((pos.x - a.x) * abx + (pos.z - a.z) * abz) / (abx * abx + abz * abz)));
        const px = a.x + abx * t, pz = a.z + abz * t;
        const d = Math.hypot(pos.x - px, pos.z - pz);
        if (d < best) { best = d; bx = px; bz = pz; }
      }
      const max = 26;
      if (best > max) { pos.x = bx + (pos.x - bx) / best * max; pos.z = bz + (pos.z - bz) / best * max; }
      if (pos.z > 28) pos.z = 28;
      if (pos.z < road[road.length - 2].z) pos.z = road[road.length - 2].z;
    },
  };

  const s0 = road[2];
  L.spawn = { x: s0.x + 1.8, z: s0.z, yaw: 0.05, pitch: 0.0 };
  L.menuCam = { x: s0.x + 2.5, z: s0.z - 2, yaw: 0.1, y: 1.3, pitch: 0.04 };
  return L;
}
