import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase } from './common.js';
import { canvasTexture, glowTexture } from '../core/textures.js';
import { mulberry32 } from '../core/noise.js';
import { boxCollider } from '../props/props.js';

// The Backrooms, level 0: endless rooms of mono-yellow wallpaper, damp beige
// carpet and a low drop ceiling with unevenly spaced fluorescent lights.
// Completely silent.

const N = 30;       // cells per side
const C = 4.6;      // cell size
const H = 2.75;     // ceiling height
const X0 = -N * C / 2, Z0 = 0;
const WP_W = 1.2;   // wallpaper repeat width

function wallpaperTexture() {
  const rnd = mulberry32(19);
  return canvasTexture(256, 588, (c, w, h) => {
    c.fillStyle = '#cdb862'; c.fillRect(0, 0, w, h);
    // faint vertical chevron columns
    c.strokeStyle = 'rgba(150,128,52,0.22)'; c.lineWidth = 3;
    for (let col = 0; col < 4; col++) {
      const x0 = col * (w / 4) + w / 8;
      c.beginPath();
      for (let y = -20; y < h + 20; y += 26) { c.moveTo(x0 - 14, y); c.lineTo(x0, y + 13); c.lineTo(x0 + 14, y); }
      c.stroke();
    }
    c.fillStyle = 'rgba(170,150,70,0.18)';
    for (let col = 0; col < 4; col++) c.fillRect(col * (w / 4), 0, 3, h);
    for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '120,100,40' : '240,228,170'},${rnd() * 0.06})`; c.fillRect(rnd() * w, rnd() * h, 2, 2); }
    // water stains from the ceiling and grime near the floor
    for (let i = 0; i < 1; i++) {
      const x = rnd() * w, len = 60 + rnd() * 150;
      const g = c.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(120,96,40,0.1)'); g.addColorStop(1, 'rgba(120,96,40,0)');
      c.fillStyle = g; c.fillRect(x, 0, 20 + rnd() * 40, len);
    }
    const g2 = c.createLinearGradient(0, h * 0.8, 0, h);
    g2.addColorStop(0, 'rgba(90,70,30,0)'); g2.addColorStop(1, 'rgba(90,70,30,0.22)');
    c.fillStyle = g2; c.fillRect(0, h * 0.8, w, h * 0.2);
    // baseboard
    c.fillStyle = '#9c8748'; c.fillRect(0, h - 22, w, 22);
    c.fillStyle = 'rgba(255,240,190,0.25)'; c.fillRect(0, h - 22, w, 2);
  });
}

function carpetTexture() {
  const rnd = mulberry32(23);
  return canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#958146'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 40000; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '90,78,40' : '205,190,130'},${rnd() * 0.12})`; c.fillRect(rnd() * w, rnd() * h, 1, 1 + rnd() * 2); }
    for (let i = 0; i < 4; i++) {
      const x = rnd() * w, y = rnd() * h, r = 50 + rnd() * 140;
      const g = c.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, 'rgba(80,68,34,0.13)'); g.addColorStop(0.7, 'rgba(80,68,34,0.06)'); g.addColorStop(1, 'rgba(80,68,34,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2); c.fill();
    }
  });
}

function ceilingTexture() {
  const rnd = mulberry32(29);
  return canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#ddd3a2'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { c.fillStyle = `rgba(130,115,60,${rnd() * 0.14})`; c.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    c.strokeStyle = '#f2ecd2'; c.lineWidth = 5; c.strokeRect(0, 0, w, h);
  });
}

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  const rnd = mulberry32(1993);

  // ---------------------------------------------------------------- maze of rooms
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
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (east[i][j] && rnd() < 0.24) east[i][j] = false;
    if (south[i][j] && rnd() < 0.24) south[i][j] = false;
  }
  const cellX = (i) => X0 + i * C, cellZ = (j) => Z0 - j * C;
  const T = 0.22;
  const geos = [];
  const outlets = [];
  const wallBox = (cx, cz, w, d) => {
    geos.push(new THREE.BoxGeometry(w, H, d).translate(cx, H / 2, cz));
    L.collide(boxCollider(cx, cz, w + 0.02, d + 0.02));
    if (rnd() < 0.18) {
      const horiz = w > d;
      const side = rnd() < 0.5 ? -1 : 1;
      outlets.push(horiz ? [cx + (rnd() - 0.5) * w * 0.6, cz + side * (d / 2 + 0.01), 0] : [cx + side * (w / 2 + 0.01), cz + (rnd() - 0.5) * d * 0.6, Math.PI / 2]);
    }
  };
  const addWall = (x0, z0, x1, z1) => {
    const horiz = Math.abs(z1 - z0) < 1e-6;
    const len = Math.hypot(x1 - x0, z1 - z0);
    let a = 0, b = len;
    const r = rnd();
    if (r < 0.1) b = len * (0.45 + rnd() * 0.25); else if (r < 0.18) a = len * (0.3 + rnd() * 0.25);
    if (horiz) wallBox(Math.min(x0, x1) + (a + b) / 2, z0, b - a + T, T);
    else wallBox(x0, Math.max(z0, z1) - (a + b) / 2, T, b - a + T);
  };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (east[i][j] && i < N - 1) addWall(cellX(i + 1), cellZ(j), cellX(i + 1), cellZ(j + 1));
    if (south[i][j] && j < N - 1) addWall(cellX(i), cellZ(j + 1), cellX(i + 1), cellZ(j + 1));
  }
  const S = N * C;
  for (const [w, d, x, z] of [[S + T, T, 0, Z0], [S + T, T, 0, Z0 - S], [T, S + T, X0, Z0 - S / 2], [T, S + T, -X0, Z0 - S / 2]]) wallBox(x, z, w, d);
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    if (rnd() < 0.07) { const s = 0.6 + rnd() * 0.5; wallBox(cellX(i), cellZ(j), s, s); }
  }
  // wallpaper UVs: one pattern repeat per 1.2 m, full height
  const walls = mergeGeometries(geos.map((g) => {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) {
      const ax = Math.abs(n.getX(k)) > 0.5;
      uv.setXY(k, (ax ? p.getZ(k) : p.getX(k)) / WP_W, p.getY(k) / H);
    }
    return g;
  }));
  const wp = wallpaperTexture();
  wp.wrapS = THREE.RepeatWrapping; wp.wrapT = THREE.ClampToEdgeWrapping;
  const wm = new THREE.Mesh(walls, new THREE.MeshStandardMaterial({ map: wp, roughness: 0.92 }));
  wm.receiveShadow = true;
  L.add(wm);
  // wall outlets
  if (outlets.length) {
    const og = [];
    for (const [x, z, r] of outlets) og.push(new THREE.BoxGeometry(0.08, 0.12, 0.015).rotateY(r).translate(x, 0.32, z));
    L.add(new THREE.Mesh(mergeGeometries(og), new THREE.MeshStandardMaterial({ color: '#efeadc', roughness: 0.5 })));
  }

  // floor & ceiling
  const plane = (y, down, tex, rough, rep) => {
    const g = new THREE.PlaneGeometry(S + 2, S + 2);
    g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
    g.translate(0, y, Z0 - S / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) uv.setXY(k, p.getX(k) / rep, p.getZ(k) / rep);
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: rough }));
  };
  const floor = plane(0, false, carpetTexture(), 1.0, 7.0);
  floor.receiveShadow = true;
  L.add(floor, plane(H, true, ceilingTexture(), 0.95, 0.6));

  // ---------------------------------------------------------------- fluorescent troffers, unevenly spaced
  const lights = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (rnd() < 0.22) continue;
    const ox = Math.round((rnd() - 0.5) * 4) * 0.6, oz = Math.round((rnd() - 0.5) * 4) * 0.6;
    lights.push([cellX(i) + C / 2 + ox, cellZ(j) - C / 2 + oz, rnd()]);
  }
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.03, 0.6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), lights.length);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: '#fff3c0', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
  }), lights.length);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  const flicker = [];
  let np = 0;
  lights.forEach(([x, z, r], i) => {
    m4.makeTranslation(x, H - 0.015, z);
    panels.setMatrixAt(i, m4);
    const lit = r < 0.92;
    c.set(lit ? '#fffbe4' : '#6a6450').multiplyScalar(lit ? 2.4 : 1);
    panels.setColorAt(i, c);
    if (r > 0.88 && r < 0.92) flicker.push(i);
    if (lit) { m4.makeScale(5.5, 1, 5.5).setPosition(x, 0.01, z); pools.setMatrixAt(np++, m4); }
  });
  pools.count = np;
  pools.renderOrder = 4;
  L.add(panels, pools);
  L.onUpdate((dt, t) => {
    for (const i of flicker) {
      const on = Math.sin(t * 29 + i * 3) + Math.sin(t * 3.1 + i) > 0.2;
      c.set(on ? '#fffbe4' : '#6a6450').multiplyScalar(on ? 2.4 : 1);
      panels.setColorAt(i, c);
    }
    if (flicker.length) panels.instanceColor.needsUpdate = true;
  });

  // ---------------------------------------------------------------- light & air: flat, bright, yellow
  L.setupHemi('#fff4c4', '#8a7a46', 1.55);
  L.setupFogExp('#cdbd7c', 0.011);
  L.envFromScene(new THREE.Vector3(X0 + C / 2, 1.5, -C / 2), 0.35);

  // ---------------------------------------------------------------- doors (against the outer walls)
  const yellow = { color: '#c4b06a', frameColor: '#9c8748' };
  L.makeDecoy(yellow, X0 + 0.33, 0, -43.7, Math.PI / 2);
  L.makeDecoy(yellow, -X0 - 0.33, 0, -66.7, -Math.PI / 2);
  L.makeDecoy(yellow, -29.9, 0, Z0 - S + 0.33, 0);
  L.makeDecoy(yellow, X0 + 0.33, 0, -112.7, Math.PI / 2);
  L.makeDoor({ color: '#d2c07c', frameColor: '#9c8748', glow: '#fff8e0', style: 'panel' }, 52.9, 0, Z0 - S + 0.33, 0);

  L.groundHeight = () => 0;
  L.surface = () => 'carpet';
  L.bounds = { type: 'box', x0: X0, x1: -X0, z0: Z0 - S, z1: Z0 };
  L.spawn = { x: X0 + C / 2, z: -C / 2, yaw: -Math.PI * 0.25, pitch: 0 };
  L.menuCam = { x: X0 + C / 2, z: -C / 2, yaw: -Math.PI * 0.3, y: 1.5, pitch: 0.05 };
  L.far = 140;
  return L;
}
