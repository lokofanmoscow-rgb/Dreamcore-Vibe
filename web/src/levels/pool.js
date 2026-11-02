import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water2.js';
import { LevelBase, floatingMotes } from './common.js';
import { tileTexture, waterNormalTexture, nrm, glowTexture } from '../core/textures.js';

// Enclosed poolrooms: vaulted tiled tunnels, tall white atriums with chunky
// stairs, dark still water in basins with chrome railings, and daylight that
// only comes in through a few windows on one side of the building.

const FL = 0.4;     // walkway floor
const PB = -1.2;    // pool bottom
const WL = 0.0;     // water surface
const T = 0.4;      // wall thickness

// ---------------------------------------------------------------- geometry helpers
function tiledBox(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  }
  g.translate(x, y, z);
  return g;
}

function clean(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g.index ? g.toNonIndexed() : g;
}

function merged(list) { return mergeGeometries(list.map(clean)); }

const PoolWaterShader = {
  ...Water.WaterShader,
  uniforms: { ...Water.WaterShader.uniforms, uSun: { value: new THREE.Vector3(0.78, 0.55, 0.22).normalize() } },
  fragmentShader: /* glsl */`
    #include <common>
    #include <fog_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    uniform sampler2D tReflectionMap, tRefractionMap, tNormalMap0, tNormalMap1;
    uniform vec2 flowDirection;
    uniform vec3 color, uSun;
    uniform float reflectivity;
    uniform vec4 config;
    varying vec4 vCoord;
    varying vec2 vUv;
    varying vec3 vToEye;
    void main() {
      #include <logdepthbuf_fragment>
      float scale = config.w;
      vec2 flow = flowDirection;
      vec3 n0 = texture2D(tNormalMap0, vUv * scale + flow * config.x).rgb * 2.0 - 1.0;
      vec3 n1 = texture2D(tNormalMap1, vUv * scale * 0.61 - flow.yx * config.y + 0.37).rgb * 2.0 - 1.0;
      vec3 nm = normalize(vec3(n0.x + n1.x, n0.z + n1.z, n0.y + n1.y));
      vec3 normal = normalize(mix(vec3(0.0, 1.0, 0.0), nm, 0.28));
      vec3 toEye = normalize(vToEye);
      float cosT = max(dot(toEye, normal), 0.0);
      float fres = reflectivity + (1.0 - reflectivity) * pow(1.0 - cosT, 4.0);
      vec3 coord = vCoord.xyz / vCoord.w;
      vec2 d = normal.xz * 0.02;
      vec3 refl = texture2D(tReflectionMap, vec2(1.0 - coord.x - d.x, coord.y + d.y)).rgb;
      vec3 refr = texture2D(tRefractionMap, coord.xy + d * 1.3).rgb * vec3(0.2, 0.32, 0.3);
      vec3 col = mix(refr, refl, clamp(0.25 + fres * 0.75, 0.0, 1.0)) * color;
      vec3 h = normalize(uSun + toEye);
      col += vec3(1.0, 0.98, 0.92) * pow(max(dot(normal, h), 0.0), 600.0) * 2.0;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
};

const shaftVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const shaftFrag = /* glsl */`
  uniform vec3 uColor; uniform float uTime, uStrength;
  varying vec2 vUv;
  void main() {
    float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
    float along = smoothstep(0.0, 0.08, vUv.y) * (1.0 - vUv.y * 0.6);
    float a = edge * along * (0.85 + 0.15 * sin(uTime * 0.5 + vUv.x * 9.0)) * uStrength;
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  const q = ctx.q;
  const toSun = new THREE.Vector3(0.78, 0.55, 0.22).normalize();
  const ray = toSun.clone().negate();

  // ---------------------------------------------------------------- materials
  const wallTex = tileTexture('#f2f7f5', '#c9d4d0', 8, 'pr_wall', 0.03, 1024);
  const floorTex = tileTexture('#eef3f1', '#c0ccc8', 5, 'pr_floor', 0.025, 1024);
  const poolTex = tileTexture('#3e6f68', '#284a45', 8, 'pr_pool', 0.04, 512);
  const mk = (tex, color, rough, extra = {}) => new THREE.MeshStandardMaterial({
    map: tex, normalMap: nrm(tex), normalScale: new THREE.Vector2(0.3, 0.3), color, roughness: rough, side: THREE.DoubleSide, ...extra,
  });
  const M = {
    hall: mk(wallTex, '#ffffff', 0.22),
    tunnel: mk(wallTex, '#eef5f3', 0.14),
    floor: mk(floorTex, '#ffffff', 0.12),
    pool: mk(poolTex, '#ffffff', 0.3),
    dark: new THREE.MeshBasicMaterial({ color: '#05080a' }),
    chrome: new THREE.MeshStandardMaterial({ color: '#d6dede', metalness: 1.0, roughness: 0.22 }),
    pane: new THREE.MeshBasicMaterial({ color: new THREE.Color('#f2fbff').multiplyScalar(3.6), fog: false }),
    dimPane: new THREE.MeshBasicMaterial({ color: new THREE.Color('#dbeae8').multiplyScalar(1.15) }),
  };
  const G = { hall: [], tunnel: [], floor: [], pool: [], dark: [], chrome: [], pane: [], dimPane: [] };

  // ---------------------------------------------------------------- walkable surfaces
  const floors = [];  // {x0,x1,z0,z1,y}
  const ramps = [];   // {axis, from, to, a0, a1, y0, y1, n}
  const pools = [];   // basin rectangles (bottom at PB)
  const addFloor = (x0, x1, z0, z1, y = FL, thick = 0.6, list = G.floor, walk = true) => {
    list.push(tiledBox(x1 - x0, thick, z1 - z0, (x0 + x1) / 2, y - thick / 2, (z0 + z1) / 2));
    if (walk) floors.push({ x0, x1, z0, z1, y });
  };
  const addPool = (x0, x1, z0, z1) => {
    pools.push({ x0, x1, z0, z1 });
    G.pool.push(tiledBox(x1 - x0, 0.3, z1 - z0, (x0 + x1) / 2, PB - 0.15, (z0 + z1) / 2));
    const h = FL - PB, c = (FL + PB) / 2, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    G.pool.push(tiledBox(x1 - x0, h, 0.05, mx, c, z0 + 0.025), tiledBox(x1 - x0, h, 0.05, mx, c, z1 - 0.025),
      tiledBox(0.05, h, z1 - z0, x0 + 0.025, c, mz), tiledBox(0.05, h, z1 - z0, x1 - 0.025, c, mz));
  };
  const SLAB = FL - PB; // bridges and islands stand on the pool floor
  const solid = (x0, x1, y0, y1, z0, z1, list = G.hall) => {
    const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    list.push(tiledBox(x1 - x0, yb - ya, z1 - z0, (x0 + x1) / 2, (ya + yb) / 2, (z0 + z1) / 2));
  };

  const coll = (c) => { L.colliders.push(c); return c; };
  const obox = (x, z, w, d, y0, y1) => coll({ type: 'obox', x, z, hw: w / 2, hd: d / 2, rot: 0, enabled: true, y0, y1 });

  // wall with arched / rectangular holes. axis 'x': wall runs along x at constant z.
  const wall = (axis, at, a0, a1, y0, y1, holes = [], list = G.hall) => {
    const len = a1 - a0, hgt = y1 - y0;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, hgt); shape.lineTo(0, hgt); shape.lineTo(0, 0);
    for (const h of holes) {
      const u0 = h.c - a0 - h.w / 2, u1 = h.c - a0 + h.w / 2, v0 = h.b - y0;
      const p = new THREE.Path();
      if (h.arch) {
        const r = h.w / 2, vs = v0 + h.h - r;
        p.moveTo(u0, v0); p.lineTo(u1, v0); p.lineTo(u1, vs);
        p.absarc(u0 + r, vs, r, 0, Math.PI, false);
        p.lineTo(u0, v0);
      } else {
        p.moveTo(u0, v0); p.lineTo(u1, v0); p.lineTo(u1, v0 + h.h); p.lineTo(u0, v0 + h.h); p.lineTo(u0, v0);
      }
      shape.holes.push(p);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 14 });
    if (axis === 'x') g.translate(a0, y0, at - T / 2);
    else { g.rotateY(-Math.PI / 2); g.translate(at + T / 2, y0, a0); }
    list.push(g);
    // colliders in height bands so doorways on upper levels don't open lower ones
    const doors = holes.filter((h) => h.door);
    const levels = [...new Set(doors.map((h) => h.b))].sort((a, b) => a - b);
    const band = (lo, hi, gaps) => {
      let s = a0;
      const segs = [];
      for (const gp of gaps.sort((p, r) => p.c - r.c)) { segs.push([s, gp.c - gp.w / 2 + 0.05]); s = gp.c + gp.w / 2 - 0.05; }
      segs.push([s, a1]);
      for (const [p0, p1] of segs) {
        if (p1 - p0 < 0.05) continue;
        if (axis === 'x') obox((p0 + p1) / 2, at, p1 - p0, T, lo, hi);
        else obox(at, (p0 + p1) / 2, T, p1 - p0, lo, hi);
      }
    };
    if (!levels.length) band(y0 - 5, y1, []);
    else {
      band(y0 - 5, levels[0] + 0.05, []);
      levels.forEach((lv, i) => band(lv + 0.05, i + 1 < levels.length ? levels[i + 1] + 0.05 : y1, doors.filter((h) => h.b === lv)));
    }
  };

  // vaulted tunnel along an axis. axis 'z': runs from c0 to c1 along z, centred on x = at.
  const tunnel = (axis, at, c0, c1, w = 2.6, wallH = 1.9, floorY = FL, list = G.tunnel, floor = true) => {
    const a = Math.min(c0, c1), b = Math.max(c0, c1), len = b - a, r = w / 2;
    const sides = [], vault = new THREE.CylinderGeometry(r, r, len, 22, 1, true, Math.PI / 2, Math.PI);
    const uv = vault.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * r, uv.getY(i) * len);
    vault.rotateX(Math.PI / 2);
    if (axis === 'z') {
      vault.translate(at, floorY + wallH, (a + b) / 2);
      sides.push(tiledBox(T, wallH, len, at - r - T / 2, floorY + wallH / 2, (a + b) / 2), tiledBox(T, wallH, len, at + r + T / 2, floorY + wallH / 2, (a + b) / 2));
      obox(at - r - T / 2 + 0.05, (a + b) / 2, T, len, floorY - 5, floorY + wallH + r);
      obox(at + r + T / 2 - 0.05, (a + b) / 2, T, len, floorY - 5, floorY + wallH + r);
      if (floor) addFloor(at - r, at + r, a, b, floorY);
    } else {
      vault.rotateY(Math.PI / 2);
      vault.translate((a + b) / 2, floorY + wallH, at);
      sides.push(tiledBox(len, wallH, T, (a + b) / 2, floorY + wallH / 2, at - r - T / 2), tiledBox(len, wallH, T, (a + b) / 2, floorY + wallH / 2, at + r + T / 2));
      obox((a + b) / 2, at - r - T / 2 + 0.05, len, T, floorY - 5, floorY + wallH + r);
      obox((a + b) / 2, at + r + T / 2 - 0.05, len, T, floorY - 5, floorY + wallH + r);
      if (floor) addFloor(a, b, at - r, at + r, floorY);
    }
    list.push(vault, ...sides);
    // outer shell so the vault never shows its back
    if (axis === 'z') list.push(tiledBox(w + 2 * T, 0.3, len, at, floorY + wallH + r + 0.25, (a + b) / 2));
    else list.push(tiledBox(len, 0.3, w + 2 * T, (a + b) / 2, floorY + wallH + r + 0.25, at));
  };
  const ARCH = (c, b, w = 2.6, h = 3.2) => ({ c, b, w, h, arch: true, door: true });

  // chrome railing along a straight line (optionally sloped: y0 -> y1)
  const railing = (x0, z0, x1, z1, y0, y1 = y0, block = true) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 1.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
      const p = new THREE.CylinderGeometry(0.025, 0.025, 1.05, 6);
      p.translate(x, y + 0.525, z);
      G.chrome.push(p);
    }
    for (const hh of [1.05, 0.55]) {
      const a = new THREE.Vector3(x0, y0 + hh, z0), b = new THREE.Vector3(x1, y1 + hh, z1);
      const c = new THREE.CylinderGeometry(0.03, 0.03, a.distanceTo(b), 6);
      c.translate(0, a.distanceTo(b) / 2, 0);
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
      c.translate(a.x, a.y, a.z);
      G.chrome.push(c);
    }
    if (block) coll({ type: 'obox', x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: 0.08, hd: len / 2, rot: Math.atan2(x1 - x0, z1 - z0), enabled: true, y0: Math.min(y0, y1) - 0.2, y1: Math.max(y0, y1) + 1.05 });
  };

  // straight flight of stairs. axis 'z' or 'x'; climbs from `from` (y0) to `to` (y1)
  const stairs = ({ axis, from, to, a0, a1, y0, y1, n, base = null, list = G.hall, walk = true, rail = null }) => {
    const dir = Math.sign(to - from), run = Math.abs(to - from) / n, rise = (y1 - y0) / n;
    const b = base === null ? y0 : base;
    for (let i = 0; i < n; i++) {
      const s0 = from + dir * i * run, s1 = from + dir * (i + 1) * run;
      const top = y0 + (i + 1) * rise;
      if (axis === 'z') solid(a0, a1, b, top, Math.min(s0, s1), Math.max(s0, s1), list);
      else solid(Math.min(s0, s1), Math.max(s0, s1), b, top, a0, a1, list);
    }
    if (walk) ramps.push({ axis, from, to, a0, a1, y0, y1, n });
    if (rail !== null) {
      if (axis === 'z') railing(rail, from, rail, to, y0 + rise, y1);
      else railing(from, rail, to, rail, y0 + rise, y1);
    }
  };

  // window with a bright pane behind it (lit) or a soft glow (unlit)
  const shafts = [];
  const windowPane = (axis, at, c, b, w, h, lit, outward) => {
    const off = outward * (T / 2 + 0.05);
    if (axis === 'x') (lit ? G.pane : G.dimPane).push(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.05).translate(c, b + h / 2, at + off));
    else (lit ? G.pane : G.dimPane).push(new THREE.BoxGeometry(0.05, h + 0.2, w + 0.2).translate(at + off, b + h / 2, c));
    if (lit) shafts.push({ axis, at, c, b, w, h });
  };

  // ======================================================================== LAYOUT
  // ---------------------------------------------------------------- tunnel 1 (start)
  tunnel('z', 0, -30, 4.5);
  wall('x', 4.6, -1.7, 1.7, FL - 0.6, FL + 3.6);           // closed end behind the spawn

  // ---------------------------------------------------------------- atrium A1
  const A1 = { x0: -14, x1: 14, z0: -62, z1: -30, top: 18 };
  // walkways and the pool
  addFloor(A1.x0, A1.x1, -33.5, A1.z1);
  addFloor(A1.x0, -11, A1.z0, -33.5);
  addFloor(11, A1.x1, A1.z0, -33.5);
  addFloor(-11, 11, A1.z0, -58.5);
  addFloor(-1.2, 1.2, -44, -33.5, FL, SLAB);            // bridge
  addFloor(-4, 4, -50, -44, FL, SLAB);                  // island
  addPool(-11, 11, -58.5, -33.5);
  // walls
  wall('x', A1.z1, A1.x0, A1.x1, PB, A1.top, [ARCH(0, FL)]);
  wall('x', A1.z0, A1.x0, A1.x1, PB, A1.top, [ARCH(-8, FL), ARCH(8, 6.4), { c: -6, b: 12, w: 2, h: 2 }, { c: 6, b: 14, w: 1.6, h: 1.6 }]);
  wall('z', A1.x0, A1.z0, A1.z1, PB, A1.top, [ARCH(-46, FL), { c: -38, b: 9, w: 1.8, h: 1.8 }, { c: -54, b: 12.5, w: 1.6, h: 1.6 }]);
  wall('z', A1.x1, A1.z0, A1.z1, PB, A1.top, [{ c: -40, b: 9.2, w: 2.4, h: 2.4 }, { c: -52, b: 9.2, w: 2.4, h: 2.4 }, { c: -46, b: 14.5, w: 1.6, h: 1.6 }]);
  windowPane('z', A1.x1, -40, 9.2, 2.4, 2.4, true, 1);
  windowPane('z', A1.x1, -52, 9.2, 2.4, 2.4, true, 1);
  windowPane('z', A1.x1, -46, 14.5, 1.6, 1.6, true, 1);
  windowPane('z', A1.x0, -38, 9, 1.8, 1.8, false, -1);
  windowPane('z', A1.x0, -54, 12.5, 1.6, 1.6, false, -1);
  windowPane('x', A1.z0, -6, 12, 2, 2, false, -1);
  windowPane('x', A1.z0, 6, 14, 1.6, 1.6, false, -1);
  // ceiling with a dark opening
  const hole = { x0: -3, x1: 3, z0: -49, z1: -43 };
  solid(A1.x0 - T, A1.x1 + T, A1.top, A1.top + 0.5, A1.z0 - T, hole.z0);
  solid(A1.x0 - T, A1.x1 + T, A1.top, A1.top + 0.5, hole.z1, A1.z1 + T);
  solid(A1.x0 - T, hole.x0, A1.top, A1.top + 0.5, hole.z0, hole.z1);
  solid(hole.x1, A1.x1 + T, A1.top, A1.top + 0.5, hole.z0, hole.z1);
  G.dark.push(new THREE.BoxGeometry(6, 10, 6).translate(0, A1.top + 5, -46));
  railing(hole.x0, hole.z0, hole.x1, hole.z0, A1.top + 0.5, A1.top + 0.5, false);
  railing(hole.x0, hole.z1, hole.x1, hole.z1, A1.top + 0.5, A1.top + 0.5, false);
  // railings around the water
  railing(-11, -33.6, -1.3, -33.6, FL); railing(1.3, -33.6, 11, -33.6, FL);
  railing(-10.9, -33.6, -10.9, -53, FL); railing(10.9, -33.6, 10.9, -58.4, FL);
  railing(-9.3, -58.4, -1.5, -58.4, FL); railing(1.5, -58.4, 11, -58.4, FL);
  railing(-1.3, -33.6, -1.3, -44, FL); railing(1.3, -33.6, 1.3, -44, FL);
  railing(-4, -44.1, -1.3, -44.1, FL); railing(1.3, -44.1, 4, -44.1, FL);
  railing(-4.1, -44, -4.1, -50, FL); railing(4.1, -44, 4.1, -50, FL);
  // pool steps (a way out of the water) in the left basin corner
  stairs({ axis: 'z', from: -53.5, to: -58.5, a0: -10.95, a1: -9.4, y0: PB, y1: FL, n: 5, base: PB });
  // the grand stair: island -> balcony
  stairs({ axis: 'z', from: -50, to: -58.5, a0: -1.4, a1: 1.4, y0: FL, y1: 6.4, n: 20, base: PB });
  railing(-1.45, -50, -1.45, -58.5, FL + 0.3, 6.4); railing(1.45, -50, 1.45, -58.5, FL + 0.3, 6.4);
  // balcony along the back wall
  addFloor(A1.x0, A1.x1, A1.z0, -58.5, 6.4, 0.6, G.hall);
  railing(A1.x0, -58.45, -1.5, -58.45, 6.4); railing(1.5, -58.45, A1.x1, -58.45, 6.4);
  obox(0, -58.5, 2.8, 0.3, FL - 0.5, 6.2); // back face of the grand stair at walkway level
  // arch stubs with locked doors
  tunnel('z', -8, -66, -62, 2.6, 1.9, FL, G.tunnel);
  wall('x', -66, -9.5, -6.5, FL - 0.6, FL + 3.6);
  tunnel('x', -46, -18, -14, 2.6, 1.9, FL, G.tunnel);
  wall('z', -18, -47.5, -44.5, FL - 0.6, FL + 3.6);
  // Escher stairs that lead nowhere
  stairs({ axis: 'z', from: -34, to: -46, a0: -14, a1: -12, y0: 8.6, y1: 14.6, n: 16, base: 8.2, walk: false });
  solid(-14, -10, 8.2, 8.6, -34, -30);
  stairs({ axis: 'x', from: 13.9, to: 6, a0: -62, a1: -60, y0: 11, y1: 15.5, n: 12, base: 10.6, walk: false });
  solid(4, 6, 10.6, 15.5, -62, -59);
  stairs({ axis: 'z', from: -31, to: -38, a0: 6, a1: 8.5, y0: A1.top - 0.2, y1: A1.top - 4, n: 10, base: A1.top - 0.2, walk: false });

  // ---------------------------------------------------------------- tunnel 2 (balcony -> long hall), tall and stepped down
  tunnel('z', 8, -96, -62, 2.6, 7.9, FL, G.tunnel, false);
  addFloor(6.7, 9.3, -66, -62, 6.4, 6.6, G.tunnel);
  stairs({ axis: 'z', from: -80, to: -66, a0: 6.7, a1: 9.3, y0: FL, y1: 6.4, n: 20, list: G.tunnel });
  addFloor(6.7, 9.3, -96, -80, FL, 0.6, G.tunnel);
  // note: the stair is walked downwards; register it climbing from the bottom
  // ---------------------------------------------------------------- long hall H2
  const H2 = { x0: -4, x1: 20, z0: -134, z1: -96, top: 10 };
  addFloor(H2.x0, 0, H2.z0, H2.z1);
  addFloor(16, H2.x1, H2.z0, H2.z1);
  addFloor(0, 16, -100, H2.z1);
  addFloor(0, 16, H2.z0, -130);
  addFloor(0, 16, -117, -115, FL, SLAB); // bridge
  addPool(0, 16, -130, -100);
  wall('x', H2.z1, H2.x0, H2.x1, PB, H2.top, [ARCH(8, FL)]);
  wall('x', H2.z0, H2.x0, H2.x1, PB, H2.top, [ARCH(8, FL), { c: 2, b: 6, w: 1.6, h: 1.6 }]);
  wall('z', H2.x0, H2.z0, H2.z1, PB, H2.top, [ARCH(-106, FL), ARCH(-124, FL), { c: -115, b: 6, w: 1.6, h: 1.6 }]);
  const h2win = [-104, -112, -120, -128];
  wall('z', H2.x1, H2.z0, H2.z1, PB, H2.top, h2win.map((c, i) => ({ c, b: 4.6, w: 2.2, h: i === 2 ? 1.4 : 2.6 })));
  h2win.forEach((c, i) => windowPane('z', H2.x1, c, 4.6, 2.2, i === 2 ? 1.4 : 2.6, i !== 2, 1));
  windowPane('z', H2.x0, -115, 6, 1.6, 1.6, false, -1);
  windowPane('x', H2.z0, 2, 6, 1.6, 1.6, false, -1);
  solid(H2.x0 - T, H2.x1 + T, H2.top, H2.top + 0.5, H2.z0 - T, H2.z1 + T);
  for (const z of [-104, -111, -121, -128]) for (const x of [4.5, 11.5]) {
    const pc = new THREE.CylinderGeometry(0.75, 0.75, H2.top - PB, 28, 1, true);
    const puv = pc.attributes.uv;
    for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * Math.PI * 1.5, puv.getY(i) * (H2.top - PB));
    G.hall.push(clean(pc.translate(x, (H2.top + PB) / 2, z)));
    coll({ type: 'circle', x, z, r: 0.8, enabled: true });
  }
  railing(0.1, -100.1, 15.9, -100.1, FL); railing(0.1, -129.9, 15.9, -129.9, FL);
  railing(0.1, -100, 0.1, -115, FL); railing(0.1, -117, 0.1, -130, FL);
  railing(15.9, -100, 15.9, -108, FL); railing(15.9, -110.5, 15.9, -115, FL); railing(15.9, -117, 15.9, -130, FL);
  railing(0, -115.1, 16, -115.1, FL, FL, true); railing(0, -116.9, 16, -116.9, FL, FL, true);
  stairs({ axis: 'x', from: 13.2, to: 15.95, a0: -110.5, a1: -108, y0: PB, y1: FL, n: 5, base: PB });
  // stubs
  tunnel('x', -106, -8, -4, 2.6, 1.9, FL, G.tunnel); wall('z', -8, -107.5, -104.5, FL - 0.6, FL + 3.6);
  tunnel('x', -124, -8, -4, 2.6, 1.9, FL, G.tunnel); wall('z', -8, -125.5, -122.5, FL - 0.6, FL + 3.6);

  // ---------------------------------------------------------------- tunnel 3 + stair tower A2
  tunnel('z', 8, -140, -134);
  const A2 = { x0: -2, x1: 18, z0: -160, z1: -140, top: 26 };
  addFloor(A2.x0, A2.x1, A2.z0, -154);
  addFloor(A2.x0, A2.x1, -146, A2.z1);
  addFloor(A2.x0, 4, -154, -146);
  addFloor(12, A2.x1, -154, -146);
  addPool(4, 12, -154, -146);
  railing(4, -146.1, 12, -146.1, FL); railing(4, -153.9, 12, -153.9, FL); railing(4.1, -146, 4.1, -154, FL); railing(11.9, -146, 11.9, -154, FL);
  // flights around the walls
  stairs({ axis: 'z', from: -143, to: -155, a0: 15.2, a1: A2.x1, y0: FL, y1: 4.6, n: 14, rail: 15.15 });
  addFloor(15.2, A2.x1, A2.z0, -155, 4.6, 0.6, G.hall);
  railing(15.15, -155, 15.15, -157.2, 4.6);
  stairs({ axis: 'x', from: 15.2, to: 0.8, a0: A2.z0, a1: -157.2, y0: 4.6, y1: 8.8, n: 14, rail: -157.15 });
  addFloor(A2.x0, 0.8, A2.z0, -155, 8.8, 0.6, G.hall);
  railing(0.85, -155, 0.85, -157.2, 8.8);
  stairs({ axis: 'z', from: -155, to: -143, a0: A2.x0, a1: 0.8, y0: 8.8, y1: 13.0, n: 14, rail: 0.85 });
  addFloor(A2.x0, 0.8, -143, A2.z1, 13.0, 0.6, G.hall);
  railing(0.85, -143, 0.85, A2.z1, 13.0);
  // walls
  wall('x', A2.z1, A2.x0, A2.x1, PB, A2.top, [ARCH(8, FL), { c: 8, b: 16, w: 2.2, h: 2.2 }]);
  wall('x', A2.z0, A2.x0, A2.x1, PB, A2.top, [{ c: 8, b: 14, w: 1.8, h: 1.8 }]);
  wall('z', A2.x0, A2.z0, A2.z1, PB, A2.top, [{ c: -150, b: 17, w: 1.8, h: 1.8 }]);
  wall('z', A2.x1, A2.z0, A2.z1, PB, A2.top, [{ c: -150, b: 11.5, w: 2.4, h: 2.4 }, { c: -144, b: 18, w: 2, h: 2 }]);
  windowPane('z', A2.x1, -150, 11.5, 2.4, 2.4, true, 1);
  windowPane('z', A2.x1, -144, 18, 2, 2, true, 1);
  windowPane('x', A2.z1, 8, 16, 2.2, 2.2, false, 1);
  windowPane('x', A2.z0, 8, 14, 1.8, 1.8, false, -1);
  windowPane('z', A2.x0, -150, 17, 1.8, 1.8, false, -1);
  solid(A2.x0 - T, A2.x1 + T, A2.top, A2.top + 0.5, A2.z0 - T, -152);
  solid(A2.x0 - T, A2.x1 + T, A2.top, A2.top + 0.5, -148, A2.z1 + T);
  solid(A2.x0 - T, 6, A2.top, A2.top + 0.5, -152, -148);
  solid(10, A2.x1 + T, A2.top, A2.top + 0.5, -152, -148);
  G.dark.push(new THREE.BoxGeometry(4, 10, 4).translate(8, A2.top + 5, -150));
  stairs({ axis: 'x', from: 1, to: 9, a0: -159.5, a1: -157.5, y0: A2.top - 0.2, y1: A2.top - 5, n: 12, base: A2.top - 0.2, walk: false });
  stairs({ axis: 'z', from: -159, to: -151, a0: 8, a1: 10, y0: 18.5, y1: 22, n: 9, base: 18, walk: false });

  // ---------------------------------------------------------------- build meshes
  for (const [k, list] of Object.entries(G)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(merged(list), M[k]);
    m.castShadow = !['pane', 'dimPane'].includes(k);
    m.receiveShadow = true;
    m.userData.dynamic = true;
    L.add(m);
  }

  // ---------------------------------------------------------------- light: only through the east windows
  L.setupHemi('#eaf6f3', '#8aa9a3', 1.15);
  L.setupFogExp('#b9ccc8', 0.0095);
  if (q.shadows) {
    const sun = L.setupSun({ dir: toSun.toArray(), color: '#fff6e6', intensity: 7.0, area: q.shadowSize >= 2048 ? 62 : 46, far: 220, bias: -0.0007, normalBias: 0.05 });
    sun.shadow.radius = 4;
  }
  const shaftU = { uColor: { value: new THREE.Color('#f4fbff') }, uTime: { value: 0 }, uStrength: { value: q.shadows ? 0.1 : 0.16 } };
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: shaftU, vertexShader: shaftVert, fragmentShader: shaftFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const patchMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#f4fbff', transparent: true, opacity: q.shadows ? 0.0 : 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  L.onUpdate((dt) => { shaftU.uTime.value += dt; });
  const proj = (p) => {
    const t = (p.y - FL) / -ray.y;
    return new THREE.Vector3(p.x + ray.x * t, FL + 0.02, p.z + ray.z * t);
  };
  for (const s of shafts) {
    const x = s.at - T / 2;
    const c0 = new THREE.Vector3(x, s.b + s.h, s.c - s.w / 2), c1 = new THREE.Vector3(x, s.b + s.h, s.c + s.w / 2);
    const c2 = new THREE.Vector3(x, s.b, s.c + s.w / 2), c3 = new THREE.Vector3(x, s.b, s.c - s.w / 2);
    const P = [c0, c1, c2, c3].map(proj);
    const sheet = (a, b, B, A) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...B.toArray(), ...A.toArray()], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new THREE.Mesh(g, shaftMat);
      m.renderOrder = 5;
      m.frustumCulled = false;
      L.add(m);
    };
    sheet(c0.clone().lerp(c3, 0.5), c1.clone().lerp(c2, 0.5), P[1].clone().lerp(P[2], 0.5), P[0].clone().lerp(P[3], 0.5));
    sheet(c0.clone().lerp(c1, 0.5), c3.clone().lerp(c2, 0.5), P[3].clone().lerp(P[2], 0.5), P[0].clone().lerp(P[1], 0.5));
    if (!q.shadows) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...P[0].toArray(), ...P[1].toArray(), ...P[2].toArray(), ...P[3].toArray()], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      L.add(new THREE.Mesh(g, patchMat));
    }
  }

  // ---------------------------------------------------------------- water (one plane under every walkway)
  const WX0 = -16, WX1 = 22, WZ0 = -162, WZ1 = -28;
  const WS = Math.max(WX1 - WX0, WZ1 - WZ0);
  let water;
  if (q.bloom && ctx.renderer.halfFloat) {
    const n0 = waterNormalTexture();
    const res = q.pixelRatio >= 2 ? [1536, 768] : q.pixelRatio >= 1.5 ? [1024, 512] : [768, 384];
    water = new Water(new THREE.PlaneGeometry(WS, WS), {
      color: '#e4f2ee', scale: WS / 4.5, flowDirection: new THREE.Vector2(0.6, 0.4), flowSpeed: 0.005,
      textureWidth: res[0], textureHeight: res[1], reflectivity: 0.12, normalMap0: n0, normalMap1: n0.clone(), shader: PoolWaterShader,
    });
    water.rotation.x = -Math.PI / 2;
  } else {
    const wn = waterNormalTexture().clone();
    wn.repeat.set(WS / 3, WS / 3);
    water = new THREE.Mesh(new THREE.PlaneGeometry(WS, WS).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      color: '#16302d', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.88, normalMap: wn,
      normalScale: new THREE.Vector2(0.25, 0.25), depthWrite: false,
    }));
    L.onUpdate((dt) => { wn.offset.x += dt * 0.008; wn.offset.y += dt * 0.005; });
  }
  water.position.set((WX0 + WX1) / 2, WL, (WZ0 + WZ1) / 2);
  water.renderOrder = 2;
  water.userData.dynamic = true;

  const motes = floatingMotes(Math.round(160 * q.particles), { color: '#eefcff', size: 0.035, area: 12, height: 6, speed: 0.05, opacity: 0.6, tex: glowTexture() });
  L.add(motes);
  L.onUpdate((dt, t, player) => motes.userData.update(t, player.pos, player.pos.y - 1));

  // ---------------------------------------------------------------- doors
  const white = { color: '#f2f6f4', frameColor: '#e4ecea' };
  L.makeDecoy(white, -8, FL, -65.8, 0);
  L.makeDecoy(white, -17.8, FL, -46, Math.PI / 2);
  L.makeDecoy(white, -7.8, FL, -106, Math.PI / 2);
  L.makeDecoy(white, -7.8, FL, -124, Math.PI / 2);
  L.makeDoor({ color: '#cfe9e4', frameColor: '#f2f6f4', glow: '#f4fffc', style: 'panel' }, -0.6, 13.0, -140.4, Math.PI);

  // ---------------------------------------------------------------- gameplay
  const rampH = (r, x, z) => {
    const c = r.axis === 'z' ? z : x, a = r.axis === 'z' ? x : z;
    if (a < r.a0 || a > r.a1) return null;
    const t = (c - r.from) / (r.to - r.from);
    if (t < 0 || t > 1) return null;
    const k = Math.min(r.n, Math.floor(t * r.n) + 1);
    return r.y0 + k * (r.y1 - r.y0) / r.n;
  };
  const inPool = (x, z) => pools.some((p) => x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1);
  L.groundHeight = (x, z, yRef = 1e9) => {
    let best = -1e9;
    const lim = yRef + 0.65;
    for (const f of floors) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && f.y <= lim && f.y > best) best = f.y;
    for (const r of ramps) { const h = rampH(r, x, z); if (h !== null && h <= lim && h > best) best = h; }
    if (best > -1e8) return best;
    return inPool(x, z) ? PB : FL;
  };
  L.waterLevel = () => WL;
  L.surface = () => 'tile';
  L.bounds = { type: 'box', x0: -18, x1: 22, z0: -162, z1: 4.4 };
  L.spawn = { x: 0, z: 2.5, yaw: 0, pitch: 0 };
  L.menuCam = { x: -9, z: -33, yaw: -0.55, y: 1.6, pitch: 0.18 };

  L.envFromScene(new THREE.Vector3(0, 6, -45), 0.75);
  L.add(water);
  L.far = 220;
  return L;
}
