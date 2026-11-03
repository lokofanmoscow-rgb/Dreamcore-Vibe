import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase } from './common.js';
import { canvasTexture, paintedWallTexture, concreteTexture, glowTexture, textTexture, rep } from '../core/textures.js';
import { mulberry32 } from '../core/noise.js';
import { boxCollider } from '../props/props.js';

// A huge abandoned store: red and cream checkered floor, square pillars,
// buzzing troffer lights (some dead), an old counter, a mirrored dance corner
// with a blue curtain, empty shelving, fitting rooms and a dark storage room.

const H = 4.0;
const HALL = { x0: -40, x1: 40, z0: -70, z1: 0 };
const STORE = { x0: -40, x1: 40, z0: -96, z1: -70 };

function checkerTexture() {
  const rnd = mulberry32(5);
  return canvasTexture(512, 512, (c, w, h) => {
    const n = 4, s = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const red = (i + j) % 2 === 0;
      const k = 0.9 + rnd() * 0.14;
      c.fillStyle = red ? `rgb(${170 * k},${38 * k},${52 * k})` : `rgb(${226 * k},${206 * k},${178 * k})`;
      c.fillRect(i * s, j * s, s, s);
    }
    // wear, scuffs and grime
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = `rgba(${rnd() < 0.5 ? '60,40,40' : '255,250,240'},${rnd() * 0.08})`;
      const r = 1 + rnd() * 6;
      c.beginPath(); c.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = 'rgba(40,30,30,0.35)'; c.lineWidth = 1.5;
    for (let i = 0; i <= n; i++) { c.beginPath(); c.moveTo(i * s, 0); c.lineTo(i * s, h); c.stroke(); c.beginPath(); c.moveTo(0, i * s); c.lineTo(w, i * s); c.stroke(); }
  });
}

function ceilingTexture() {
  const rnd = mulberry32(9);
  return canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#d9d6cc'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { c.fillStyle = `rgba(90,80,60,${rnd() * 0.12})`; c.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    c.fillStyle = 'rgba(140,120,80,0.18)';
    c.beginPath(); c.ellipse(w * 0.7, h * 0.3, 30, 18, 0.4, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#a9a69c'; c.lineWidth = 5;
    c.strokeRect(0, 0, w, h);
  });
}

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  const q = ctx.q;
  const rnd = mulberry32(77);
  const std = (c, r = 0.7, m = 0, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
  const G = new Map();
  const push = (mat, g) => { if (!G.has(mat)) G.set(mat, []); G.get(mat).push(g.index ? g.toNonIndexed() : g); };
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const solid = (mat, x0, x1, y0, y1, z0, z1, collide = true) => {
    push(mat, box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    if (collide) L.collide(boxCollider((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0));
  };

  // ---------------------------------------------------------------- materials
  const floorTex = checkerTexture();
  floorTex.repeat.set(1 / 2.4, 1 / 2.4);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.32 });
  const wallTex = rep(paintedWallTexture('#cfd1ca', false, 'storewall'), 0.3, 0.3);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  const ceilTex = ceilingTexture();
  ceilTex.repeat.set(1 / 0.6, 1 / 0.6);
  const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.95 });
  const pillarMat = new THREE.MeshStandardMaterial({ map: rep(concreteTexture('#e8e6de'), 0.5, 1), roughness: 0.85 });
  const darkMat = std('#3a3c3e', 0.8);

  // floor and ceiling (planar uv in metres)
  const planar = (w, d, x, z, y, down = false) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
    g.translate(x, y, z);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
    return g;
  };
  const floor = new THREE.Mesh(planar(96, 100, 4, -48, 0), floorMat);
  floor.receiveShadow = true;
  L.add(floor);
  push(ceilMat, planar(80, 70, 0, -35, H, true));
  push(ceilMat, planar(80, 26, 0, -83, 5.2, true));
  push(ceilMat, planar(8, 40, 44, -40, 3.0, true));

  // ---------------------------------------------------------------- walls
  const T = 0.3;
  const wallX = (z, x0, x1, gaps, h = H, mat = wallMat) => {
    let x = x0;
    for (const [a, b, gh] of gaps) {
      if (a > x) solid(mat, x, a, 0, h, z - T / 2, z + T / 2);
      push(mat, box(b - a, h - gh, T, (a + b) / 2, gh + (h - gh) / 2, z));
      x = b;
    }
    if (x1 > x) solid(mat, x, x1, 0, h, z - T / 2, z + T / 2);
  };
  const wallZ = (x, z0, z1, gaps, h = H, mat = wallMat) => {
    let z = z0;
    for (const [a, b, gh] of gaps) {
      if (a > z) solid(mat, x - T / 2, x + T / 2, 0, h, z, a);
      push(mat, box(T, h - gh, b - a, x, gh + (h - gh) / 2, (a + b) / 2));
      z = b;
    }
    if (z1 > z) solid(mat, x - T / 2, x + T / 2, 0, h, z, z1);
  };
  // storefront: glass between x -12..12
  wallX(0, HALL.x0, -12, []); wallX(0, 12, HALL.x1, []);
  push(darkMat, box(24, 0.5, 0.25, 0, H - 0.25, 0));
  for (let x = -12; x <= 12; x += 3) push(darkMat, box(0.12, H, 0.2, x, H / 2, 0));
  push(new THREE.MeshBasicMaterial({ color: new THREE.Color('#eef2f0').multiplyScalar(2.2) }), box(24, H - 0.5, 0.05, 0, (H - 0.5) / 2, 0.6));
  push(std('#a8b8b8', 0.05, 0.3, { transparent: true, opacity: 0.25 }), box(24, H - 0.5, 0.03, 0, (H - 0.5) / 2, 0.05));
  L.collide(boxCollider(0, 0, 24, T));
  // back wall with two openings into the storage room
  wallX(HALL.z0, HALL.x0, HALL.x1, [[-26.5, -23.5, 2.7], [18.5, 21.5, 2.7]], 5.2);
  // side walls; the right one opens into the fitting room corridor
  wallZ(HALL.x0, HALL.z0, HALL.z1, []);
  wallZ(HALL.x1, HALL.z0, HALL.z1, [[-58, -55, 2.5], [-26, -23, 2.5]]);
  // storage room shell
  wallZ(STORE.x0, STORE.z0, STORE.z1, [], 5.2); wallZ(STORE.x1, STORE.z0, STORE.z1, [], 5.2);
  wallX(STORE.z0, STORE.x0, STORE.x1, [], 5.2);
  // fitting rooms / restroom corridor
  wallZ(48, -60, -20, [], 3.0); wallX(-60, 40, 48, [], 3.0); wallX(-20, 40, 48, [], 3.0);
  // dado line along the hall walls
  const dado = std('#8e8a80', 0.7);
  push(dado, box(80, 0.12, 0.05, 0, 1.0, HALL.z0 + 0.18)); push(dado, box(0.05, 0.12, 70, HALL.x0 + 0.18, 1.0, -35));

  // ---------------------------------------------------------------- pillars
  for (const x of [-30, -18, -6, 6, 18, 30]) {
    for (const z of [-12, -24, -36, -48, -60]) {
      if (x === -30 && (z === -24 || z === -12)) continue; // dance corner stays open
      solid(pillarMat, x - 0.4, x + 0.4, 0, H, z - 0.4, z + 0.4);
    }
  }
  // freestanding partition walls
  solid(wallMat, -12, -2, 0, 2.6, -44.15, -43.85);
  solid(wallMat, 24, 24.3, 0, 2.6, -20, -8);

  // ---------------------------------------------------------------- the old counter (cream with red stripes)
  const cream = std('#e9dcc2', 0.55), red = std('#c2202c', 0.45);
  solid(cream, -28, -16, 0, 1.05, -9.2, -8.2);
  solid(cream, -28, -27, 0, 1.05, -14, -9.2);
  push(cream, box(12.2, 0.06, 1.15, -22, 1.08, -8.7));
  for (const y of [0.15, 0.72]) {
    push(red, box(12.04, 0.12, 0.04, -22, y, -8.18));
    push(red, box(0.04, 0.12, 4.8, -27.98, y, -11.6));
  }
  // a pole and a dusty sign above the counter
  push(std('#f4f0e6', 0.6), box(0.12, H, 0.12, -15.6, H / 2, -8.7));
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 0.08), new THREE.MeshStandardMaterial({
    map: textTexture('КАССА', { width: 512, height: 128, bg: '#e8e2d4', fg: '#b8202c', border: '#b8202c', borderWidth: 8, radius: 10, font: 'bold 70px Arial', key: 'kassa' }), roughness: 0.8,
  }));
  sign.position.set(-22, 3.2, -8.7);
  L.add(sign);

  // ---------------------------------------------------------------- dance corner: mirrors, barres, blue curtain
  const mirror = std('#cfd8dc', 0.03, 1.0);
  push(mirror, box(0.04, 2.4, 18, HALL.x0 + 0.17, 1.5, -21));
  const chrome = std('#d8dcdc', 0.25, 0.9);
  for (const [z0, z1, x] of [[-30, -12, HALL.x0 + 0.6]]) {
    push(chrome, new THREE.CylinderGeometry(0.025, 0.025, z1 - z0, 8).rotateX(Math.PI / 2).translate(x, 1.0, (z0 + z1) / 2));
    for (let z = z0; z <= z1; z += 3) push(chrome, box(0.05, 1.0, 0.05, x, 0.5, z));
  }
  for (const z of [-27, -15]) {
    push(chrome, new THREE.CylinderGeometry(0.025, 0.025, 6, 8).rotateZ(Math.PI / 2).translate(-30, 1.0, z));
    for (const x of [-33, -27]) push(chrome, box(0.05, 1.0, 0.05, x, 0.5, z));
    L.collide(boxCollider(-30, z, 6.1, 0.15));
  }
  // blue curtain on the back wall of the hall (folds)
  {
    const g = new THREE.PlaneGeometry(12, 3.4, 60, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 5.2) * 0.08);
    g.computeVertexNormals();
    g.translate(-8, 1.9, HALL.z0 + 0.35);
    push(std('#1f6fd0', 0.7, 0, { side: THREE.DoubleSide }), g);
  }

  // ---------------------------------------------------------------- empty shelving and clothes racks
  const shelfMat = std('#9aa0a4', 0.5, 0.6);
  for (let k = 0; k < 6; k++) {
    const x = 11 + k * 4;
    for (const z0 of [-58, -42]) {
      const len = 12;
      push(shelfMat, box(0.9, 0.12, len, x, 0.1, z0 + len / 2));
      push(shelfMat, box(0.06, 1.7, len, x, 0.95, z0 + len / 2));
      for (const y of [0.55, 1.0, 1.45]) push(shelfMat, box(0.85, 0.03, len, x, y, z0 + len / 2));
      L.collide(boxCollider(x, z0 + len / 2, 1.0, len));
    }
  }
  for (let i = 0; i < 9; i++) {
    const x = -14 + (i % 3) * 5 + rnd(), z = -54 + Math.floor(i / 3) * 6 + rnd();
    push(chrome, new THREE.TorusGeometry(0.6, 0.02, 6, 24).rotateX(Math.PI / 2).translate(x, 1.35, z));
    push(chrome, box(0.04, 1.35, 0.04, x, 0.67, z));
    push(chrome, new THREE.CylinderGeometry(0.35, 0.35, 0.03, 16).translate(x, 0.02, z));
    L.collide({ type: 'circle', x, z, r: 0.65, enabled: true });
  }
  // a few faceless display mannequins
  const manMat = std('#f2efe8', 0.4);
  for (const [x, z, r] of [[-4, -30, 0.4], [-2.6, -31, -0.3], [33, -14, 2.2]]) {
    const m = mergeGeometries([
      new THREE.CylinderGeometry(0.16, 0.13, 0.6, 12).translate(0, 1.25, 0), new THREE.SphereGeometry(0.12, 12, 10).translate(0, 1.68, 0),
      new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8).translate(0, 0.5, 0), new THREE.CylinderGeometry(0.25, 0.25, 0.03, 16).translate(0, 0.02, 0),
    ].map((g) => g.toNonIndexed()));
    m.rotateY(r);
    m.translate(x, 0, z);
    push(manMat, m);
    L.collide({ type: 'circle', x, z, r: 0.3, enabled: true });
  }

  // ---------------------------------------------------------------- storage room clutter
  const cardboard = std('#b08a5a', 0.95), pallet = std('#a8865e', 0.9);
  for (let i = 0; i < 26; i++) {
    const x = -34 + rnd() * 68, z = -93 + rnd() * 18;
    if (Math.abs(x) < 5 && z < -86) continue;
    const n = 1 + Math.floor(rnd() * 4);
    push(pallet, box(1.2, 0.14, 1.0, x, 0.07, z));
    for (let k = 0; k < n; k++) push(cardboard, box(1.0 - rnd() * 0.3, 0.5, 0.8 - rnd() * 0.2, x + (rnd() - 0.5) * 0.15, 0.4 + k * 0.5, z + (rnd() - 0.5) * 0.15));
    L.collide(boxCollider(x, z, 1.3, 1.1));
  }
  for (const x of [-30, -10, 14, 30]) {
    push(shelfMat, box(0.1, 4.2, 10, x, 2.1, -82)); push(shelfMat, box(2.0, 0.08, 10, x, 1.4, -82)); push(shelfMat, box(2.0, 0.08, 10, x, 2.8, -82));
    L.collide(boxCollider(x, -82, 2.1, 10.2));
  }

  // ---------------------------------------------------------------- troffer lights
  const lights = [];
  for (let x = -37.5; x <= 37.5; x += 3) for (let z = -2.5; z >= -68; z -= 4) lights.push([x, H - 0.02, z, rnd()]);
  for (let x = -35; x <= 35; x += 7) for (let z = -74; z >= -94; z -= 7) lights.push([x, 5.18, z, rnd() * 1.4]);
  const panelGeo = new THREE.BoxGeometry(1.2, 0.04, 0.6);
  const panels = new THREE.InstancedMesh(panelGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), lights.length);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: '#e8f2e6', transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending,
  }), lights.length);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  const flicker = [];
  let np = 0;
  lights.forEach(([x, y, z, r], i) => {
    m4.makeTranslation(x, y, z);
    panels.setMatrixAt(i, m4);
    const lit = r < 0.72;
    c.set(lit ? '#f4fbf2' : '#4a4c48').multiplyScalar(lit ? 2.0 : 1);
    panels.setColorAt(i, c);
    if (r > 0.68 && r < 0.72) flicker.push(i);
    if (lit && i % 2 === 0) {
      m4.makeScale(4.6, 1, 4.6).setPosition(x, 0.015, z);
      pools.setMatrixAt(np++, m4);
    }
  });
  pools.count = np;
  panels.instanceColor.needsUpdate = true;
  pools.renderOrder = 4;
  L.add(panels, pools);
  L.onUpdate((dt, t) => {
    for (const i of flicker) {
      const on = Math.sin(t * 17 + i) + Math.sin(t * 5.3 + i * 2) > 0.6;
      c.set(on ? '#f4fbf2' : '#4a4c48').multiplyScalar(on ? 2.0 : 1);
      panels.setColorAt(i, c);
    }
    if (flicker.length) panels.instanceColor.needsUpdate = true;
  });

  // ---------------------------------------------------------------- merge
  for (const [mat, list] of G) {
    const mesh = new THREE.Mesh(mergeGeometries(list.map((g) => {
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      return g;
    })), mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    if (mat.transparent) mesh.renderOrder = 3;
    L.add(mesh);
  }

  // ---------------------------------------------------------------- light & air
  L.setupHemi('#e6eee6', '#6a5c58', 1.05);
  L.setupFogExp('#5d6862', 0.012);

  // ---------------------------------------------------------------- doors
  const greyDoor = { color: '#9aa4a8', frameColor: '#6a6e70' };
  L.makeDecoy(greyDoor, 47.85, 0, -30, -Math.PI / 2);
  L.makeDecoy(greyDoor, 47.85, 0, -40, -Math.PI / 2);
  L.makeDecoy(greyDoor, 47.85, 0, -50, -Math.PI / 2);
  L.makeDecoy({ color: '#d8d0c0', frameColor: '#8a8478' }, HALL.x0 + 0.17, 0, -40, Math.PI / 2);
  L.makeDoor({ color: '#c8ccc8', frameColor: '#7a7e80', glow: '#f4fff4', style: 'glass' }, 0, 0, STORE.z0 + 0.17, 0);
  const exit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.35, 0.1), new THREE.MeshBasicMaterial({
    map: canvasTexture(256, 96, (cc, w, h) => {
      cc.fillStyle = '#0e2a14'; cc.fillRect(0, 0, w, h);
      cc.fillStyle = '#5dff7a'; cc.font = 'bold 54px Arial'; cc.textAlign = 'center'; cc.textBaseline = 'middle';
      cc.fillText('ВЫХОД', w / 2, h / 2 + 2);
    }, { wrap: false }), color: new THREE.Color(2, 2, 2),
  }));
  exit.position.set(0, 2.75, STORE.z0 + 0.2);
  L.add(exit);

  L.groundHeight = () => 0;
  L.surface = () => 'tile';
  L.bounds = { type: 'box', x0: -39.9, x1: 47.9, z0: -96.1, z1: -0.1 };
  L.spawn = { x: 2, z: -3, yaw: 0.25, pitch: -0.05 };
  L.menuCam = { x: -24, z: -3.5, yaw: -0.35, y: 1.6, pitch: -0.12 };
  L.envFromScene(new THREE.Vector3(0, 2, -30), 0.6);
  L.far = 200;
  return L;
}
