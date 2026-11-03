import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/noise.js';
import { sidingTexture, roofTexture, leafyTexture, textTexture, concreteTexture, nrm, rep } from '../core/textures.js';
import { buildInterior } from './interior.js';

// ------------------------------------------------------------------ helpers
export function std(color, rough = 0.7, metal = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

export function bx(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

export function cyl(rt, rb, h, x = 0, y = 0, z = 0, seg = 12) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return g;
}

export function sph(r, x = 0, y = 0, z = 0, ws = 16, hs = 12) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.translate(x, y, z);
  return g;
}

export function mesh(geos, material, { cast = true, receive = true } = {}) {
  const g = Array.isArray(geos) ? mergeGeometries(geos.map(nonIndexedSafe)) : geos;
  const m = new THREE.Mesh(g, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// mergeGeometries needs consistent attributes; strip extras.
function nonIndexedSafe(g) {
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  }
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  if (!g.index) {
    const idx = [];
    for (let i = 0; i < g.attributes.position.count; i++) idx.push(i);
    g.setIndex(idx);
  }
  return g;
}

export function placeOn(obj, x, z, terrainH, rotY = 0, yOff = 0) {
  obj.position.set(x, (terrainH ? terrainH(x, z) : 0) + yOff, z);
  obj.rotation.y = rotY;
  return obj;
}

// ------------------------------------------------------------------ fences
// Picket fence along a polyline. Returns {object, colliders}.
export function picketFence(points, { height = 1.05, color = '#f7f7f2', spacing = 0.16, heightAt = null, seed = 1 } = {}) {
  const picket = mergeGeometries([
    nonIndexedSafe(bx(0.085, height - 0.08, 0.025, 0, (height - 0.08) / 2, 0)),
    nonIndexedSafe(new THREE.ConeGeometry(0.06, 0.12, 4).rotateY(Math.PI / 4).scale(1, 1, 0.3).translate(0, height - 0.04, 0)),
  ]);
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, len });
    total += len;
  }
  const count = Math.ceil(total / spacing) + points.length;
  const mat = std(color, 0.6);
  const pickets = new THREE.InstancedMesh(picket, mat, count);
  pickets.castShadow = true;
  pickets.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const rnd = mulberry32(seed);
  let n = 0;
  const rails = [];
  const colliders = [];
  for (const s of segs) {
    const ang = Math.atan2(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const steps = Math.max(1, Math.floor(s.len / spacing));
    for (let i = 0; i <= steps && n < count; i++) {
      const t = i / steps;
      const x = s.a[0] + (s.b[0] - s.a[0]) * t;
      const z = s.a[1] + (s.b[1] - s.a[1]) * t;
      const y = heightAt ? heightAt(x, z) : 0;
      q.setFromAxisAngle(up, ang + Math.PI / 2 + (rnd() - 0.5) * 0.04);
      const sc = 1 + (rnd() - 0.5) * 0.04;
      m4.compose(new THREE.Vector3(x, y - 0.03, z), q, new THREE.Vector3(1, sc, 1));
      pickets.setMatrixAt(n++, m4);
    }
    // two rails behind the pickets
    const mx = (s.a[0] + s.b[0]) / 2, mz = (s.a[1] + s.b[1]) / 2;
    const my = heightAt ? heightAt(mx, mz) : 0;
    const off = 0.03;
    const ox = Math.cos(ang) * off, oz = -Math.sin(ang) * off;
    for (const ry of [0.25, height - 0.3]) {
      const g = new THREE.BoxGeometry(0.05, 0.07, s.len);
      g.rotateY(ang);
      g.translate(mx - ox, my + ry, mz - oz);
      rails.push(nonIndexedSafe(g));
    }
    // posts every ~2.4 m
    const posts = Math.max(1, Math.round(s.len / 2.4));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const x = s.a[0] + (s.b[0] - s.a[0]) * t;
      const z = s.a[1] + (s.b[1] - s.a[1]) * t;
      const y = heightAt ? heightAt(x, z) : 0;
      const g = new THREE.BoxGeometry(0.09, height + 0.05, 0.09);
      g.rotateY(ang);
      g.translate(x - ox * 2, y + (height + 0.05) / 2 - 0.05, z - oz * 2);
      rails.push(nonIndexedSafe(g));
    }
    colliders.push(segmentCollider(s.a, s.b, 0.12));
  }
  pickets.count = n;
  pickets.instanceMatrix.needsUpdate = true;
  const group = new THREE.Group();
  group.add(pickets);
  const railMesh = mesh(rails, mat);
  group.add(railMesh);
  return { object: group, colliders };
}

// oriented box collider from a segment
export function segmentCollider(a, b, thickness) {
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const rot = Math.atan2(b[0] - a[0], b[1] - a[1]);
  return { type: 'obox', x: cx, z: cz, hw: thickness / 2, hd: len / 2, rot, enabled: true };
}

export function boxCollider(x, z, w, d, rot = 0) {
  return { type: 'obox', x, z, hw: w / 2, hd: d / 2, rot, enabled: true };
}

export function circleCollider(x, z, r) {
  return { type: 'circle', x, z, r, enabled: true };
}

// ------------------------------------------------------------------ wind turbine
export function windTurbine({ height = 38, color = '#f4f6f8', bladeLen = 17 } = {}) {
  const group = new THREE.Group();
  const mat = std(color, 0.45, 0.1);
  const tower = mesh([cyl(0.9, 1.6, height, 0, height / 2, 0, 20)], mat, { cast: true });
  group.add(tower);
  const nacelle = mesh([bx(2.0, 2.0, 5.2, 0, height + 0.6, -0.6), sph(1.05, 0, height + 0.6, 2.2, 16, 12)], mat);
  group.add(nacelle);
  const rotor = new THREE.Group();
  rotor.position.set(0, height + 0.6, 2.6);
  rotor.userData.dynamic = true;
  const blades = [];
  for (let i = 0; i < 3; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.25, 0);
    shape.quadraticCurveTo(-0.9, bladeLen * 0.25, -0.35, bladeLen);
    shape.lineTo(0.05, bladeLen);
    shape.quadraticCurveTo(0.6, bladeLen * 0.2, 0.25, 0);
    shape.lineTo(-0.25, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
    g.translate(0, 0.8, -0.09);
    g.rotateZ((i / 3) * Math.PI * 2);
    blades.push(nonIndexedSafe(g));
  }
  blades.push(nonIndexedSafe(sph(0.75, 0, 0, 0)));
  const rotorMesh = mesh(blades, mat);
  rotor.add(rotorMesh);
  group.add(rotor);
  group.userData.rotor = rotor;
  group.userData.speed = 0.35 + Math.random() * 0.25;
  group.userData.update = (dt) => { rotor.rotation.z -= dt * group.userData.speed; };
  return group;
}

// ------------------------------------------------------------------ house
export function house({
  w = 10, d = 8, h = 3.0, wall = '#e8d4b0', roof = '#8a3a2c', trim = '#ffffff', door = '#7a3b2a',
  roofH = 2.2, garage = false, windowGlow = null, chimney = false, seed = 1, interior = false,
} = {}) {
  const group = new THREE.Group();
  if (!interior) {
    const wallTex = rep(sidingTexture(wall), w / 3, h / 3);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, normalMap: nrm(wallTex), roughness: 0.85 });
    group.add(mesh([bx(w, h, d, 0, h / 2, 0)], wallMat));
  }
  // foundation
  group.add(mesh([bx(w + 0.2, 0.35, d + 0.2, 0, 0.12, 0)], std('#9c968a', 0.9)));
  // hipped roof
  const rt = rep(roofTexture(roof), 1, 1);
  const roofMat = new THREE.MeshStandardMaterial({ map: rt, normalMap: nrm(rt), roughness: 0.8 });
  const ov = 0.5;
  const rw = w / 2 + ov, rd = d / 2 + ov;
  const ridge = Math.max(0.5, (w - d) / 2);
  const v = [
    -rw, 0, -rd, rw, 0, -rd, rw, 0, rd, -rw, 0, rd, // eaves 0..3
    -ridge, roofH, 0, ridge, roofH, 0, // ridge 4,5
  ];
  const faces = [
    [3, 2, 5, 4], // front (+z)
    [1, 0, 4, 5], // back
    [2, 1, 5], // right
    [0, 3, 4], // left
  ];
  const pos = [], uv = [];
  for (const f of faces) {
    const tri = f.length === 4 ? [[f[0], f[1], f[2]], [f[0], f[2], f[3]]] : [[f[0], f[1], f[2]]];
    for (const t of tri) {
      for (const k of t) {
        pos.push(v[k * 3], v[k * 3 + 1] + h, v[k * 3 + 2]);
        uv.push(v[k * 3] * 0.25 + v[k * 3 + 2] * 0.25, v[k * 3 + 1] * 0.45 + Math.abs(v[k * 3 + 2]) * 0.1);
      }
    }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  rg.computeVertexNormals();
  const roofMesh = new THREE.Mesh(rg, roofMat);
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);
  // soffit
  group.add(mesh([bx(w + ov * 2, 0.08, d + ov * 2, 0, h + 0.02, 0)], std(trim, 0.7)));
  if (chimney) group.add(mesh([bx(0.8, 2.4, 0.8, w * 0.25, h + 1.5, -d * 0.15)], std('#8a4a3a', 0.9)));

  // windows & door on the front (+z)
  const glassMat = windowGlow
    ? new THREE.MeshStandardMaterial({ color: '#2a2a33', emissive: windowGlow, emissiveIntensity: 1.4, roughness: 0.2 })
    : new THREE.MeshStandardMaterial({ color: '#3a4a5c', roughness: 0.08, metalness: 0.6 });
  const trimMat = std(trim, 0.6);
  const winGeos = [], trimGeos = [];
  const rnd = mulberry32(seed);
  const nWin = Math.max(1, Math.floor(w / 3.2));
  const doorX = garage ? -w * 0.32 : (rnd() - 0.5) * w * 0.2;
  for (let i = 0; i < nWin; i++) {
    const x = -w / 2 + (i + 0.5) * (w / nWin);
    if (Math.abs(x - doorX) < 1.3) continue;
    if (garage && x > w * 0.05) continue;
    winGeos.push(bx(1.3, 1.2, 0.05, x, 1.65, d / 2 + 0.01));
    trimGeos.push(bx(1.5, 0.12, 0.08, x, 2.3, d / 2 + 0.03), bx(1.5, 0.12, 0.1, x, 1.0, d / 2 + 0.04),
      bx(0.1, 1.3, 0.08, x - 0.7, 1.65, d / 2 + 0.03), bx(0.1, 1.3, 0.08, x + 0.7, 1.65, d / 2 + 0.03),
      bx(0.06, 1.2, 0.07, x, 1.65, d / 2 + 0.03));
  }
  // side windows
  for (const sx of [-1, 1]) {
    winGeos.push(bx(0.05, 1.1, 1.2, sx * (w / 2 + 0.01), 1.65, 0));
    trimGeos.push(bx(0.08, 0.1, 1.4, sx * (w / 2 + 0.03), 2.25, 0), bx(0.08, 0.1, 1.4, sx * (w / 2 + 0.03), 1.05, 0));
  }
  if (interior) {
    const ib = buildInterior({ w, d, h, wall, glassGlow: windowGlow, doorX, garage, seed });
    group.add(ib.group);
    group.userData.localColliders = ib.colliders;
    group.userData.interior = ib.interior;
    group.userData.doorX = doorX;
    group.userData.depth = d;
  } else {
    group.add(mesh(winGeos, glassMat, { cast: false }));
    group.add(mesh([bx(1.0, 2.1, 0.08, doorX, 1.05 + 0.25, d / 2 + 0.02)], std(door, 0.5)));
  }
  group.add(mesh(trimGeos, trimMat));
  trimGeos.length = 0;
  group.add(mesh([bx(1.25, 0.12, 0.1, doorX, 2.42, d / 2 + 0.04), bx(1.6, 0.2, 0.8, doorX, 0.15, d / 2 + 0.4)], trimMat));
  if (garage) {
    const gx = w * 0.25;
    const gt = textTexture('', {
      width: 256, height: 128, bg: '#efe8dc', border: null, borderWidth: 0, radius: 0, key: 'garage',
    });
    const gm = new THREE.MeshStandardMaterial({ color: '#e9e1d4', roughness: 0.6, map: gt });
    const g = mesh([bx(w * 0.4, 2.3, 0.08, gx, 1.15 + 0.2, d / 2 + 0.02)], gm);
    group.add(g);
    const lines = [];
    for (let i = 0; i < 4; i++) lines.push(bx(w * 0.4 - 0.1, 0.03, 0.02, gx, 0.55 + i * 0.55, d / 2 + 0.07));
    group.add(mesh(lines, std('#cfc6b8', 0.6), { cast: false }));
  }
  const colliders = [];
  group.userData.footprint = { w: w + 0.4, d: d + 0.4 };
  return { object: group, colliders };
}

export function houseColliders(obj) {
  const r = obj.rotation.y, c = Math.cos(r), s = Math.sin(r);
  const px = obj.position.x, pz = obj.position.z;
  if (obj.userData.localColliders) {
    return obj.userData.localColliders.map((k) => boxCollider(px + k.x * c + k.z * s, pz - k.x * s + k.z * c, k.w, k.d, r));
  }
  const fp = obj.userData.footprint;
  return [boxCollider(px, pz, fp.w, fp.d, r)];
}

// floor height if (x, z) is inside an enterable house, otherwise null
export function houseFloorAt(obj, x, z) {
  const it = obj.userData.interior;
  if (!it) return null;
  const r = obj.rotation.y, c = Math.cos(r), s = Math.sin(r);
  const dx = x - obj.position.x, dz = z - obj.position.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  if (lx < it.x0 || lx > it.x1 || lz < it.z0 || lz > it.z1 + 0.25) return null;
  return obj.position.y + it.floorY;
}

// ------------------------------------------------------------------ vegetation
export function hedge(w, h, d, color = '#3f7a35') {
  const tex = rep(leafyTexture(color), w / 1.5, h / 1.5);
  const mat = new THREE.MeshStandardMaterial({ map: tex, normalMap: nrm(tex), normalScale: new THREE.Vector2(1.5, 1.5), roughness: 0.95 });
  const g = new THREE.BoxGeometry(w, h, d, Math.ceil(w * 2), Math.ceil(h * 2), Math.ceil(d * 2));
  // puff the box a little so it reads as foliage
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 3.1 + z * 2.3) * Math.cos(y * 2.7 + x) * 0.07;
    const k = 1 + n;
    p.setXYZ(i, x * (1 + n * 0.4 / Math.max(0.5, w)), y * k, z * (1 + n * 0.4 / Math.max(0.5, d)));
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cypress(h = 6, color = '#2f5a2a') {
  const tex = rep(leafyTexture(color), 2, h / 2);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    prof.push(new THREE.Vector2(Math.sin(Math.PI * Math.pow(t, 0.8)) * h * 0.13 * (1.15 - t * 0.5) + 0.01, t * h));
  }
  const g = new THREE.LatheGeometry(prof, 14);
  g.translate(0, 0.3, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  const trunk = mesh([cyl(0.08, 0.1, 0.6, 0, 0.3, 0, 6)], std('#5a3e2a', 0.9));
  const grp = new THREE.Group();
  grp.add(m, trunk);
  return grp;
}

export function roundTree(h = 6, color = '#4b8a3a', seed = 1) {
  const rnd = mulberry32(seed);
  const grp = new THREE.Group();
  grp.add(mesh([cyl(0.18, 0.28, h * 0.55, 0, h * 0.275, 0, 8)], std('#6b4a32', 0.9)));
  const tex = leafyTexture(color);
  const mat = new THREE.MeshStandardMaterial({ map: tex, normalMap: nrm(tex), roughness: 0.95 });
  const blobs = [];
  for (let i = 0; i < 6; i++) {
    const r = h * (0.18 + rnd() * 0.1);
    blobs.push(sph(r, (rnd() - 0.5) * h * 0.35, h * (0.6 + rnd() * 0.25), (rnd() - 0.5) * h * 0.35, 12, 10));
  }
  grp.add(mesh(blobs, mat));
  return grp;
}

// ------------------------------------------------------------------ small props
export function flamingo() {
  const pink = std('#ff5f9e', 0.35);
  const g = new THREE.Group();
  const body = sph(0.18, 0, 0.75, 0, 14, 10).scale(1.35, 0.85, 0.85);
  const neck = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.18, 0.8, 0), new THREE.Vector3(0.28, 1.0, 0), new THREE.Vector3(0.2, 1.2, 0), new THREE.Vector3(0.3, 1.32, 0),
  ]), 12, 0.035, 6);
  const head = sph(0.07, 0.33, 1.33, 0, 10, 8);
  const beak = new THREE.ConeGeometry(0.03, 0.12, 6).rotateZ(-Math.PI / 1.6).translate(0.43, 1.29, 0);
  g.add(mesh([body, neck, head], pink));
  g.add(mesh([beak], std('#222222', 0.4)));
  g.add(mesh([cyl(0.008, 0.008, 0.7, 0.02, 0.35, 0.04, 4), cyl(0.008, 0.008, 0.7, -0.02, 0.35, -0.04, 4)], std('#c9c9c9', 0.3, 0.8)));
  return g;
}

export function beachUmbrella(colors = ['#2fb8a8', '#f4f4ef']) {
  const g = new THREE.Group();
  g.add(mesh([cyl(0.03, 0.03, 2.4, 0, 1.2, 0, 8)], std('#e8e8e8', 0.4, 0.6)));
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    const geo = new THREE.ConeGeometry(1.5, 0.55, 2, 1, true, (i / segs) * Math.PI * 2, Math.PI * 2 / segs);
    geo.translate(0, 2.25, 0);
    const m = mesh([geo], std(colors[i % 2], 0.7, 0, { side: THREE.DoubleSide }));
    g.add(m);
  }
  return g;
}

export function deckChair(color = '#e8452f') {
  const g = new THREE.Group();
  const mat = std(color, 0.6);
  const parts = [];
  for (let i = 0; i < 8; i++) parts.push(bx(0.6, 0.03, 0.1, 0, 0.35, -0.5 + i * 0.13));
  g.add(mesh(parts, mat));
  const back = [];
  for (let i = 0; i < 6; i++) back.push(bx(0.6, 0.03, 0.1, 0, 0, i * 0.13));
  const bm = mesh(back, mat);
  bm.position.set(0, 0.38, 0.55);
  bm.rotation.x = -0.9;
  g.add(bm);
  g.add(mesh([bx(0.04, 0.35, 0.04, 0.28, 0.17, -0.5), bx(0.04, 0.35, 0.04, -0.28, 0.17, -0.5),
    bx(0.04, 0.35, 0.04, 0.28, 0.17, 0.5), bx(0.04, 0.35, 0.04, -0.28, 0.17, 0.5)], std('#dddddd', 0.4, 0.7)));
  return g;
}

export function hoseReel() {
  const g = new THREE.Group();
  g.add(mesh([bx(0.12, 1.1, 0.12, 0, 0.55, 0)], std('#6b4a32', 0.9)));
  const coils = [];
  for (let i = 0; i < 5; i++) coils.push(new THREE.TorusGeometry(0.22 - i * 0.012, 0.025, 6, 24).translate(0, 0.6 - i * 0.03, 0.1 + i * 0.03));
  g.add(mesh(coils, std('#3c6b45', 0.5)));
  return g;
}

export function hayBales(n = 4) {
  const g = new THREE.Group();
  const mat = std('#e5bf4d', 0.95);
  const geos = [];
  for (let i = 0; i < n; i++) geos.push(bx(1.1, 0.5, 0.6, (i % 2) * 0.05, 0.25 + Math.floor(i / 2) * 0.5, (i % 2) * 0.62 - 0.3));
  g.add(mesh(geos, mat));
  return g;
}

export function woodSign(text, { w = 2.2, h = 0.9 } = {}) {
  const g = new THREE.Group();
  const post = std('#4d3a2a', 0.9);
  g.add(mesh([bx(0.12, 2.3, 0.12, -w / 2 + 0.1, 1.15, 0), bx(0.12, 2.3, 0.12, w / 2 - 0.1, 1.15, 0),
    bx(w + 0.2, 0.08, 0.14, 0, 2.3, 0)], post));
  const tex = textTexture(text, { width: 640, height: 256, key: 'sign' + text, font: 'bold 74px Georgia, serif' });
  const face = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, h, 0.06), [
    std('#2d3b2a'), std('#2d3b2a'), std('#2d3b2a'), std('#2d3b2a'),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), std('#2d3b2a'),
  ]);
  face.position.set(0, 1.75, 0.02);
  face.castShadow = true;
  g.add(face);
  return g;
}

export function trashBin(color = '#7a3a28') {
  const g = new THREE.Group();
  g.add(mesh([cyl(0.33, 0.3, 0.95, 0, 0.475, 0, 16)], std(color, 0.6)));
  g.add(mesh([cyl(0.36, 0.36, 0.06, 0, 0.98, 0, 16), cyl(0.15, 0.2, 0.12, 0, 1.06, 0, 12), sph(0.06, 0, 1.15, 0, 8, 6)], std('#5a4030', 0.5, 0.3)));
  return g;
}

export function mailbox() {
  const g = new THREE.Group();
  g.add(mesh([bx(0.08, 1.1, 0.08, 0, 0.55, 0)], std('#5a4030', 0.9)));
  const box = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 1.15, 0);
  g.add(mesh([box, bx(0.3, 0.15, 0.5, 0, 1.08, 0)], std('#8a2a22', 0.4, 0.4)));
  g.add(mesh([bx(0.02, 0.18, 0.05, 0.17, 1.22, -0.1)], std('#e8c020', 0.5)));
  return g;
}

export function hydrant() {
  const g = new THREE.Group();
  const red = std('#c4241c', 0.4, 0.2);
  g.add(mesh([cyl(0.13, 0.15, 0.6, 0, 0.3, 0, 12), sph(0.13, 0, 0.62, 0, 12, 8), cyl(0.05, 0.05, 0.36, 0, 0.42, 0, 8).rotateZ(Math.PI / 2)], red));
  return g;
}

export function lawnDeer() {
  const g = new THREE.Group();
  const m = std('#9a5a3a', 0.5);
  g.add(mesh([
    sph(0.22, 0, 0.75, 0, 12, 10).scale(1.8, 1, 1),
    cyl(0.025, 0.03, 0.55, 0.28, 0.3, 0.1, 6), cyl(0.025, 0.03, 0.55, 0.28, 0.3, -0.1, 6),
    cyl(0.025, 0.03, 0.55, -0.28, 0.3, 0.1, 6), cyl(0.025, 0.03, 0.55, -0.28, 0.3, -0.1, 6),
    cyl(0.06, 0.08, 0.45, 0.38, 1.0, 0, 8).rotateZ(-0.35),
    sph(0.11, 0.5, 1.22, 0, 10, 8).scale(1.3, 1, 1),
    new THREE.ConeGeometry(0.04, 0.16, 5).translate(0.5, 1.38, 0.07), new THREE.ConeGeometry(0.04, 0.16, 5).translate(0.5, 1.38, -0.07),
  ], m));
  return g;
}

export function stationWagon(color = '#8a3226') {
  const g = new THREE.Group();
  const body = std(color, 0.35, 0.4);
  const wood = std('#7a5a3a', 0.6);
  const glass = new THREE.MeshStandardMaterial({ color: '#202833', roughness: 0.05, metalness: 0.8 });
  g.add(mesh([bx(1.85, 0.62, 5.0, 0, 0.62, 0)], body));
  g.add(mesh([bx(1.7, 0.55, 3.2, 0, 1.2, -0.4)], body));
  g.add(mesh([bx(1.72, 0.42, 3.0, 0, 1.22, -0.4)], glass, { cast: false }));
  g.add(mesh([bx(1.87, 0.25, 3.6, 0, 0.7, -0.5)], wood));
  const wheelGeos = [[0.85, 1.6], [-0.85, 1.6], [0.85, -1.6], [-0.85, -1.6]].map(([x, z]) => {
    const c = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
    c.rotateZ(Math.PI / 2);
    c.translate(x, 0.34, z);
    return c;
  });
  g.add(mesh(wheelGeos, std('#151515', 0.8)));
  g.add(mesh([bx(1.6, 0.15, 0.08, 0, 0.75, 2.52), bx(1.6, 0.15, 0.08, 0, 0.6, -2.52)], std('#d0d0d0', 0.2, 1)));
  g.add(mesh([bx(0.3, 0.12, 0.05, 0.6, 0.85, 2.52), bx(0.3, 0.12, 0.05, -0.6, 0.85, 2.52)],
    new THREE.MeshStandardMaterial({ color: '#fff6d0', emissive: '#fff0b0', emissiveIntensity: 0.6 })));
  g.add(mesh([bx(0.25, 0.12, 0.05, 0.65, 0.85, -2.52), bx(0.25, 0.12, 0.05, -0.65, 0.85, -2.52)],
    new THREE.MeshStandardMaterial({ color: '#c01010', emissive: '#ff2020', emissiveIntensity: 0.8 })));
  return g;
}

export function streetLamp(glow = '#ffd9a0') {
  const g = new THREE.Group();
  const pole = std('#3a3f44', 0.5, 0.6);
  g.add(mesh([cyl(0.06, 0.09, 5, 0, 2.5, 0, 8), bx(0.08, 0.08, 1.3, 0, 4.95, 0.6)], pole));
  g.add(mesh([cyl(0.25, 0.32, 0.18, 0, 4.85, 1.2, 12)], pole));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(glow).multiplyScalar(5) }));
  bulb.position.set(0, 4.72, 1.2);
  g.add(bulb);
  return g;
}

export function barricade() {
  const g = new THREE.Group();
  const tex = cachedStripe();
  const board = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  g.add(mesh([bx(1.2, 0.22, 0.04, 0, 1.0, 0.18), bx(1.2, 0.22, 0.04, 0, 0.55, 0.18)], board));
  g.add(mesh([bx(1.2, 0.22, 0.04, 0, 1.0, -0.18), bx(1.2, 0.22, 0.04, 0, 0.55, -0.18)], board));
  const legs = std('#c9c9c9', 0.5, 0.5);
  const lg = [];
  for (const x of [-0.5, 0.5]) {
    for (const z of [1, -1]) {
      const l = new THREE.BoxGeometry(0.05, 1.25, 0.05);
      l.rotateX(z * 0.28);
      l.translate(x, 0.6, z * 0.1);
      lg.push(l);
    }
  }
  g.add(mesh(lg, legs));
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a20').multiplyScalar(3) }));
  lamp.position.set(-0.45, 1.25, 0.2);
  g.add(lamp);
  return g;
}

let _stripe = null;
function cachedStripe() {
  if (_stripe) return _stripe;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f4f0'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#d8281c';
  for (let i = -2; i < 10; i++) {
    ctx.beginPath(); ctx.moveTo(i * 40, 64); ctx.lineTo(i * 40 + 20, 64); ctx.lineTo(i * 40 + 44, 0); ctx.lineTo(i * 40 + 24, 0); ctx.fill();
  }
  _stripe = new THREE.CanvasTexture(c);
  _stripe.colorSpace = THREE.SRGBColorSpace;
  return _stripe;
}

export function bench(color = '#7a5a3a') {
  const g = new THREE.Group();
  const w = std(color, 0.8);
  const slats = [];
  for (let i = 0; i < 4; i++) slats.push(bx(1.8, 0.04, 0.1, 0, 0.45, -0.18 + i * 0.12));
  for (let i = 0; i < 3; i++) slats.push(bx(1.8, 0.1, 0.03, 0, 0.62 + i * 0.13, -0.28));
  g.add(mesh(slats, w));
  g.add(mesh([bx(0.06, 0.45, 0.5, 0.8, 0.22, 0), bx(0.06, 0.45, 0.5, -0.8, 0.22, 0),
    bx(0.06, 0.9, 0.05, 0.8, 0.45, -0.3), bx(0.06, 0.9, 0.05, -0.8, 0.45, -0.3)], std('#333333', 0.5, 0.6)));
  return g;
}

export function waterTower() {
  const g = new THREE.Group();
  const m = std('#e9e9e4', 0.5, 0.2);
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    const l = new THREE.CylinderGeometry(0.18, 0.25, 20, 6);
    l.translate(Math.cos(a) * 3, 10, Math.sin(a) * 3);
    legs.push(l);
  }
  g.add(mesh([...legs, cyl(4.2, 4.2, 5, 0, 22, 0, 20), new THREE.ConeGeometry(4.4, 2, 20).translate(0, 25.5, 0)], m));
  return g;
}

export function concretePad(w, d, tint = '#d8d2c4') {
  const tex = rep(concreteTexture(tint), w / 3, d / 3);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  m.position.y = 0.06;
  m.receiveShadow = true;
  return m;
}

export function scarecrow() {
  const g = new THREE.Group();
  const wood = std('#6b4a32', 0.9);
  g.add(mesh([bx(0.1, 2.4, 0.1, 0, 1.2, 0), bx(1.6, 0.08, 0.08, 0, 1.75, 0)], wood));
  g.add(mesh([bx(0.62, 0.75, 0.32, 0, 1.55, 0)], std('#c8564a', 0.9)));
  g.add(mesh([bx(0.2, 0.5, 0.25, -0.62, 1.7, 0), bx(0.2, 0.5, 0.25, 0.62, 1.7, 0)], std('#c8564a', 0.9)));
  g.add(mesh([sph(0.2, 0, 2.15, 0, 12, 10)], std('#e8d8a8', 0.9)));
  g.add(mesh([cyl(0.38, 0.38, 0.03, 0, 2.3, 0, 16), cyl(0.18, 0.2, 0.2, 0, 2.4, 0, 12)], std('#d8b860', 0.9)));
  return g;
}
