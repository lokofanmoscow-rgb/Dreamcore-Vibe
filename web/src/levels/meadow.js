import * as THREE from 'three';
import { LevelBase } from './common.js';
import { Terrain, grassLayers, scatterFlowers } from '../core/terrain.js';
import { makeNoise2D, fbm2, smoothstep, mulberry32 } from '../core/noise.js';
import { flowerSpriteTexture, dirtTexture } from '../core/textures.js';
import {
  picketFence, windTurbine, house, hedge, flamingo, beachUmbrella, deckChair, hoseReel, hayBales,
  woodSign, waterTower, circleCollider, boxCollider, roundTree,
} from '../props/props.js';

export const skyOpts = {
  top: '#1550c4', mid: '#3a8cea', horizon: '#a8d6ff', midHeight: 0.3,
  sunDir: [-0.35, 0.75, 0.55], sunGlow: 0.2, sunGlow2: 1.2, sunSize: 0.028,
  cloudCover: 0.36, cloudScale: 0.9, cloudSoft: 0.32, cloudShade: '#b4c8e8', haze: 0.25,
};

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  L.def.skyOpts = skyOpts;
  const q = ctx.q;
  const noise = makeNoise2D(11);
  const noise2 = makeNoise2D(29);

  const pathHalf = 1.5;
  const onPath = (x, z) => {
    // fenced corridor from the gate to the open field, then a soft trail to the door
    let d = Infinity;
    if (z < 12 && z > -44) d = Math.abs(x);
    if (z <= -44 && z > -70) {
      const t = (-44 - z) / 26;
      const cx = t * 10;
      d = Math.min(d, Math.abs(x - cx));
    }
    return d;
  };
  const height = (x, z) => {
    const r = Math.hypot(x, z + 20);
    const hills = fbm2(noise, x * 0.0055, z * 0.0055, 4) * 22 * smoothstep(35, 170, r);
    const small = fbm2(noise2, x * 0.03, z * 0.03, 3) * 0.6;
    const doorHill = 2.2 * Math.exp(-((x - 12) ** 2 + (z + 72) ** 2) / 260);
    return hills + small * smoothstep(3, 8, onPath(x, z)) + doorHill;
  };
  const terrain = new Terrain({
    size: 440, segments: Math.round(150 * Math.max(0.7, q.detail)), fieldRes: 640,
    height,
    grass: (x, z) => {
      const p = onPath(x, z);
      return smoothstep(pathHalf * 0.8, pathHalf + 0.9, p) * (0.78 + 0.22 * fbm2(noise2, x * 0.05, z * 0.05, 2));
    },
    path: (x, z) => 1 - smoothstep(pathHalf * 0.7, pathHalf + 0.4, onPath(x, z)),
    tint: (x, z) => 0.5 + fbm2(noise, x * 0.02 + 5, z * 0.02, 3) * 0.6,
    pathTex: dirtTexture('#d2b48c'),
    groundRepeat: 0.22,
  });
  L.add(terrain.mesh);
  L.groundHeight = (x, z) => height(x, z);
  L.surface = (x, z) => (onPath(x, z) < pathHalf ? 'dirt' : 'grass');

  const grass = grassLayers(terrain, q, {
    height: 0.45, width: 0.075, base: '#245a14', tip: '#9cd94c', wind: 1.0, shadows: q.shadows,
  });
  grass.meshes.forEach((m) => L.add(m));
  L.onUpdate((dt, t, player) => grass.update(dt, ctx.camera.position));

  // sky, light, fog
  L.setupSky(skyOpts);
  L.setupSun({ dir: skyOpts.sunDir, color: '#fff3dd', intensity: 3.2, area: 34 });
  L.setupHemi('#bfe0ff', '#4f7a2c', 1.15);
  L.setupFog('#b4dcff', 70, 460);
  L.envFromSky(0.55);

  // ---------------------------------------------------------------- fences + gate
  const H = height;
  const fenceZ = 12;
  const fences = [
    [[-46, fenceZ + 1.5], [-20, fenceZ + 0.4], [-pathHalf - 2.2, fenceZ]],
    [[pathHalf + 2.2, fenceZ], [22, fenceZ + 0.5], [48, fenceZ + 2]],
    [[-pathHalf - 0.9, fenceZ - 1.5], [-pathHalf - 0.9, -44]],
    [[pathHalf + 0.9, fenceZ - 1.5], [pathHalf + 0.9, -44]],
    // the paddock at the left
    [[-46, fenceZ + 1.5], [-48, 40], [-14, 46]],
    [[48, fenceZ + 2], [50, 42], [16, 47]],
  ];
  fences.forEach((pts, i) => {
    const f = picketFence(pts, { heightAt: H, seed: i + 1 });
    L.add(f.object);
    L.collide(f.colliders);
  });
  // rounded hedges framing the gate
  for (const sx of [-1, 1]) {
    const h = hedge(1.3, 1.7, 3.2, '#5aa83c');
    h.position.set(sx * (pathHalf + 1.25), H(sx * 2.6, fenceZ) - 0.05, fenceZ - 0.2);
    L.add(h);
    L.collide(boxCollider(h.position.x, h.position.z, 1.3, 3.2));
  }
  const sign = woodSign('ТЫ ДОМА', { w: 2.4, h: 0.85 });
  sign.position.set(pathHalf + 3.6, H(pathHalf + 3.6, fenceZ + 0.6), fenceZ + 0.6);
  sign.rotation.y = -0.08;
  L.add(sign);
  L.collide(circleCollider(sign.position.x - 1.1, sign.position.z, 0.12), circleCollider(sign.position.x + 1.1, sign.position.z, 0.12));

  // ---------------------------------------------------------------- yard props
  const umb = beachUmbrella(['#26b3a3', '#f2f4ee']);
  umb.position.set(-12, H(-12, 24), 24);
  L.add(umb);
  L.collide(circleCollider(-12, 24, 0.15));
  const chair = deckChair('#e4402a');
  chair.position.set(-11, H(-11, 25.5), 25.5);
  chair.rotation.y = 0.6;
  L.add(chair);
  L.collide(boxCollider(-11, 25.5, 0.8, 1.6, 0.6));

  const flamingos = [[-6, 16, 0.4], [-7.5, 17.2, 2.4], [9, 15, -0.8], [24, 20, 1.2]];
  for (const [x, z, r] of flamingos) {
    const f = flamingo();
    f.position.set(x, H(x, z), z);
    f.rotation.y = r;
    L.add(f);
  }
  const hose = hoseReel();
  hose.position.set(5.5, H(5.5, 15), 15);
  hose.rotation.y = -0.3;
  L.add(hose);
  L.collide(circleCollider(5.5, 15, 0.3));
  const hay = hayBales(6);
  hay.position.set(14, H(14, 9), 9);
  hay.rotation.y = 0.15;
  L.add(hay);
  L.collide(boxCollider(14, 9, 2.2, 1.6, 0.15));

  const trees = [[-28, 30, 7], [30, 34, 8], [-34, 5, 6], [36, -8, 7], [-24, -30, 6.5]];
  trees.forEach(([x, z, h], i) => {
    const t = roundTree(h, '#5fa840', i + 3);
    t.position.set(x, H(x, z), z);
    L.add(t);
    L.collide(circleCollider(x, z, 0.35));
  });

  // ---------------------------------------------------------------- distance
  const turbines = [];
  const rnd = mulberry32(77);
  for (let i = 0; i < 11; i++) {
    const a = -Math.PI * 0.95 + (i / 10) * Math.PI * 1.1 + (rnd() - 0.5) * 0.15;
    const r = 150 + rnd() * 120;
    const x = Math.sin(a) * r, z = -Math.cos(a) * r - 20;
    const t = windTurbine({ height: 34 + rnd() * 16, bladeLen: 15 + rnd() * 5 });
    t.position.set(x, H(x, z) - 1, z);
    t.rotation.y = 0.4 + rnd() * 0.3;
    t.traverse((o) => { o.castShadow = false; });
    L.add(t);
    turbines.push(t);
  }
  L.onUpdate((dt) => turbines.forEach((t) => t.userData.update(dt)));

  const farm = house({ w: 7, d: 6, h: 3.6, wall: '#f5f3ee', roof: '#c23a2c', roofH: 3.2, chimney: true, seed: 4 });
  farm.object.position.set(-38, H(-38, -150), -150);
  farm.object.rotation.y = 0.4;
  farm.object.traverse((o) => { o.castShadow = false; });
  L.add(farm.object);
  const tower = waterTower();
  tower.position.set(70, H(70, -190) - 1, -190);
  tower.traverse((o) => { o.castShadow = false; });
  L.add(tower);

  // ---------------------------------------------------------------- flowers
  const fArea = [-60, -110, 60, 60];
  const notPath = (x, z) => onPath(x, z) > pathHalf + 0.6;
  L.add(scatterFlowers({ terrain, count: Math.round(1600 * q.detail), area: fArea, texture: flowerSpriteTexture('#ffffff', '#ffd23a'), size: 0.2, seed: 5, filter: notPath }));
  L.add(scatterFlowers({ terrain, count: Math.round(900 * q.detail), area: fArea, texture: flowerSpriteTexture('#ff9a2a', '#c84a10', 'marigold'), size: 0.22, seed: 6, filter: notPath }));
  L.add(scatterFlowers({ terrain, count: Math.round(600 * q.detail), area: fArea, texture: flowerSpriteTexture('#c9a6ff', '#fff2a0', 'violet'), size: 0.18, seed: 7, filter: notPath }));

  // ---------------------------------------------------------------- the door
  const dx = 12, dz = -74;
  const rot = Math.atan2(0 - dx, -44 - dz);
  L.makeDoor({ color: '#fbfbf7', glow: '#fff4d8', style: 'panel' }, dx, H(dx, dz), dz, rot);

  L.spawn = { x: 0, z: 30, yaw: 0, pitch: -0.02 };
  L.menuCam = { x: 1.5, z: 26, yaw: 0.12, y: 1.5, pitch: 0.06 };
  L.bounds = { type: 'circle', x: 0, z: -20, r: 115 };
  return L;
}
