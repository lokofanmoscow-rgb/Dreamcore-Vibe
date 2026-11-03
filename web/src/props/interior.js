import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/noise.js';
import { woodFloorTexture, paintedWallTexture, sidingTexture, nrm, rep } from '../core/textures.js';

// Hollow house shell with rooms and furniture. Everything is built in the
// house's local frame (front = +z) and merged per material by the level batcher.

const WT = 0.18; // wall thickness

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// wall slab with rectangular holes. `axis` 'x': spans local x at constant z
function holedWall(axis, at, a0, a1, y0, y1, holes, outward) {
  const len = a1 - a0, hgt = y1 - y0;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, hgt); shape.lineTo(0, hgt); shape.lineTo(0, 0);
  for (const h of holes) {
    const p = new THREE.Path();
    const u0 = h.a0 - a0, u1 = h.a1 - a0, v0 = h.y0 - y0, v1 = h.y1 - y0;
    p.moveTo(u0, v0); p.lineTo(u1, v0); p.lineTo(u1, v1); p.lineTo(u0, v1); p.lineTo(u0, v0);
    shape.holes.push(p);
  }
  const slab = new THREE.ExtrudeGeometry(shape, { depth: WT, bevelEnabled: false });
  const lining = new THREE.ShapeGeometry(shape);
  // outward: +1 when the exterior face is towards +axis normal
  if (axis === 'x') {
    slab.translate(a0, y0, outward > 0 ? at - WT : at);
    lining.translate(a0, y0, outward > 0 ? at - WT - 0.004 : at + WT + 0.004);
  } else {
    slab.rotateY(-Math.PI / 2);
    lining.rotateY(-Math.PI / 2);
    slab.translate(outward > 0 ? at : at + WT, y0, a0);
    lining.translate(outward > 0 ? at - WT - 0.004 : at + WT + 0.004, y0, a0);
  }
  return { slab, lining };
}

// small palettes so the level batcher can merge furniture across houses
const FURN = {
  sofa: ['#8a9a7a', '#a07a6a', '#7a8aa8'],
  wood: ['#7a5a3e', '#a8865e'],
  rug: ['#b85a4a', '#5a7ab0', '#c8a860'],
  paint: ['#efe6d2', '#dfe6dc', '#ead8d8'],
};

export function buildInterior({ w, d, h, wall, glassGlow, doorX, garage, seed, trimMat }) {
  const rnd = mulberry32(seed * 131 + 7);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const FY = 0.3;                        // floor height inside
  const parts = {};                      // material key -> geometries
  const mats = {};
  const add = (key, mat, g) => { (parts[key] || (parts[key] = [])).push(g); mats[key] = mat; };
  const std = (c, r = 0.7, m = 0, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
  const colliders = [];                  // local oboxes
  const col = (x, z, cw, cd) => colliders.push({ x, z, w: cw, d: cd });

  // ---------------------------------------------------------------- shell
  const sid = rep(sidingTexture(wall), 1 / 3, 1 / 3);
  const extMat = new THREE.MeshStandardMaterial({ map: sid, normalMap: nrm(sid), roughness: 0.85 });
  const paintTex = rep(paintedWallTexture(pick(FURN.paint), false, 'housepaint'), 0.4, 0.4);
  const paintMat = new THREE.MeshStandardMaterial({ map: paintTex, roughness: 0.9, side: THREE.DoubleSide });
  const xs = garage ? w * 0.05 : w / 2;   // living part ends here; garage beyond
  const doorHole = { a0: doorX - 0.5, a1: doorX + 0.5, y0: FY, y1: 2.4 };
  const nWin = Math.max(1, Math.floor(w / 3.2));
  const frontWins = [];
  for (let i = 0; i < nWin; i++) {
    const x = -w / 2 + (i + 0.5) * (w / nWin);
    if (Math.abs(x - doorX) < 1.3) continue;
    if (garage && x > w * 0.05) continue;
    frontWins.push({ a0: x - 0.65, a1: x + 0.65, y0: 1.05, y1: 2.25 });
  }
  const backWins = [{ a0: -w / 4 - 0.6, a1: -w / 4 + 0.6, y0: 1.1, y1: 2.2 }];
  if (!garage) backWins.push({ a0: w / 4 - 0.6, a1: w / 4 + 0.6, y0: 1.1, y1: 2.2 });
  const sideWin = [{ a0: -0.6, a1: 0.6, y0: 1.1, y1: 2.2 }];
  const walls = [
    holedWall('x', d / 2, -w / 2, w / 2, 0, h, [doorHole, ...frontWins], 1),
    holedWall('x', -d / 2, -w / 2, w / 2, 0, h, backWins, -1),
    holedWall('z', -w / 2, -d / 2, d / 2, 0, h, sideWin, -1),
    holedWall('z', w / 2, -d / 2, d / 2, 0, h, garage ? [] : sideWin, 1),
  ];
  walls.forEach((wl) => { add('ext', extMat, wl.slab); add('paint', paintMat, wl.lining); });
  // colliders for the shell (front split by the door)
  col((-w / 2 + doorHole.a0) / 2, d / 2 - WT / 2, doorHole.a0 + w / 2, WT + 0.1);
  col((doorHole.a1 + w / 2) / 2, d / 2 - WT / 2, w / 2 - doorHole.a1, WT + 0.1);
  col(0, -d / 2 + WT / 2, w, WT + 0.1);
  col(-w / 2 + WT / 2, 0, WT + 0.1, d);
  col(w / 2 - WT / 2, 0, WT + 0.1, d);

  // glass in every window hole
  const glass = new THREE.MeshStandardMaterial({
    color: '#9fb4c8', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28,
    emissive: glassGlow || '#000000', emissiveIntensity: glassGlow ? 0.35 : 0, depthWrite: false,
  });
  for (const wn of frontWins) add('glass', glass, box(wn.a1 - wn.a0, wn.y1 - wn.y0, 0.02, (wn.a0 + wn.a1) / 2, (wn.y0 + wn.y1) / 2, d / 2 - WT / 2));
  for (const wn of backWins) add('glass', glass, box(wn.a1 - wn.a0, wn.y1 - wn.y0, 0.02, (wn.a0 + wn.a1) / 2, (wn.y0 + wn.y1) / 2, -d / 2 + WT / 2));
  add('glass', glass, box(0.02, 1.1, 1.2, -w / 2 + WT / 2, 1.65, 0));
  if (!garage) add('glass', glass, box(0.02, 1.1, 1.2, w / 2 - WT / 2, 1.65, 0));

  // floor & ceiling
  const wood = rep(woodFloorTexture(), 0.25, 0.25);
  const floorMat = new THREE.MeshStandardMaterial({ map: wood, normalMap: nrm(wood), normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.45 });
  const fg = new THREE.PlaneGeometry(w - 2 * WT, d - 2 * WT);
  fg.rotateX(-Math.PI / 2);
  {
    const p = fg.attributes.position, uv = fg.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
  }
  fg.translate(0, FY + 0.005, 0);
  add('floor', floorMat, fg);
  add('ceil', paintMat, box(w - 2 * WT, 0.04, d - 2 * WT, 0, h - 0.02, 0));

  // garage partition
  if (garage) {
    add('paint', paintMat, box(0.12, h, d - 2 * WT, xs, h / 2, 0));
    col(xs, 0, 0.2, d);
  }
  // partition between front room and back room with a doorway
  const zp = -d / 2 + d * 0.45;
  const px0 = -w / 2 + WT, px1 = garage ? xs - 0.06 : w / 2 - WT;
  const pd = Math.max(px0 + 1.2, Math.min(px1 - 1.2, (px0 + px1) / 2 + (rnd() - 0.5) * 1.5));
  const part = holedWall('x', zp + 0.06, px0, px1, FY, h, [{ a0: pd - 0.5, a1: pd + 0.5, y0: FY, y1: 2.3 }], 1);
  add('paint', paintMat, part.slab);
  col((px0 + pd - 0.5) / 2, zp, pd - 0.5 - px0, 0.2);
  col((pd + 0.5 + px1) / 2, zp, px1 - pd - 0.5, 0.2);

  // open front door leaf
  const leaf = box(1.0, 2.05, 0.05, 0.5, FY + 1.03, 0);
  leaf.rotateY(-1.35);
  leaf.translate(doorX - 0.5, 0, d / 2 - WT - 0.03);
  add('door', std('#7a3b2a', 0.5), leaf);

  // ---------------------------------------------------------------- front room (living room)
  const fr = { x0: px0 + 0.1, x1: px1 - 0.1, z0: zp + 0.15, z1: d / 2 - WT - 0.1 };
  const sofaC = pick(FURN.sofa), woodC = pick(FURN.wood);
  const sofaMat = std(sofaC, 0.95), woodMat = std(woodC, 0.6), rugMat = std(pick(FURN.rug), 1.0);
  // keep a walking lane between the front door and the partition doorway
  const laneX = (doorX + pd) / 2;
  const farSide = laneX > (fr.x0 + fr.x1) / 2 ? fr.x0 : fr.x1;
  const sx = farSide === fr.x0 ? fr.x0 + 1.25 : fr.x1 - 1.25;
  // sofa with its back to the partition
  const sz = fr.z0 + 0.45;
  add('sofa', sofaMat, box(2.2, 0.42, 0.85, sx, FY + 0.21, sz));
  add('sofa', sofaMat, box(2.2, 0.5, 0.2, sx, FY + 0.65, sz - 0.33));
  add('sofa', sofaMat, box(0.2, 0.3, 0.85, sx - 1.0, FY + 0.57, sz), box(0.2, 0.3, 0.85, sx + 1.0, FY + 0.57, sz));
  col(sx, sz, 2.3, 0.95);
  // rug + coffee table
  add('rug', rugMat, box(2.6, 0.01, 1.8, sx, FY + 0.012, sz + 1.6));
  add('wood', woodMat, box(1.1, 0.06, 0.6, sx, FY + 0.42, sz + 1.4));
  add('wood', woodMat, box(0.06, 0.4, 0.06, sx - 0.5, FY + 0.2, sz + 1.15), box(0.06, 0.4, 0.06, sx + 0.5, FY + 0.2, sz + 1.15),
    box(0.06, 0.4, 0.06, sx - 0.5, FY + 0.2, sz + 1.65), box(0.06, 0.4, 0.06, sx + 0.5, FY + 0.2, sz + 1.65));
  col(sx, sz + 1.4, 1.2, 0.7);
  // TV on a low stand facing the sofa (towards -z), near the front wall
  const tz = Math.min(fr.z1 - 0.3, sz + 2.9);
  add('wood', woodMat, box(1.4, 0.45, 0.45, sx, FY + 0.225, tz));
  add('tvbody', std('#1a1a1e', 0.4, 0.3), box(1.0, 0.62, 0.1, sx, FY + 0.82, tz));
  add('tvscreen', new THREE.MeshBasicMaterial({ color: new THREE.Color('#7fb0ff').multiplyScalar(rnd() < 0.4 ? 1.6 : 0.35) }), box(0.9, 0.52, 0.01, sx, FY + 0.82, tz - 0.056));
  col(sx, tz, 1.5, 0.5);
  // floor lamp next to the sofa
  const lx = farSide === fr.x0 ? fr.x0 + 0.25 : fr.x1 - 0.25;
  add('metal', std('#c8c2b4', 0.35, 0.8), box(0.04, 1.5, 0.04, lx, FY + 0.75, sz));
  add('lamp', new THREE.MeshStandardMaterial({ color: '#fff0d0', emissive: '#ffd59a', emissiveIntensity: 1.8, roughness: 0.8 }),
    new THREE.CylinderGeometry(0.16, 0.24, 0.3, 12, 1, true).translate(lx, FY + 1.55, sz));
  // a picture frame on the side wall
  const pfx = farSide === fr.x0 ? fr.x0 + 0.02 : fr.x1 - 0.02;
  add('frame', std('#4a3a2a', 0.5), box(0.04, 0.6, 0.85, pfx, 1.7, (fr.z0 + fr.z1) / 2));
  add('art', new THREE.MeshStandardMaterial({ color: pick(['#9fc8e8', '#e8b8c8']), roughness: 0.9 }),
    box(0.045, 0.5, 0.75, pfx, 1.7, (fr.z0 + fr.z1) / 2));

  // ---------------------------------------------------------------- back room: kitchen or bedroom
  const br = { x0: px0 + 0.1, x1: px1 - 0.1, z0: -d / 2 + WT + 0.1, z1: zp - 0.15 };
  if (rnd() < 0.5) {
    // kitchen along the back wall + dining table
    const cw = Math.min(4, br.x1 - br.x0 - 0.4);
    const cx = br.x0 + cw / 2 + 0.1;
    add('counter', std('#e8e4da', 0.5), box(cw, 0.9, 0.62, cx, FY + 0.45, br.z0 + 0.31));
    add('top', std('#8a8a86', 0.3, 0.2), box(cw, 0.04, 0.64, cx, FY + 0.92, br.z0 + 0.31));
    add('fridge', std('#f2f2ee', 0.25, 0.1), box(0.75, 1.8, 0.7, br.x1 - 0.45, FY + 0.9, br.z0 + 0.36));
    col(cx, br.z0 + 0.31, cw, 0.7);
    col(br.x1 - 0.45, br.z0 + 0.36, 0.8, 0.75);
    const tx = (br.x0 + br.x1) / 2, tz2 = (br.z0 + br.z1) / 2 + 0.3;
    add('wood', woodMat, box(1.3, 0.05, 0.8, tx, FY + 0.75, tz2));
    for (const [ox, oz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]]) add('wood', woodMat, box(0.05, 0.74, 0.05, tx + ox, FY + 0.37, tz2 + oz));
    for (const ox of [-0.4, 0.4]) {
      for (const sg of [-1, 1]) {
        add('chair', std(FURN.sofa[0], 0.8), box(0.42, 0.05, 0.42, tx + ox, FY + 0.46, tz2 + sg * 0.62), box(0.42, 0.45, 0.04, tx + ox, FY + 0.7, tz2 + sg * 0.82));
      }
    }
    col(tx, tz2, 1.4, 1.7);
  } else {
    // bedroom
    const bx0 = br.x0 + 1.1, bz = br.z0 + 1.05;
    add('wood', woodMat, box(1.6, 0.35, 2.0, bx0, FY + 0.175, bz), box(1.6, 0.9, 0.08, bx0, FY + 0.45, br.z0 + 0.04));
    add('bed', std('#f2efe6', 0.95), box(1.5, 0.2, 1.9, bx0, FY + 0.45, bz + 0.03));
    add('blanket', std(pick(FURN.rug), 0.95), box(1.55, 0.06, 1.2, bx0, FY + 0.57, bz + 0.4));
    add('bed', std('#f2efe6', 0.95), box(0.5, 0.12, 0.35, bx0 - 0.35, FY + 0.62, bz - 0.7), box(0.5, 0.12, 0.35, bx0 + 0.35, FY + 0.62, bz - 0.7));
    col(bx0, bz, 1.7, 2.1);
    add('wood', woodMat, box(0.5, 0.55, 0.45, bx0 + 1.15, FY + 0.275, br.z0 + 0.25));
    add('lamp', new THREE.MeshStandardMaterial({ color: '#fff0d0', emissive: '#ffd59a', emissiveIntensity: 1.6, roughness: 0.8 }),
      new THREE.CylinderGeometry(0.1, 0.14, 0.2, 10, 1, true).translate(bx0 + 1.15, FY + 0.75, br.z0 + 0.25));
    const wx = br.x1 - 0.35;
    add('wood', woodMat, box(0.6, 1.9, 1.2, wx, FY + 0.95, (br.z0 + br.z1) / 2));
    col(wx, (br.z0 + br.z1) / 2, 0.7, 1.3);
  }
  // ceiling lights
  const ceilLamp = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff3dc').multiplyScalar(rnd() < 0.6 ? 2.0 : 0.6) });
  void ceilLamp;
  add('ceilLamp', ceilLamp, new THREE.CylinderGeometry(0.25, 0.25, 0.05, 16).translate((fr.x0 + fr.x1) / 2, h - 0.05, (fr.z0 + fr.z1) / 2));
  add('ceilLamp', ceilLamp, new THREE.CylinderGeometry(0.22, 0.22, 0.05, 16).translate((br.x0 + br.x1) / 2, h - 0.05, (br.z0 + br.z1) / 2));

  // ---------------------------------------------------------------- meshes
  const group = new THREE.Group();
  for (const [k, list] of Object.entries(parts)) {
    const geo = mergeGeometries(list.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const a of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(a)) n.deleteAttribute(a);
      if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
      return n;
    }));
    const m = new THREE.Mesh(geo, mats[k]);
    m.castShadow = k === 'ext' || k === 'paint' || k === 'ceil';
    m.receiveShadow = true;
    group.add(m);
  }
  return {
    group,
    colliders,
    interior: { x0: -w / 2 + WT, x1: px1, z0: -d / 2 + WT, z1: d / 2 - WT, floorY: FY },
  };
}
