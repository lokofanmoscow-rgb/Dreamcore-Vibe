import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase } from './common.js';
import { Terrain, grassLayers } from '../core/terrain.js';
import { canvasTexture, tileTexture, paintedWallTexture, glowTexture, rep } from '../core/textures.js';
import { mulberry32 } from '../core/noise.js';
import { bench, streetLamp, boxCollider, circleCollider } from '../props/props.js';

// A courtyard well under a ceiling instead of a sky. Seven storeys of
// galleries look down on a lawn; every floor can be walked, two stairwells
// join them, and the way out is an apartment door high up.

const FH = 3.4;                 // storey height
const FLOORS = 7;
const TOP = FH * FLOORS;        // ceiling of the well
const Y = { x0: -24, x1: 24, z0: -16, z1: 16 };
const CD = 3.2;                 // gallery depth
const O = { x0: Y.x0 - CD, x1: Y.x1 + CD, z0: Y.z0 - CD, z1: Y.z1 + CD };
const WT = 0.3;
const STAIR = { w: 4.2, z0: -4.4, z1: 4.4, a: 2.4 };   // stairwell box beyond the east/west galleries

function facadeTexture() {
  return canvasTexture(256, 290, (c, w, h) => {
    c.fillStyle = '#e2e0dc'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(90,90,100,${Math.random() * 0.05})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    c.fillStyle = 'rgba(120,118,128,0.5)'; c.fillRect(0, h - 3, w, 3);
  });
}

function doorLeafTexture(num) {
  return canvasTexture(128, 256, (c, w, h) => {
    c.fillStyle = '#7a6a5e'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(40,30,24,0.5)'; c.lineWidth = 4; c.strokeRect(14, 18, w - 28, h * 0.4); c.strokeRect(14, h * 0.5, w - 28, h * 0.42);
    c.fillStyle = '#d8c890'; c.fillRect(w * 0.38, 26, w * 0.24, 22);
    c.fillStyle = '#3a3024'; c.font = 'bold 18px Arial'; c.textAlign = 'center'; c.fillText(String(num), w / 2, 43);
    c.fillStyle = '#c8b070'; c.beginPath(); c.arc(w * 0.82, h * 0.52, 6, 0, Math.PI * 2); c.fill();
  }, { wrap: false });
}

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  const q = ctx.q;
  const rnd = mulberry32(404);

  // ---------------------------------------------------------------- walkable surfaces
  const floors = [];
  const ramps = [];
  const addFloorRect = (x0, x1, z0, z1, y) => floors.push({ x0, x1, z0, z1, y });
  const coll = (c) => { L.colliders.push(c); return c; };
  const obox = (x, z, w, d, y0, y1) => coll({ type: 'obox', x, z, hw: w / 2, hd: d / 2, rot: 0, enabled: true, y0, y1 });

  // ---------------------------------------------------------------- materials
  const ftex = facadeTexture(); ftex.repeat.set(1 / 3, 1 / FH);
  const facadeMat = new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.9 });
  const paint = rep(paintedWallTexture('#d8d4c4', false, 'gallery'), 0.4, 0.4);
  const paintMat = new THREE.MeshStandardMaterial({ map: paint, roughness: 0.92, side: THREE.DoubleSide });
  const lino = rep(tileTexture('#b8b0a0', '#8f887a', 3, 'lino', 0.02), 1, 1);
  const linoMat = new THREE.MeshStandardMaterial({ map: lino, roughness: 0.5 });
  const slabMat = new THREE.MeshStandardMaterial({ color: '#e6e4de', roughness: 0.95, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#9fb0bc', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.22, depthWrite: false });
  const G = { facade: [], paint: [], lino: [], slab: [], glass: [], frame: [] };

  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  // wall with rectangular holes: returns slab + lining geometry. axis 'x' runs along x at z = at
  const holed = (axis, at, a0, a1, y0, y1, holes) => {
    const len = a1 - a0, hgt = y1 - y0;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, hgt); shape.lineTo(0, hgt); shape.lineTo(0, 0);
    for (const h of holes) {
      const p = new THREE.Path();
      p.moveTo(h.a0 - a0, h.y0 - y0); p.lineTo(h.a1 - a0, h.y0 - y0); p.lineTo(h.a1 - a0, h.y1 - y0); p.lineTo(h.a0 - a0, h.y1 - y0); p.lineTo(h.a0 - a0, h.y0 - y0);
      shape.holes.push(p);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: WT, bevelEnabled: false });
    if (axis === 'x') g.translate(a0, y0, at - WT / 2);
    else { g.rotateY(-Math.PI / 2); g.translate(at + WT / 2, y0, a0); }
    // planar uv in metres along the wall
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, axis === 'x' ? p.getX(i) : p.getZ(i), p.getY(i));
    return g;
  };
  const wallColliders = (axis, at, a0, a1, y0, y1, gaps) => {
    let s = a0;
    const segs = [];
    for (const [g0, g1] of [...gaps].sort((p, r) => p[0] - r[0])) { segs.push([s, g0]); s = g1; }
    segs.push([s, a1]);
    for (const [p0, p1] of segs) {
      if (p1 - p0 < 0.05) continue;
      if (axis === 'x') obox((p0 + p1) / 2, at, p1 - p0, WT + 0.1, y0, y1);
      else obox(at, (p0 + p1) / 2, WT + 0.1, p1 - p0, y0, y1);
    }
  };

  // ---------------------------------------------------------------- the inner facade with windows, storey by storey
  const sides = [
    { axis: 'x', at: Y.z0, a0: Y.x0, a1: Y.x1 }, { axis: 'x', at: Y.z1, a0: Y.x0, a1: Y.x1 },
    { axis: 'z', at: Y.x0, a0: Y.z0, a1: Y.z1 }, { axis: 'z', at: Y.x1, a0: Y.z0, a1: Y.z1 },
  ];
  for (let f = 0; f < FLOORS; f++) {
    const y0 = f * FH, y1 = (f + 1) * FH;
    for (const sd of sides) {
      const mid = (sd.a0 + sd.a1) / 2;
      const holes = [], gaps = [];
      for (let u = sd.a0 + 1.5; u < sd.a1 - 1; u += 3) {
        if (f === 0 && Math.abs(u - mid) < 2) continue;
        holes.push({ a0: u - 0.65, a1: u + 0.65, y0: y0 + 1.0, y1: y0 + 2.3 });
        const gw = 1.3;
        if (sd.axis === 'x') G.glass.push(box(gw, 1.3, 0.02, u, y0 + 1.65, sd.at));
        else G.glass.push(box(0.02, 1.3, gw, sd.at, y0 + 1.65, u));
      }
      if (f === 0) { holes.push({ a0: mid - 1.0, a1: mid + 1.0, y0: 0, y1: 2.5 }); gaps.push([mid - 1.0, mid + 1.0]); }
      G.facade.push(holed(sd.axis, sd.at, sd.a0, sd.a1, y0, y1, holes));
      wallColliders(sd.axis, sd.at, sd.a0, sd.a1, y0, y1, gaps);
    }
  }
  // ---------------------------------------------------------------- outer gallery walls with apartment doors
  const outer = [
    { axis: 'x', at: O.z0, a0: O.x0, a1: O.x1, n: 1 }, { axis: 'x', at: O.z1, a0: O.x0, a1: O.x1, n: -1 },
    { axis: 'z', at: O.x0, a0: O.z0, a1: O.z1, n: 1 }, { axis: 'z', at: O.x1, a0: O.z0, a1: O.z1, n: -1 },
  ];
  const doorGeo = [];
  let aptNo = 1;
  const doorTexMats = [1, 2, 3, 4].map((k) => new THREE.MeshStandardMaterial({ map: doorLeafTexture(10 + k * 7), roughness: 0.7 }));
  const doorLists = doorTexMats.map(() => []);
  const decoySpots = [];
  for (let f = 0; f < FLOORS; f++) {
    const y0 = f * FH, y1 = (f + 1) * FH;
    for (const sd of outer) {
      const isStairSide = sd.axis === 'z';
      const holes = [], gaps = [];
      if (isStairSide) { holes.push({ a0: STAIR.a + 0.2, a1: STAIR.z1 - 0.2, y0, y1: y0 + 2.5 }); gaps.push([STAIR.a + 0.2, STAIR.z1 - 0.2]); }
      G.paint.push(holed(sd.axis, sd.at, sd.a0, sd.a1, y0, y1, holes));
      wallColliders(sd.axis, sd.at, sd.a0, sd.a1, y0, y1, gaps);
      // apartment doors every 6 m on the gallery side
      for (let u = sd.a0 + 4.5; u < sd.a1 - 3; u += 6) {
        if (isStairSide && u > STAIR.a - 1.2 && u < STAIR.z1 + 1.2) continue;
        const off = sd.n * (WT / 2 + 0.03);
        const k = (aptNo++) % 4;
        if (sd.axis === 'x') doorLists[k].push(box(1.0, 2.1, 0.05, u, y0 + 1.05, sd.at + off));
        else doorLists[k].push(box(0.05, 2.1, 1.0, sd.at + off, y0 + 1.05, u));
        if (sd.axis === 'x') doorGeo.push(box(1.2, 0.08, 0.07, u, y0 + 2.14, sd.at + off), box(0.08, 2.18, 0.07, u - 0.56, y0 + 1.09, sd.at + off), box(0.08, 2.18, 0.07, u + 0.56, y0 + 1.09, sd.at + off));
        else doorGeo.push(box(0.07, 0.08, 1.2, sd.at + off, y0 + 2.14, u), box(0.07, 2.18, 0.08, sd.at + off, y0 + 1.09, u - 0.56), box(0.07, 2.18, 0.08, sd.at + off, y0 + 1.09, u + 0.56));
        if (rnd() < 0.05) decoySpots.push({ sd, u, y0 });
      }
    }
    // gallery floors (storey slabs) and ceilings
    const slabs = [
      [O.x0, O.x1, O.z0, Y.z0], [O.x0, O.x1, Y.z1, O.z1], [O.x0, Y.x0, Y.z0, Y.z1], [Y.x1, O.x1, Y.z0, Y.z1],
    ];
    for (const [x0, x1, z0, z1] of slabs) {
      if (f > 0) G.slab.push(box(x1 - x0, 0.3, z1 - z0, (x0 + x1) / 2, y0 - 0.15, (z0 + z1) / 2));
      const lg = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y0 + 0.012, (z0 + z1) / 2);
      const p = lg.attributes.position, uv = lg.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 1.0, p.getZ(i) / 1.0);
      G.lino.push(lg);
      addFloorRect(x0, x1, z0, z1, y0);
    }
  }
  // the ceiling over everything
  G.slab.push(box(O.x1 - O.x0 + 2 * STAIR.w + 1, 0.4, O.z1 - O.z0 + 1, 0, TOP + 0.2, (O.z0 + O.z1) / 2));

  // ---------------------------------------------------------------- stairwells (east and west), switchback flights
  const stairMat = new THREE.MeshStandardMaterial({ color: '#cfccc2', roughness: 0.8 });
  const stairGeo = [];
  for (const side of [1, -1]) {
    const xi = side > 0 ? O.x1 : O.x0;               // shared wall with the gallery
    const xo = xi + side * STAIR.w;                   // outer wall of the shaft
    const xm = xi + side * (STAIR.w / 2);             // divider between the two flights
    const lo = (a, b) => [Math.min(a, b), Math.max(a, b)];
    // shaft walls
    stairGeo.push(box(WT, TOP, STAIR.z1 - STAIR.z0, xo, TOP / 2, (STAIR.z0 + STAIR.z1) / 2));
    stairGeo.push(box(STAIR.w, TOP, WT, (xi + xo) / 2, TOP / 2, STAIR.z0), box(STAIR.w, TOP, WT, (xi + xo) / 2, TOP / 2, STAIR.z1));
    obox(xo, (STAIR.z0 + STAIR.z1) / 2, WT + 0.1, STAIR.z1 - STAIR.z0, -5, TOP + 5);
    obox((xi + xo) / 2, STAIR.z0, STAIR.w, WT + 0.1, -5, TOP + 5);
    obox((xi + xo) / 2, STAIR.z1, STAIR.w, WT + 0.1, -5, TOP + 5);
    // divider between flights
    stairGeo.push(box(0.2, TOP, STAIR.a * 2, xm, TOP / 2, 0));
    obox(xm, 0, 0.3, STAIR.a * 2, -5, TOP + 5);
    const [fa0, fa1] = lo(xi + side * 0.15, xm - side * 0.12);   // flight A (from the gallery side, going -z)
    const [fb0, fb1] = lo(xm + side * 0.12, xo - side * 0.15);   // flight B (going +z)
    const [la0, la1] = lo(xi, xo);
    for (let f = 0; f < FLOORS; f++) {
      const y0 = f * FH;
      // floor landing (joins the gallery doorway)
      stairGeo.push(box(la1 - la0, 0.25, STAIR.z1 - STAIR.a, (la0 + la1) / 2, y0 - 0.125, (STAIR.a + STAIR.z1) / 2));
      addFloorRect(la0, la1, STAIR.a, STAIR.z1, y0);
      if (f === FLOORS - 1) break;
      const n = 10, run = (2 * STAIR.a) / n, rise = (FH / 2) / n;
      for (let i = 0; i < n; i++) {
        const top = y0 + (i + 1) * rise;
        const z = STAIR.a - (i + 0.5) * run;
        stairGeo.push(box(fa1 - fa0, 0.25, run, (fa0 + fa1) / 2, top - 0.125, z));
        const topB = y0 + FH / 2 + (i + 1) * rise;
        const zb = -STAIR.a + (i + 0.5) * run;
        stairGeo.push(box(fb1 - fb0, 0.25, run, (fb0 + fb1) / 2, topB - 0.125, zb));
      }
      ramps.push({ axis: 'z', from: STAIR.a, to: -STAIR.a, a0: fa0, a1: fa1, y0, y1: y0 + FH / 2, n });
      ramps.push({ axis: 'z', from: -STAIR.a, to: STAIR.a, a0: fb0, a1: fb1, y0: y0 + FH / 2, y1: y0 + FH, n });
      // mid landing
      stairGeo.push(box(la1 - la0, 0.25, -STAIR.a - STAIR.z0, (la0 + la1) / 2, y0 + FH / 2 - 0.125, (STAIR.z0 - STAIR.a) / 2));
      addFloorRect(la0, la1, STAIR.z0, -STAIR.a, y0 + FH / 2);
      // a lamp on each landing
      stairGeo.push(box(0.5, 0.04, 0.5, (la0 + la1) / 2, y0 + FH - 0.06, (STAIR.a + STAIR.z1) / 2));
    }
  }

  // ---------------------------------------------------------------- yard: lawns, paths, benches
  const cx = 0, cz = 0;
  const lawns = [
    { x0: Y.x0 + 3, x1: cx - 1.6, z0: Y.z0 + 3, z1: cz - 1.6 }, { x0: cx + 1.6, x1: Y.x1 - 3, z0: Y.z0 + 3, z1: cz - 1.6 },
    { x0: Y.x0 + 3, x1: cx - 1.6, z0: cz + 1.6, z1: Y.z1 - 3 }, { x0: cx + 1.6, x1: Y.x1 - 3, z0: cz + 1.6, z1: Y.z1 - 3 },
  ];
  const onLawn = (x, z) => lawns.some((l) => x > l.x0 && x < l.x1 && z > l.z0 && z < l.z1) && Math.hypot(x - cx, z - cz) > 4.2;
  const terrain = new Terrain({
    size: 80, segments: 20, fieldRes: 320, height: () => 0,
    grass: (x, z) => (onLawn(x, z) ? 1 : 0),
    path: (x, z) => (onLawn(x, z) ? 0 : 1),
    tint: () => 0.45,
    pathTex: tileTexture('#b8b4ac', '#8a8680', 2, 'paving', 0.05),
    pathRepeat: 0.5,
    groundColor: '#c8d4b8',
  });
  L.add(terrain.mesh);
  addFloorRect(Y.x0, Y.x1, Y.z0, Y.z1, 0);
  const grass = grassLayers(terrain, q, { height: 0.2, width: 0.06, base: '#2a4a1e', tip: '#7f9a52', wind: 0.15, densityMul: 1.1 });
  grass.meshes.forEach((m) => L.add(m));
  L.onUpdate((dt) => grass.update(dt, ctx.camera.position));
  const curb = [];
  for (const l of lawns) {
    curb.push(box(l.x1 - l.x0, 0.12, 0.12, (l.x0 + l.x1) / 2, 0.06, l.z0), box(l.x1 - l.x0, 0.12, 0.12, (l.x0 + l.x1) / 2, 0.06, l.z1),
      box(0.12, 0.12, l.z1 - l.z0, l.x0, 0.06, (l.z0 + l.z1) / 2), box(0.12, 0.12, l.z1 - l.z0, l.x1, 0.06, (l.z0 + l.z1) / 2));
  }
  L.add(new THREE.Mesh(mergeGeometries(curb), new THREE.MeshStandardMaterial({ color: '#a8a49a', roughness: 0.9 })));
  for (const [ox, oz, r] of [[-7, -2.3, 0], [7, 2.3, Math.PI], [-7, 2.3, Math.PI], [7, -2.3, 0]]) {
    const b = bench('#6a5a48');
    b.position.set(cx + ox, 0, cz + oz);
    b.rotation.y = r;
    L.add(b);
    L.collide(boxCollider(cx + ox, cz + oz, 1.9, 0.7));
  }
  for (const [x, z] of [[-1.6, 12.5], [1.6, -12.5]]) {
    const l = streetLamp('#ffe0b0');
    l.position.set(x, 0, z);
    l.scale.setScalar(0.75);
    L.add(l);
    L.collide(circleCollider(x, z, 0.15));
  }

  // ---------------------------------------------------------------- lights: the ceiling of the well and the galleries
  const lights = [];
  for (let x = -20; x <= 20; x += 8) for (let z = -12; z <= 12; z += 8) lights.push([x, TOP - 0.02, z, 3.2, 1.6, 2.6]);
  for (let f = 0; f < FLOORS; f++) {
    const y = (f + 1) * FH - 0.32;
    for (let x = O.x0 + 3; x < O.x1 - 1; x += 6) { lights.push([x, y, (O.z0 + Y.z0) / 2, 1.0, 0.4, rnd() < 0.85 ? 2.0 : 0.3]); lights.push([x, y, (O.z1 + Y.z1) / 2, 1.0, 0.4, rnd() < 0.85 ? 2.0 : 0.3]); }
    for (let z = Y.z0 + 3; z < Y.z1 - 1; z += 6) { lights.push([(O.x0 + Y.x0) / 2, y, z, 0.4, 1.0, rnd() < 0.85 ? 2.0 : 0.3]); lights.push([(O.x1 + Y.x1) / 2, y, z, 0.4, 1.0, rnd() < 0.85 ? 2.0 : 0.3]); }
  }
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.04, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), lights.length);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: '#fff4e0', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
  }), lights.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  let np = 0;
  lights.forEach(([x, y, z, sx, sz, k], i) => {
    m4.makeScale(sx, 1, sz).setPosition(x, y, z);
    panels.setMatrixAt(i, m4);
    col.set('#fff8ea').multiplyScalar(k);
    panels.setColorAt(i, col);
    if (k > 1 && y < TOP - 1) { m4.makeScale(4, 1, 4).setPosition(x, y - FH + 0.36, z); pools.setMatrixAt(np++, m4); }
  });
  pools.count = np;
  pools.renderOrder = 4;
  L.add(panels, pools);

  // ---------------------------------------------------------------- merge static geometry
  const mats = { facade: facadeMat, paint: paintMat, lino: linoMat, slab: slabMat, glass: glassMat };
  for (const [k, list] of Object.entries(G)) {
    if (!list.length || !mats[k]) continue;
    const m = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), mats[k]);
    m.receiveShadow = true;
    m.castShadow = k !== 'glass';
    L.add(m);
  }
  L.add(new THREE.Mesh(mergeGeometries(stairGeo.map((g) => g.toNonIndexed())), stairMat));
  L.add(new THREE.Mesh(mergeGeometries(doorGeo.map((g) => g.toNonIndexed())), new THREE.MeshStandardMaterial({ color: '#5a4a3e', roughness: 0.6 })));
  doorLists.forEach((list, i) => { if (list.length) L.add(new THREE.Mesh(mergeGeometries(list.map((g) => g.toNonIndexed())), doorTexMats[i])); });

  // ---------------------------------------------------------------- air
  L.setupHemi('#ecebf2', '#6e6c64', 1.15);
  L.setupFogExp('#a6a4b2', 0.0065);
  L.envFromScene(new THREE.Vector3(0, 8, 0), 0.5);

  // ---------------------------------------------------------------- doors
  const doorOn = (sd, u, y0, real) => {
    const off = sd.n * (WT / 2 + 0.05);
    const rot = sd.axis === 'x' ? (sd.n > 0 ? 0 : Math.PI) : (sd.n > 0 ? Math.PI / 2 : -Math.PI / 2);
    const x = sd.axis === 'x' ? u : sd.at + off, z = sd.axis === 'x' ? sd.at + off : u;
    const opts = { color: '#7a6a5e', frameColor: '#5a4a3e', glow: '#fff2dc', style: 'panel' };
    if (real) L.makeDoor({ ...opts, color: '#8a5a4a' }, x, y0, z, rot);
    else L.makeDecoy(opts, x, y0, z, rot);
  };
  decoySpots.slice(0, 6).forEach((d) => doorOn(d.sd, d.u + 3, d.y0, false));
  doorOn(outer[0], -13.5, 4 * FH, true);   // fifth floor, north gallery

  // ---------------------------------------------------------------- gameplay
  const rampH = (r, x, z) => {
    if (x < r.a0 || x > r.a1) return null;
    const t = (z - r.from) / (r.to - r.from);
    if (t < 0 || t > 1) return null;
    return r.y0 + Math.min(r.n, Math.floor(t * r.n) + 1) * (r.y1 - r.y0) / r.n;
  };
  L.groundHeight = (x, z, yRef = 0.5) => {
    let best = -1e9;
    const lim = yRef + 0.65;
    for (const f of floors) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && f.y <= lim && f.y > best) best = f.y;
    for (const r of ramps) { const h = rampH(r, x, z); if (h !== null && h <= lim && h > best) best = h; }
    return best > -1e8 ? best : 0;
  };
  L.surface = (x, z) => (onLawn(x, z) ? 'grass' : 'tile');
  L.bounds = { type: 'box', x0: O.x0 - STAIR.w, x1: O.x1 + STAIR.w, z0: O.z0, z1: O.z1 };
  L.spawn = { x: 0, z: 13.5, yaw: 0, pitch: 0.18 };
  L.menuCam = { x: -18, z: 12, yaw: -0.75, y: 1.6, pitch: 0.32 };
  L.far = 260;
  return L;
}
