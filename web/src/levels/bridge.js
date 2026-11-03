import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase } from './common.js';
import { asphaltTexture, canvasTexture, concreteTexture, waterNormalTexture, nrm, rep } from '../core/textures.js';
import { mulberry32 } from '../core/noise.js';
import { stationWagon, boxCollider } from '../props/props.js';

// An endless sea bridge in thick haze: two carriageways, a median screen,
// curved white lamp posts, overhead LED signs and a building lost in the fog.

const Z0 = 24, Z1 = -900;      // deck extent
const HALF = 14;               // half deck width
const END = -820;              // the gate building

function deckY(z) {
  const t = Math.min(1, Math.max(0, (-z - 120) / 420));
  const hump = (1 - Math.cos(t * Math.PI * 2)) * 0.5 * 7.5;
  const t2 = Math.min(1, Math.max(0, (-z - 600) / 180));
  return hump + t2 * t2 * (3 - 2 * t2) * 2.5;
}

function roadTexture() {
  const asp = asphaltTexture();
  return canvasTexture(512, 512, (c, w, h) => {
    c.drawImage(asp.image, 0, 0, w, h);
    c.fillStyle = 'rgba(30,30,34,0.18)';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(240,240,236,0.92)';
    c.fillRect(8, 0, 8, h); c.fillRect(w - 16, 0, 8, h);
    for (const u of [1 / 3, 2 / 3]) c.fillRect(w * u - 4, 0, 8, h * 0.45);
  });
}

function ledTexture(text) {
  return canvasTexture(1024, 128, (c, w, h) => {
    c.fillStyle = '#111316'; c.fillRect(0, 0, w, h);
    c.font = 'bold 76px "Courier New", monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#ff3020'; c.shadowBlur = 18;
    c.fillStyle = '#ff4a30';
    c.fillText(text, w / 2, h / 2 + 4);
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = '#000';
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) c.fillRect(x, y, 3, 3);
  }, { wrap: false });
}

// segment geometry that follows the deck profile
function along(z0, z1, step, make) {
  const geos = [];
  for (let z = z0; z > z1; z -= step) {
    const za = z, zb = Math.max(z1, z - step);
    const ya = deckY(za), yb = deckY(zb);
    const len = Math.hypot(za - zb, ya - yb);
    const pitch = Math.atan2(ya - yb, za - zb);
    const g = make(len);
    g.rotateX(-pitch);
    g.translate(0, (ya + yb) / 2, (za + zb) / 2);
    geos.push(g);
  }
  return mergeGeometries(geos);
}

export const skyOpts = {
  top: '#7f97a8', mid: '#9db1bd', horizon: '#b7c6cd', midHeight: 0.4,
  sunDir: [0.3, 0.5, -0.8], sunGlow: 0.12, sunGlow2: 0.3, sunSize: 0.0,
  cloudCover: 0.6, cloudScale: 0.6, cloudSoft: 0.6, cloudColor: '#c9d4da', cloudShade: '#8a9aa6', haze: 0.8,
};

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  L.def.skyOpts = skyOpts;
  const q = ctx.q;
  const rnd = mulberry32(2024);

  L.setupSky(skyOpts);
  L.setupSun({ dir: [0.35, 0.65, -0.6], color: '#e8eef2', intensity: 1.3, area: 34 });
  L.setupHemi('#c8d6de', '#5a6a72', 1.25);
  L.setupFogExp('#a5b5be', 0.0085);
  L.envFromSky(0.6);

  // ---------------------------------------------------------------- deck
  const concrete = rep(concreteTexture('#c9c9c4'), 0.5, 0.5);
  const concMat = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.85 });
  const deck = new THREE.Mesh(along(Z0, Z1, 8, (len) => new THREE.BoxGeometry(HALF * 2, 1.6, len + 0.05).translate(0, -0.8, 0)), concMat);
  deck.receiveShadow = true;
  L.add(deck);
  const rt = roadTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: rt, normalMap: nrm(asphaltTexture()), roughness: 0.75 });
  for (const cx of [-6.8, 6.8]) {
    const g = along(Z0, Z1, 6, (len) => {
      const p = new THREE.PlaneGeometry(10.6, len + 0.02);
      p.rotateX(-Math.PI / 2);
      return p;
    });
    // road UVs: one texture across the carriageway, repeating every 12 m
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + 5.3) / 10.6, -pos.getZ(i) / 12);
    g.translate(cx, 0.02, 0);
    const m = new THREE.Mesh(g, roadMat);
    m.receiveShadow = true;
    L.add(m);
  }
  // median: concrete barrier + green anti-glare screen
  L.add(new THREE.Mesh(along(Z0, Z1, 8, (len) => {
    const s = new THREE.Shape();
    s.moveTo(-0.45, 0); s.lineTo(0.45, 0); s.lineTo(0.2, 0.3); s.lineTo(0.12, 0.85); s.lineTo(-0.12, 0.85); s.lineTo(-0.2, 0.3); s.lineTo(-0.45, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: len + 0.02, bevelEnabled: false });
    g.translate(0, 0, -(len + 0.02) / 2);
    return g;
  }), concMat));
  L.add(new THREE.Mesh(along(Z0, Z1, 8, (len) => new THREE.BoxGeometry(0.06, 1.0, len).translate(0, 1.35, 0)),
    new THREE.MeshStandardMaterial({ color: '#2f8a5a', roughness: 0.6 })));
  // outer parapets with steel guardrails
  for (const sx of [-1, 1]) {
    L.add(new THREE.Mesh(along(Z0, Z1, 8, (len) => new THREE.BoxGeometry(0.5, 0.9, len).translate(sx * (HALF - 0.25), 0.45, 0)), concMat));
    L.add(new THREE.Mesh(along(Z0, Z1, 8, (len) => mergeGeometries([
      new THREE.BoxGeometry(0.08, 0.32, len).translate(sx * (HALF - 0.9), 0.75, 0),
      new THREE.BoxGeometry(0.08, 0.06, len).translate(sx * (HALF - 0.9), 1.05, 0),
    ])), new THREE.MeshStandardMaterial({ color: '#d8dcdc', roughness: 0.35, metalness: 0.8 })));
  }
  // piers into the sea
  const piers = [];
  for (let z = Z0 - 10; z > Z1; z -= 64) {
    const y = deckY(z);
    for (const sx of [-1, 1]) piers.push(new THREE.CylinderGeometry(1.6, 2.0, y + 40, 14).translate(sx * 8, y - 1.6 - (y + 40) / 2, z));
    piers.push(new THREE.BoxGeometry(HALF * 2 - 2, 1.4, 4).translate(0, y - 2.3, z));
  }
  L.add(new THREE.Mesh(mergeGeometries(piers), concMat));

  // ---------------------------------------------------------------- lamps
  const lampGeo = (sx) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 9.5, 0), new THREE.Vector3(-sx * 0.6, 11.2, 0), new THREE.Vector3(-sx * 2.4, 11.6, 0),
    ]);
    return mergeGeometries([
      new THREE.TubeGeometry(curve, 16, 0.11, 6, false),
      new THREE.BoxGeometry(0.9, 0.16, 0.36).translate(-sx * 2.6, 11.55, 0),
    ].map((g) => (g.index ? g.toNonIndexed() : g)));
  };
  const lampMat = new THREE.MeshStandardMaterial({ color: '#f0f2f2', roughness: 0.4, metalness: 0.2 });
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fffdf4').multiplyScalar(1.6) });
  for (const sx of [-1, 1]) {
    const pts = [];
    for (let z = Z0 - 4; z > Z1; z -= 26) pts.push(z);
    const im = new THREE.InstancedMesh(lampGeo(sx), lampMat, pts.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.05, 0.28).translate(-sx * 2.6, 11.45, 0), headMat, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((z, i) => {
      m.makeTranslation(sx * (HALF - 0.3), deckY(z) + 0.9, z);
      im.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      L.collide(boxCollider(sx * (HALF - 0.3), z, 0.5, 0.5));
    });
    im.castShadow = true;
    L.add(im, heads);
  }

  // ---------------------------------------------------------------- sign gantries
  const msgs = ['ТЫ УЖЕ БЫЛ ЗДЕСЬ', 'НЕ ОСТАНАВЛИВАЙТЕСЬ', 'ДО БЕРЕГА 0 КМ', 'ВСЁ ХОРОШО', 'СОН ПРОДОЛЖАЕТСЯ'];
  const steel = new THREE.MeshStandardMaterial({ color: '#b8bec2', roughness: 0.4, metalness: 0.7 });
  let gi = 0;
  for (let z = -60; z > END + 40; z -= 190) {
    const y = deckY(z);
    const g = mergeGeometries([
      new THREE.BoxGeometry(0.3, 7.2, 0.3).translate(-HALF + 0.6, y + 3.6, z), new THREE.BoxGeometry(0.3, 7.2, 0.3).translate(-1.4, y + 3.6, z),
      new THREE.BoxGeometry(0.3, 7.2, 0.3).translate(1.4, y + 3.6, z), new THREE.BoxGeometry(0.3, 7.2, 0.3).translate(HALF - 0.6, y + 3.6, z),
      new THREE.BoxGeometry(HALF * 2 - 0.8, 0.3, 0.3).translate(0, y + 7.2, z), new THREE.BoxGeometry(HALF * 2 - 0.8, 0.2, 0.2).translate(0, y + 6.3, z),
    ]);
    L.add(new THREE.Mesh(g, steel));
    L.collide(boxCollider(-HALF + 0.6, z, 0.4, 0.4), boxCollider(-1.4, z, 0.4, 0.4), boxCollider(1.4, z, 0.4, 0.4), boxCollider(HALF - 0.6, z, 0.4, 0.4));
    const board = new THREE.Mesh(new THREE.BoxGeometry(8.5, 1.1, 0.25), [
      new THREE.MeshStandardMaterial({ color: '#1a1c20' }), new THREE.MeshStandardMaterial({ color: '#1a1c20' }),
      new THREE.MeshStandardMaterial({ color: '#1a1c20' }), new THREE.MeshStandardMaterial({ color: '#1a1c20' }),
      new THREE.MeshBasicMaterial({ map: ledTexture(msgs[gi++ % msgs.length]), color: new THREE.Color(2.2, 2.2, 2.2) }),
      new THREE.MeshStandardMaterial({ color: '#1a1c20' }),
    ]);
    board.position.set(6.8, y + 6.55, z + 0.2);
    L.add(board);
    // lane signals
    for (let k = 0; k < 3; k++) {
      for (const sx of [-1, 1]) {
        const sig = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(k === 1 ? '#40ff70' : '#ff3a2a').multiplyScalar(1.8) }));
        sig.position.set(sx * (3.2 + k * 3.6), y + 5.75, z + 0.2);
        L.add(sig);
      }
    }
  }

  // ---------------------------------------------------------------- the sea
  const wn = waterNormalTexture().clone();
  wn.repeat.set(120, 120);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
    color: '#5f7480', roughness: 0.12, metalness: 0.1, normalMap: wn, normalScale: new THREE.Vector2(0.5, 0.5),
  }));
  sea.position.set(0, -24, -400);
  L.add(sea);
  L.onUpdate((dt) => { wn.offset.x += dt * 0.004; wn.offset.y += dt * 0.006; });

  // ---------------------------------------------------------------- traffic left behind
  const cones = [];
  const coneMat = new THREE.MeshStandardMaterial({ color: '#ff6a20', roughness: 0.5 });
  for (let i = 0; i < 40; i++) {
    const z = -100 - rnd() * 600, x = (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 9);
    cones.push(new THREE.ConeGeometry(0.2, 0.7, 10).translate(x, deckY(z) + 0.35, z));
  }
  L.add(new THREE.Mesh(mergeGeometries(cones), coneMat));
  const blink = [];
  for (const [x, z, c, r] of [[9, -140, '#c8c4b8', 0.02], [-5, -300, '#8a3226', -0.05], [4, -470, '#3a5a7a', 0.08], [-9.5, -610, '#e8e0d0', 0]]) {
    const car = stationWagon(c);
    car.position.set(x, deckY(z) + 0.02, z);
    car.rotation.y = (x < 0 ? Math.PI : 0) + r;
    L.add(car);
    L.collide(boxCollider(x, z, 2.0, 5.1, car.rotation.y));
    for (const ox of [-0.6, 0.6]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: '#ffa020' }));
      h.position.set(x + ox * (x < 0 ? -1 : 1), deckY(z) + 0.88, z + (x < 0 ? 2.55 : -2.55));
      L.add(h);
      blink.push(h);
    }
  }
  L.onUpdate((dt, t) => { const on = Math.sin(t * 4.5) > 0; blink.forEach((b) => b.material.color.setScalar(on ? 2.5 : 0.08).multiply(new THREE.Color('#ffa020'))); });

  // ---------------------------------------------------------------- the gate building in the fog
  const yb = deckY(END);
  const bMat = new THREE.MeshStandardMaterial({ color: '#e4e6e2', roughness: 0.7 });
  const gate = [];
  gate.push(new THREE.BoxGeometry(7, 16, 18).translate(-HALF - 2.5, yb + 8, END), new THREE.BoxGeometry(7, 16, 18).translate(HALF + 2.5, yb + 8, END));
  gate.push(new THREE.BoxGeometry(HALF * 2 + 12, 5, 18).translate(0, yb + 18.5, END));
  const dome = new THREE.SphereGeometry(10, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1.6, 0.8, 1);
  gate.push(dome.translate(0, yb + 21, END));
  gate.push(new THREE.CylinderGeometry(0.15, 0.15, 6, 6).translate(0, yb + 32, END));
  gate.push(new THREE.BoxGeometry(2.4, 10, 2.4).translate(0, yb + 5, END - 4));
  L.add(new THREE.Mesh(mergeGeometries(gate.map((g) => (g.index ? g.toNonIndexed() : g))), bMat));
  L.collide(boxCollider(0, END - 4, 2.6, 2.6));
  // the door is set into the central pillar of the gate
  L.makeDoor({ color: '#e8f0f4', frameColor: '#ffffff', glow: '#fffaf0', style: 'panel', beacon: true }, 0, yb, END - 2.75, 0);
  L.makeDecoy({ color: '#d8dcdc', frameColor: '#ffffff' }, -HALF + 0.35, deckY(-380), -380, Math.PI / 2);
  L.makeDecoy({ color: '#d8dcdc', frameColor: '#ffffff' }, HALF - 0.35, deckY(-560), -560, -Math.PI / 2);

  L.groundHeight = (x, z) => deckY(z) + 0.02;
  L.surface = () => 'concrete';
  L.bounds = {
    type: 'fn',
    fn: (pos) => {
      pos.x = Math.max(-HALF + 0.85, Math.min(HALF - 0.85, pos.x));
      pos.z = Math.max(END - 2.45, Math.min(Z0 - 2, pos.z));
      if (Math.abs(pos.x) < 0.75 && pos.z < Z0 - 3 && pos.z > END + 12) pos.x = pos.x < 0 ? -0.75 : 0.75; // median
    },
  };
  L.spawn = { x: 5.5, z: 16, yaw: 0, pitch: 0.02 };
  L.menuCam = { x: 4.5, z: 14, yaw: 0.02, y: 1.5, pitch: 0.04 };
  L.far = 1400;
  return L;
}
