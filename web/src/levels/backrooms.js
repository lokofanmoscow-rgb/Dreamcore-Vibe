import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase } from './common.js';
import { canvasTexture, glowTexture } from '../core/textures.js';
import { mulberry32 } from '../core/noise.js';
import { boxCollider } from '../props/props.js';

// Endless yellowed concrete: a large procedural maze of thick wall slabs and
// wide openings under a drop ceiling of humming fluorescent panels.

const N = 22;      // cells per side
const C = 7;       // cell size (m)
const H = 3.0;     // ceiling
const X0 = -N * C / 2, Z0 = 0; // maze spans x [X0, -X0], z [-N*C, 0]

function wallTexture() {
  const rnd = mulberry32(31);
  return canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#b8ab7a'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '70,60,30' : '230,220,170'},${rnd() * 0.07})`; c.fillRect(rnd() * w, rnd() * h, 2, 2); }
    for (let i = 0; i < 40; i++) {
      const x = rnd() * w, len = 40 + rnd() * 200;
      const g = c.createLinearGradient(0, h - len, 0, h);
      g.addColorStop(0, 'rgba(60,50,20,0)'); g.addColorStop(1, `rgba(60,50,20,${0.1 + rnd() * 0.15})`);
      c.fillStyle = g; c.fillRect(x, h - len, 6 + rnd() * 20, len);
    }
    const g = c.createLinearGradient(0, h * 0.75, 0, h);
    g.addColorStop(0, 'rgba(50,40,20,0)'); g.addColorStop(1, 'rgba(50,40,20,0.3)');
    c.fillStyle = g; c.fillRect(0, h * 0.75, w, h * 0.25);
  });
}

function floorTexture() {
  const rnd = mulberry32(37);
  return canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#a89c78'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 12000; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '60,50,30' : '220,210,170'},${rnd() * 0.06})`; c.fillRect(rnd() * w, rnd() * h, 2, 2); }
    for (let i = 0; i < 12; i++) {
      const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 80;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(70,60,30,0.22)'); g.addColorStop(1, 'rgba(70,60,30,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
  });
}

function ceilingTexture() {
  return canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#cbbd84'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { c.fillStyle = `rgba(110,95,50,${Math.random() * 0.12})`; c.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    c.strokeStyle = '#efe6c2'; c.lineWidth = 4;
    c.strokeRect(0, 0, w, h);
  });
}

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  const q = ctx.q;
  const rnd = mulberry32(1993);

  // ---------------------------------------------------------------- maze
  const east = [], south = [];
  for (let i = 0; i < N; i++) { east.push(new Array(N).fill(true)); south.push(new Array(N).fill(true)); }
  const seen = new Set(['0,0']);
  const stack = [[0, 0]];
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [i + a, j + b, a, b])
      .filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N && !seen.has(a + ',' + b));
    if (!nb.length) { stack.pop(); continue; }
    const [a, b, di, dj] = nb[Math.floor(rnd() * nb.length)];
    if (di === 1) east[i][j] = false; if (di === -1) east[a][b] = false;
    if (dj === 1) south[i][j] = false; if (dj === -1) south[a][b] = false;
    seen.add(a + ',' + b);
    stack.push([a, b]);
  }
  // open it up: remove most walls so it reads as wide, irregular halls
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (east[i][j] && rnd() < 0.5) east[i][j] = false;
    if (south[i][j] && rnd() < 0.5) south[i][j] = false;
  }
  const cellX = (i) => X0 + i * C, cellZ = (j) => Z0 - j * C;
  const geos = [];
  const T = 0.6;
  const addWall = (x0, z0, x1, z1) => {
    const horiz = Math.abs(z1 - z0) < 1e-6;
    const len = Math.hypot(x1 - x0, z1 - z0);
    // some walls are shorter, leaving a gap at one end
    let a = 0, b = len;
    const r = rnd();
    if (r < 0.2) b = len * (0.45 + rnd() * 0.3); else if (r < 0.35) a = len * (0.25 + rnd() * 0.3);
    const cx = horiz ? Math.min(x0, x1) + (a + b) / 2 : x0, cz = horiz ? z0 : Math.max(z0, z1) - (a + b) / 2;
    const w = horiz ? b - a + T : T, d = horiz ? T : b - a + T;
    geos.push(new THREE.BoxGeometry(w, H, d).translate(cx, H / 2, cz));
    L.collide(boxCollider(cx, cz, w, d));
  };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (east[i][j] && i < N - 1) addWall(cellX(i + 1), cellZ(j), cellX(i + 1), cellZ(j + 1));
    if (south[i][j] && j < N - 1) addWall(cellX(i), cellZ(j + 1), cellX(i + 1), cellZ(j + 1));
  }
  // outer walls
  const S = N * C;
  for (const [w, d, x, z] of [[S + T, T, 0, Z0], [S + T, T, 0, Z0 - S], [T, S + T, X0, Z0 - S / 2], [T, S + T, -X0, Z0 - S / 2]]) {
    geos.push(new THREE.BoxGeometry(w, H, d).translate(x, H / 2, z));
    L.collide(boxCollider(x, z, w, d));
  }
  // thick square pillars at some corners
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    if (rnd() < 0.12) {
      const x = cellX(i), z = cellZ(j), s = 1.0 + rnd() * 1.2;
      geos.push(new THREE.BoxGeometry(s, H, s).translate(x, H / 2, z));
      L.collide(boxCollider(x, z, s, s));
    }
  }
  const wt = wallTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.95 });
  // box UVs per metre
  const walls = mergeGeometries(geos.map((g) => {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) {
      const ax = Math.abs(n.getX(k)) > 0.5;
      const ay = Math.abs(n.getY(k)) > 0.5;
      uv.setXY(k, (ay ? p.getX(k) : ax ? p.getZ(k) : p.getX(k)) / 4, (ay ? p.getZ(k) : p.getY(k)) / 4);
    }
    return g;
  }));
  const wm = new THREE.Mesh(walls, wallMat);
  wm.receiveShadow = true;
  L.add(wm);

  // floor & ceiling
  const plane = (y, down, tex, rough) => {
    const g = new THREE.PlaneGeometry(S + 2, S + 2);
    g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
    g.translate(0, y, Z0 - S / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) uv.setXY(k, p.getX(k), p.getZ(k));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: rough }));
    m.receiveShadow = true;
    return m;
  };
  const ft = floorTexture(); ft.repeat.set(1 / 6, 1 / 6);
  const ct = ceilingTexture(); ct.repeat.set(1 / 0.6, 1 / 0.6);
  L.add(plane(0, false, ft, 0.7), plane(H, true, ct, 0.95));

  // ---------------------------------------------------------------- fluorescent panels
  const lights = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) lights.push([cellX(i) + C / 2, cellZ(j) - C / 2, rnd()]);
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.04, 0.6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), lights.length);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: '#fff0b8', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending,
  }), lights.length);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  const flicker = [];
  let np = 0;
  lights.forEach(([x, z, r], i) => {
    m4.makeTranslation(x, H - 0.02, z);
    panels.setMatrixAt(i, m4);
    const lit = r < 0.7;
    c.set(lit ? '#fff6d8' : '#5a5440').multiplyScalar(lit ? 2.3 : 1);
    panels.setColorAt(i, c);
    if (r > 0.64 && r < 0.7) flicker.push(i);
    if (lit) { m4.makeScale(7.5, 1, 7.5).setPosition(x, 0.015, z); pools.setMatrixAt(np++, m4); }
  });
  pools.count = np;
  pools.renderOrder = 4;
  L.add(panels, pools);
  L.onUpdate((dt, t) => {
    for (const i of flicker) {
      const on = Math.sin(t * 23 + i * 3) + Math.sin(t * 2.7 + i) > 0.3;
      c.set(on ? '#fff6d8' : '#5a5440').multiplyScalar(on ? 2.3 : 1);
      panels.setColorAt(i, c);
    }
    if (flicker.length) panels.instanceColor.needsUpdate = true;
  });

  // ---------------------------------------------------------------- light & air
  L.setupHemi('#f2e4b0', '#4a4024', 1.3);
  L.setupFogExp('#3a3422', 0.025);
  L.envFromScene(new THREE.Vector3(0, 1.5, -3.5), 0.4);

  // ---------------------------------------------------------------- doors (all against the outer walls)
  const yellow = { color: '#b0a272', frameColor: '#8a7e56' };
  L.makeDecoy(yellow, X0 + 0.45, 0, -40.5, Math.PI / 2);
  L.makeDecoy(yellow, -X0 - 0.45, 0, -66.5, -Math.PI / 2);
  L.makeDecoy(yellow, -30.5, 0, Z0 - S + 0.45, 0);
  L.makeDecoy(yellow, X0 + 0.45, 0, -122.5, Math.PI / 2);
  L.makeDoor({ color: '#c8b88a', frameColor: '#8a7e56', glow: '#fff8e0', style: 'panel' }, 52.5, 0, Z0 - S + 0.45, 0);

  L.groundHeight = () => 0;
  L.surface = () => 'concrete';
  L.bounds = { type: 'box', x0: X0 + 0.4, x1: -X0 - 0.4, z0: Z0 - S + 0.4, z1: Z0 - 0.4 };
  L.spawn = { x: X0 + C / 2, z: -C / 2, yaw: -Math.PI * 0.25, pitch: 0 };
  L.menuCam = { x: X0 + C / 2, z: -C / 2, yaw: -Math.PI * 0.3, y: 1.5, pitch: 0.05 };
  L.far = 160;
  return L;
}
