import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase } from './common.js';
import { Terrain, grassLayers, scatterFlowers } from '../core/terrain.js';
import { makeNoise2D, fbm2, smoothstep, mulberry32 } from '../core/noise.js';
import { rubberTexture, dirtTexture, flowerSpriteTexture, canvasTexture } from '../core/textures.js';
import { picketFence, roundTree, bench, boxCollider, circleCollider, bx, cyl, sph, mesh, std, windTurbine } from '../props/props.js';

export const skyOpts = {
  top: '#0f5fd8', mid: '#3aa0f4', horizon: '#bfe8ff', midHeight: 0.3,
  sunDir: [0.45, 0.8, 0.35], sunGlow: 0.25, sunGlow2: 1.4, sunSize: 0.028,
  cloudCover: 0.48, cloudScale: 0.7, cloudSoft: 0.22, cloudShade: '#a9bede', haze: 0.3,
};

function tube(points, r, seg = 24) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), seg, r, 8, false);
}

function blockTexture(letter, color) {
  return canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = color; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 8; c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#ffffff'; c.font = 'bold 84px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(letter, w / 2, h / 2 + 4);
  }, { wrap: false });
}

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  L.def.skyOpts = skyOpts;
  const q = ctx.q;
  const noise = makeNoise2D(41);
  const rnd = mulberry32(12);

  const PAD_R = 15; // rubber safety surface
  const SAND = { x: -11, z: -26, r: 4.5 };
  const height = (x, z) => {
    const r = Math.hypot(x, z);
    const hills = fbm2(noise, x * 0.006, z * 0.006, 4) * 18 * smoothstep(45, 160, r);
    const small = fbm2(noise, x * 0.04, z * 0.04, 2) * 0.35 * smoothstep(PAD_R + 1, PAD_R + 6, r);
    return hills + small;
  };
  const sandD = (x, z) => Math.hypot(x - SAND.x, z - SAND.z);
  const terrain = new Terrain({
    size: 440, segments: 140, fieldRes: 512, height,
    grass: (x, z) => smoothstep(PAD_R + 0.2, PAD_R + 1.0, Math.hypot(x, z)) * smoothstep(SAND.r + 0.2, SAND.r + 1.2, sandD(x, z)),
    path: (x, z) => 1 - smoothstep(SAND.r - 0.5, SAND.r + 0.2, sandD(x, z)),
    tint: (x, z) => 0.5 + 0.4 * fbm2(noise, x * 0.03, z * 0.03, 2),
    pathTex: dirtTexture('#f0dca8'),
    pathRepeat: 0.6,
  });
  L.add(terrain.mesh);
  L.groundHeight = height;
  L.surface = (x, z) => (Math.hypot(x, z) < PAD_R ? 'rubber' : sandD(x, z) < SAND.r ? 'dirt' : 'grass');

  const grass = grassLayers(terrain, q, { height: 0.38, width: 0.075, base: '#2a6a1a', tip: '#a8e45a', wind: 0.8 });
  grass.meshes.forEach((m) => L.add(m));
  L.onUpdate((dt) => grass.update(dt, ctx.camera.position));

  L.setupSky(skyOpts);
  L.setupSun({ dir: skyOpts.sunDir, color: '#fff6e4', intensity: 3.4, area: 30 });
  L.setupHemi('#bfe4ff', '#5a8a3a', 1.1);
  L.setupFog('#c4e6ff', 70, 450);
  L.envFromSky(0.6);

  // rubber pad
  const rub = rubberTexture('#ff9cc4', '#86e3d4');
  rub.repeat.set(6, 6);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R, PAD_R + 0.15, 0.12, 64), new THREE.MeshStandardMaterial({ map: rub, roughness: 0.85 }));
  pad.position.y = 0.0;
  pad.receiveShadow = true;
  L.add(pad);
  // sandbox border
  const border = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const g = new THREE.BoxGeometry(1.25, 0.3, 0.25);
    g.rotateY(-a + Math.PI / 2);
    g.translate(SAND.x + Math.cos(a) * SAND.r, height(SAND.x, SAND.z) + 0.15, SAND.z + Math.sin(a) * SAND.r);
    border.push(g);
  }
  L.add(mesh(border, std('#ffd36a', 0.6)));

  // ---------------------------------------------------------------- slide
  const yellow = std('#ffd23f', 0.35), red = std('#ff5a6e', 0.4), blue = std('#5ab8ff', 0.4), mint = std('#7fe3c4', 0.4), white = std('#ffffff', 0.4);
  const slide = new THREE.Group();
  slide.add(mesh([bx(2.0, 0.12, 2.0, 0, 2.2, 0)], blue));
  slide.add(mesh([cyl(0.07, 0.07, 3.4, -0.95, 1.7, -0.95, 10), cyl(0.07, 0.07, 3.4, 0.95, 1.7, -0.95, 10), cyl(0.07, 0.07, 3.4, -0.95, 1.7, 0.95, 10), cyl(0.07, 0.07, 3.4, 0.95, 1.7, 0.95, 10)], red));
  slide.add(mesh([new THREE.ConeGeometry(1.6, 1.0, 4).rotateY(Math.PI / 4).translate(0, 3.9, 0)], yellow));
  const rungs = [];
  for (let i = 0; i < 7; i++) rungs.push(cyl(0.035, 0.035, 0.8, 0, 0.3 + i * 0.3, 0, 8).rotateZ(Math.PI / 2).translate(0, 0, 1.25));
  rungs.push(cyl(0.05, 0.05, 2.3, -0.42, 1.1, 1.25, 8), cyl(0.05, 0.05, 2.3, 0.42, 1.1, 1.25, 8));
  slide.add(mesh(rungs, white));
  // slide chute
  const shape = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    shape.push(new THREE.Vector3(0, 2.25 - t * 2.0 - Math.sin(t * Math.PI) * 0.25, -1.0 - t * 3.6));
  }
  const chute = [];
  for (let i = 0; i < shape.length - 1; i++) {
    const a = shape[i], b = shape[i + 1];
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(0.9, 0.05, len + 0.02);
    g.rotateX(Math.atan2(b.y - a.y, -(b.z - a.z)));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    chute.push(g);
    const s1 = new THREE.BoxGeometry(0.06, 0.25, len + 0.02);
    s1.rotateX(Math.atan2(b.y - a.y, -(b.z - a.z)));
    chute.push(s1.clone().translate(-0.46, (a.y + b.y) / 2 + 0.1, (a.z + b.z) / 2), s1.translate(0.46, (a.y + b.y) / 2 + 0.1, (a.z + b.z) / 2));
  }
  slide.add(mesh(chute, yellow));
  slide.position.set(6, 0.06, -4);
  slide.rotation.y = -0.6;
  L.add(slide);
  L.collide(boxCollider(6, -4, 2.2, 2.2, -0.6));

  // ---------------------------------------------------------------- swings (they sway by themselves)
  const swing = new THREE.Group();
  const frame = [];
  for (const sx of [-2.6, 2.6]) {
    frame.push(cyl(0.07, 0.07, 3.2, sx, 1.5, 0.75, 10).rotateX(0.0));
  }
  const legGeo = (x, z) => {
    const g = new THREE.CylinderGeometry(0.07, 0.07, 3.1, 10);
    g.rotateX(z > 0 ? -0.25 : 0.25);
    g.translate(x, 1.5, z * 0.38);
    return g;
  };
  frame.length = 0;
  for (const sx of [-2.6, 2.6]) frame.push(legGeo(sx, 1), legGeo(sx, -1));
  frame.push(cyl(0.08, 0.08, 5.4, 0, 3.0, 0, 10).rotateZ(Math.PI / 2).translate(0, 0, 0));
  swing.add(mesh(frame, red));
  const seats = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Group();
    s.position.set(-1.6 + i * 1.6, 3.0, 0);
    s.add(mesh([cyl(0.012, 0.012, 2.4, -0.25, -1.2, 0, 4), cyl(0.012, 0.012, 2.4, 0.25, -1.2, 0, 4)], std('#c8c8c8', 0.3, 0.9), { cast: false }));
    s.add(mesh([bx(0.6, 0.05, 0.25, 0, -2.42, 0)], [mint, blue, yellow][i]));
    s.userData.phase = i * 1.3;
    seats.push(s);
    swing.add(s);
  }
  swing.position.set(-6, 0.06, -2);
  swing.rotation.y = 0.35;
  L.add(swing);
  L.collide(circleCollider(-6 - 2.45, -2 + 0.9, 0.5), circleCollider(-6 + 2.45, -2 - 0.9, 0.5));
  L.onUpdate((dt, t) => seats.forEach((s, i) => { s.rotation.x = Math.sin(t * 1.25 + s.userData.phase) * (0.35 - i * 0.08); }));

  // ---------------------------------------------------------------- merry-go-round
  const mgr = new THREE.Group();
  mgr.add(mesh([cyl(1.7, 1.7, 0.12, 0, 0.35, 0, 32)], std('#ff7aa8', 0.4)));
  const bars = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    bars.push(tube([new THREE.Vector3(Math.cos(a) * 1.55, 0.4, Math.sin(a) * 1.55), new THREE.Vector3(Math.cos(a) * 1.1, 1.2, Math.sin(a) * 1.1), new THREE.Vector3(0, 1.35, 0)], 0.035, 12));
  }
  mgr.add(mesh(bars, std('#ffe36a', 0.4, 0.2)));
  mgr.position.set(0, 0.06, -10);
  L.add(mgr);
  L.collide(circleCollider(0, -10, 1.8));
  L.onUpdate((dt) => { mgr.rotation.y += dt * 0.25; });

  // climbing dome (geodesic)
  const ico = new THREE.IcosahedronGeometry(2.2, 1);
  const pos = ico.attributes.position;
  const edges = new Map();
  for (let i = 0; i < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i + k), b = new THREE.Vector3().fromBufferAttribute(pos, i + ((k + 1) % 3));
      if (a.y < -0.3 && b.y < -0.3) continue;
      const key = [a, b].map((v) => v.toArray().map((n) => n.toFixed(2)).join(',')).sort().join('|');
      if (!edges.has(key)) edges.set(key, [a, b]);
    }
  }
  const domeBars = [];
  for (const [a, b] of edges.values()) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(0.035, 0.035, len, 6);
    g.translate(0, len / 2, 0);
    const dir = b.clone().sub(a).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(a.x, a.y, a.z);
    domeBars.push(g);
  }
  const dome = mesh(domeBars, std('#9b7bff', 0.35, 0.3));
  dome.position.set(8, 0.6, 7);
  L.add(dome);
  L.collide(circleCollider(8, 7, 2.3));

  // spring riders
  const riders = [];
  for (const [x, z, c] of [[-3, 6, '#ffb03a'], [-0.5, 8, '#62d6ff']]) {
    const g = new THREE.Group();
    g.add(mesh([tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, 0.2, 0), new THREE.Vector3(-0.05, 0.4, 0), new THREE.Vector3(0, 0.55, 0)], 0.06, 10)], std('#6a6a6a', 0.4, 0.8)));
    const body = new THREE.Group();
    body.add(mesh([sph(0.35, 0, 0.0, 0, 16, 12).scale(1.4, 0.9, 0.8), sph(0.22, 0.45, 0.32, 0, 14, 10), new THREE.ConeGeometry(0.08, 0.2, 8).rotateZ(-Math.PI / 2).translate(0.72, 0.3, 0)], std(c, 0.35)));
    body.position.y = 0.85;
    g.add(body);
    g.position.set(x, 0.06, z);
    g.rotation.y = rnd() * 3;
    g.userData.body = body;
    L.add(g);
    riders.push(g);
    L.collide(circleCollider(x, z, 0.5));
  }
  L.onUpdate((dt, t) => riders.forEach((r, i) => { r.userData.body.rotation.z = Math.sin(t * 1.7 + i * 2) * 0.12; }));

  // toy blocks
  const letters = [['A', '#ff6b8a'], ['Б', '#5ab8ff'], ['В', '#ffc83a'], ['?', '#7fe3c4']];
  letters.forEach(([l, c], i) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ map: blockTexture(l, c), roughness: 0.6 }));
    const x = -11 + (i % 2) * 1.0, z = 6 + Math.floor(i / 2) * 0.05;
    b.position.set(x + (i > 1 ? 0.5 : 0), 0.51 + (i > 1 ? 0.9 : 0), z);
    b.rotation.y = rnd() * 0.6;
    b.castShadow = true;
    b.receiveShadow = true;
    L.add(b);
  });
  L.collide(boxCollider(-10.5, 6, 2.2, 1.2));

  // balloons tied to a bench
  const bch = bench('#ff8fb8');
  bch.position.set(11, height(11, -14), -14);
  bch.rotation.y = -1.2;
  L.add(bch);
  L.collide(boxCollider(11, -14, 1.9, 0.7, -1.2));
  const balloons = [];
  const bcols = ['#ff5f8f', '#ffd23f', '#5ab8ff', '#9b7bff', '#7fe3c4', '#ff9a3c'];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 16).scale(1, 1.18, 1), new THREE.MeshPhysicalMaterial({ color: bcols[i], roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 }));
    m.castShadow = true;
    const base = new THREE.Vector3(10.8 + (rnd() - 0.5) * 0.8, 3.0 + rnd() * 1.2, -14 + (rnd() - 0.5) * 0.8);
    m.position.copy(base);
    m.userData.base = base;
    L.add(m);
    balloons.push(m);
  }
  const strings = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
  L.add(strings);
  L.onUpdate((dt, t) => {
    const pts = [];
    balloons.forEach((b, i) => {
      b.position.x = b.userData.base.x + Math.sin(t * 0.7 + i) * 0.15;
      b.position.y = b.userData.base.y + Math.sin(t * 0.9 + i * 1.7) * 0.1;
      pts.push(new THREE.Vector3(11, height(11, -14) + 0.6, -14), b.position.clone().add(new THREE.Vector3(0, -0.36, 0)));
    });
    strings.geometry.setFromPoints(pts);
  });

  // pastel fence around the playground with a gap
  const fencePts = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2 * 0.9 + 0.25 * Math.PI;
    fencePts.push([Math.cos(a) * (PAD_R + 6), Math.sin(a) * (PAD_R + 6) + 0]);
  }
  const fence = picketFence(fencePts, { heightAt: height, color: '#fff3f8', height: 0.95 });
  L.add(fence.object);
  L.collide(fence.colliders);

  // trees and distant windmills
  for (let i = 0; i < 18; i++) {
    const a = rnd() * Math.PI * 2, r = 30 + rnd() * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const t = roundTree(6 + rnd() * 4, '#5fae40', i + 20);
    t.position.set(x, height(x, z), z);
    L.add(t);
    L.collide(circleCollider(x, z, 0.4));
  }
  const turbines = [];
  for (let i = 0; i < 7; i++) {
    const a = -0.8 + i * 0.3, r = 200 + rnd() * 60;
    const x = Math.sin(a) * r, z = -Math.cos(a) * r;
    const t = windTurbine({ height: 38 });
    t.position.set(x, height(x, z) - 1, z);
    t.traverse((o) => { o.castShadow = false; });
    L.add(t);
    turbines.push(t);
  }
  L.onUpdate((dt) => turbines.forEach((t) => t.userData.update(dt)));

  const fArea = [-60, -60, 60, 60];
  const out = (x, z) => Math.hypot(x, z) > PAD_R + 1.5 && sandD(x, z) > SAND.r + 1;
  L.add(scatterFlowers({ terrain, count: Math.round(1400 * q.detail), area: fArea, texture: flowerSpriteTexture('#ffffff', '#ffd23a'), size: 0.2, seed: 9, filter: out }));
  L.add(scatterFlowers({ terrain, count: Math.round(700 * q.detail), area: fArea, texture: flowerSpriteTexture('#ff8fc0', '#fff2a0', 'pinkflower'), size: 0.2, seed: 10, filter: out }));

  // doors: a pink one by the slide is locked, the yellow one stands in the sandbox
  L.makeDecoy({ color: '#ff9cc6', frameColor: '#ffffff' }, 12.5, 0.06, 2, -Math.PI / 2 - 0.3);
  L.makeDoor({ color: '#ffd84a', frameColor: '#fff4c4', glow: '#fffbe6', style: 'panel' }, SAND.x, height(SAND.x, SAND.z), SAND.z, 0.5);

  L.bounds = { type: 'circle', x: 0, z: 0, r: 75 };
  L.spawn = { x: 2, z: 13, yaw: 0.1, pitch: -0.04 };
  L.menuCam = { x: 2, z: 13, yaw: 0.25, y: 1.4, pitch: 0.05 };
  return L;
}
