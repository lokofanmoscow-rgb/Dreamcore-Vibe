import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LevelBase, floatingMotes } from './common.js';
import { tileTexture, waterNormalTexture, nrm, glowTexture } from '../core/textures.js';
import { boxCollider } from '../props/props.js';

const WALL_H = 4.6;
const POOL_FLOOR = -0.5;
const WATER = -0.1;

// box whose UVs repeat once per metre on every face
function tiledBox(w, h, d, x, y, z, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  g.translate(x, y, z);
  return g;
}

// floor slab rectangles that avoid the pools (simple sweep decomposition)
function floorRects(hall, pools) {
  const xs = new Set([hall.x0, hall.x1]);
  for (const p of pools) { xs.add(p.x0); xs.add(p.x1); }
  const xa = [...xs].filter((x) => x >= hall.x0 && x <= hall.x1).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xa.length - 1; i++) {
    const x0 = xa[i], x1 = xa[i + 1], xm = (x0 + x1) / 2;
    const cover = pools.filter((p) => xm > p.x0 && xm < p.x1).map((p) => [p.z0, p.z1]).sort((a, b) => a[0] - b[0]);
    let z = hall.z0;
    for (const [a, b] of cover) {
      if (a > z) out.push({ x0, x1, z0: z, z1: a });
      z = Math.max(z, b);
    }
    if (z < hall.z1) out.push({ x0, x1, z0: z, z1: hall.z1 });
  }
  return out;
}

const causticChunk = /* glsl */`
  uniform float uTime;
  varying vec3 vWPosC;
  float caustic(vec2 p, float t) {
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float tt = t * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return pow(abs(c), 8.0);
  }`;

function causticMaterial(base, uniforms, strength = 0.9) {
  base.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosC;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPosC = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + causticChunk)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float under = smoothstep(${WATER.toFixed(2)} + 0.02, ${WATER.toFixed(2)} - 0.1, vWPosC.y);
        float cs = caustic(vWPosC.xz * 1.6 + vec2(vWPosC.y * 0.5), uTime * 0.6);
        totalEmissiveRadiance += vec3(0.55, 0.9, 1.0) * clamp(cs, 0.0, 1.5) * ${strength.toFixed(2)} * under;`);
  };
  base.customProgramCacheKey = () => 'caustic' + strength;
  return base;
}

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  const q = ctx.q;
  const uniforms = { uTime: { value: 0 } };
  L.onUpdate((dt) => { uniforms.uTime.value += dt; });

  const hall = { x0: -14, x1: 14, z0: -72, z1: 8 };
  const pools = [
    { x0: -10, x1: -2.5, z0: -11, z1: -2 },
    { x0: -12, x1: -1.6, z0: -31, z1: -17 },
    { x0: 1.6, x1: 12, z0: -31, z1: -17 },
    { x0: -12, x1: -3, z0: -49, z1: -37 },
    { x0: 3, x1: 12, z0: -49, z1: -37 },
    { x0: -12, x1: 12, z0: -69, z1: -55 },
  ];
  const island = { x0: -3, x1: 3, z0: -66, z1: -59 }; // dry platform in the last pool for the door
  const inRect = (x, z, r, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
  const inPool = (x, z) => pools.some((p) => inRect(x, z, p)) && !inRect(x, z, island);

  const tile = tileTexture('#f7fcff', '#cddde4', 8, 'pooltile');
  const tileMat = new THREE.MeshStandardMaterial({ map: tile, normalMap: nrm(tile), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.16, metalness: 0.0 });
  const aqua = tileTexture('#8edcec', '#5aa8bc', 8, 'pooltile2');
  const poolMat = causticMaterial(new THREE.MeshStandardMaterial({ map: aqua, normalMap: nrm(aqua), roughness: 0.2, emissive: '#000000' }), uniforms, 1.0);
  const wallMat = causticMaterial(new THREE.MeshStandardMaterial({ map: tile, normalMap: nrm(tile), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.18 }), uniforms, 0.35);

  // floor slab around the pools
  const fgeo = [];
  for (const r of floorRects(hall, pools)) {
    fgeo.push(tiledBox(r.x1 - r.x0, 0.3, r.z1 - r.z0, (r.x0 + r.x1) / 2, -0.15, (r.z0 + r.z1) / 2));
  }
  fgeo.push(tiledBox(island.x1 - island.x0, -POOL_FLOOR + 0.0, island.z1 - island.z0, (island.x0 + island.x1) / 2, POOL_FLOOR / 2, (island.z0 + island.z1) / 2));
  const floor = new THREE.Mesh(mergeGeometries(fgeo), tileMat);
  floor.receiveShadow = true;
  L.add(floor);

  // pool basins
  const pg = [];
  for (const p of pools) {
    const w = p.x1 - p.x0, d = p.z1 - p.z0, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    pg.push(tiledBox(w, 0.2, d, cx, POOL_FLOOR - 0.1, cz));
  }
  const basins = new THREE.Mesh(mergeGeometries(pg), poolMat);
  basins.receiveShadow = true;
  L.add(basins);
  // pool side walls (inner faces) share the caustic wall material
  const sideG = [];
  const depth = -POOL_FLOOR;
  for (const p of pools) {
    const w = p.x1 - p.x0, d = p.z1 - p.z0, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    sideG.push(tiledBox(w, depth, 0.02, cx, POOL_FLOOR / 2, p.z0 + 0.01), tiledBox(w, depth, 0.02, cx, POOL_FLOOR / 2, p.z1 - 0.01),
      tiledBox(0.02, depth, d, p.x0 + 0.01, POOL_FLOOR / 2, cz), tiledBox(0.02, depth, d, p.x1 - 0.01, POOL_FLOOR / 2, cz));
  }
  sideG.push(tiledBox(island.x1 - island.x0 + 0.04, depth, island.z1 - island.z0 + 0.04, (island.x0 + island.x1) / 2, POOL_FLOOR / 2 - 0.001, (island.z0 + island.z1) / 2));
  L.add(new THREE.Mesh(mergeGeometries(sideG), poolMat));

  // ---------------------------------------------------------------- walls
  const wg = [];
  const T = 0.4;
  const H = WALL_H;
  wg.push(tiledBox(T, H, hall.z1 - hall.z0, hall.x0 - T / 2, H / 2, (hall.z0 + hall.z1) / 2));
  wg.push(tiledBox(T, H, hall.z1 - hall.z0, hall.x1 + T / 2, H / 2, (hall.z0 + hall.z1) / 2));
  wg.push(tiledBox(hall.x1 - hall.x0 + 2 * T, H, T, 0, H / 2, hall.z0 - T / 2));
  wg.push(tiledBox(hall.x1 - hall.x0 + 2 * T, H, T, 0, H / 2, hall.z1 + T / 2));
  const partitions = [
    { z: -14, openings: [[-1.5, 1.5], [7, 10]] },
    { z: -34, openings: [[-1.4, 1.4]] },
    { z: -52, openings: [[-9, -6], [6, 9]] },
  ];
  const openH = 3.0;
  for (const p of partitions) {
    let x = hall.x0;
    for (const [a, b] of p.openings) {
      if (a > x) wg.push(tiledBox(a - x, H, T, (a + x) / 2, H / 2, p.z));
      wg.push(tiledBox(b - a, H - openH, T, (a + b) / 2, (H + openH) / 2, p.z));
      L.collide(boxCollider((a + x) / 2, p.z, a - x, T));
      x = b;
    }
    wg.push(tiledBox(hall.x1 - x, H, T, (x + hall.x1) / 2, H / 2, p.z));
    L.collide(boxCollider((x + hall.x1) / 2, p.z, hall.x1 - x, T));
  }
  // pillars
  const pillars = [];
  for (const z of [-20, -28]) for (const x of [-8, -4, 4, 8]) pillars.push([x, z]);
  for (const z of [-58, -66]) for (const x of [-9, 9]) pillars.push([x, z]);
  for (const [x, z] of pillars) {
    wg.push(tiledBox(0.7, H + 0.6, 0.7, x, H / 2 - 0.3, z));
    L.collide(boxCollider(x, z, 0.7, 0.7));
  }
  const wallMesh = new THREE.Mesh(mergeGeometries(wg), wallMat);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  L.add(wallMesh);

  // ceiling with glowing light panels
  const ceil = new THREE.Mesh(tiledBox(hall.x1 - hall.x0 + 1, 0.3, hall.z1 - hall.z0 + 1, 0, H + 0.15, (hall.z0 + hall.z1) / 2), tileMat);
  ceil.castShadow = true;
  L.add(ceil);
  const panelGeo = [];
  for (let z = hall.z0 + 4; z < hall.z1 - 1; z += 6) {
    for (const x of [-8, 0, 8]) panelGeo.push(new THREE.BoxGeometry(2.6, 0.05, 2.6).translate(x, H - 0.02, z));
  }
  const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#effcff').multiplyScalar(1.8) });
  L.add(new THREE.Mesh(mergeGeometries(panelGeo), panelMat));

  // ---------------------------------------------------------------- water
  const wn = waterNormalTexture();
  const wn2 = wn.clone();
  wn.repeat.set(0.35, 0.35);
  wn2.repeat.set(0.21, 0.21);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: '#119fc4', roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.72,
    normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1.0, clearcoatRoughness: 0.05,
    clearcoatNormalMap: wn2, clearcoatNormalScale: new THREE.Vector2(0.25, 0.25), depthWrite: false,
  });
  const wGeo = [];
  for (const p of pools) {
    const g = new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0);
    g.rotateX(-Math.PI / 2);
    g.translate((p.x0 + p.x1) / 2, WATER, (p.z0 + p.z1) / 2);
    // planar uv in world metres
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
    wGeo.push(g);
  }
  const water = new THREE.Mesh(mergeGeometries(wGeo), waterMat);
  water.renderOrder = 2;
  L.add(water);
  L.onUpdate((dt) => {
    wn.offset.x += dt * 0.02; wn.offset.y += dt * 0.013;
    wn2.offset.x -= dt * 0.011; wn2.offset.y += dt * 0.017;
  });

  // ---------------------------------------------------------------- light
  L.setupHemi('#ecfbff', '#7fb8c8', 0.45);
  const sun = new THREE.DirectionalLight('#f4fdff', q.shadows ? 1.6 : 0.6);
  sun.position.set(6, 30, 8);
  sun.target.position.set(0, 0, -30);
  if (q.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const c = sun.shadow.camera;
    c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 1; c.far = 80;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 4;
  }
  // light comes from the ceiling panels, so the ceiling must not block it
  ceil.castShadow = false;
  L.add(sun, sun.target);
  L.setupFogExp('#d8f1f6', 0.003);

  // soft sparkles over the water
  const motes = floatingMotes(Math.round(160 * q.particles), { color: '#e8fcff', size: 0.035, area: 10, height: 4, speed: 0.06, opacity: 0.6, tex: glowTexture() });
  L.add(motes);
  L.onUpdate((dt, t, player) => motes.userData.update(t, player.pos, 0.0));

  // ---------------------------------------------------------------- doors
  L.makeDecoy({ color: '#ffffff', frameColor: '#e8f4f8' }, hall.x0 + 0.08, 0, -43, Math.PI / 2);
  L.makeDecoy({ color: '#ffffff', frameColor: '#e8f4f8' }, hall.x1 - 0.08, 0, -6, -Math.PI / 2);
  L.makeDoor({ color: '#8fe0f0', frameColor: '#e6fbff', glow: '#f0ffff', style: 'panel' }, 0, 0, -64.5, 0);

  L.groundHeight = (x, z) => (inPool(x, z) ? POOL_FLOOR : 0);
  L.surface = (x, z) => (inPool(x, z) ? 'water' : 'tile');
  L.bounds = { type: 'box', x0: hall.x0, x1: hall.x1, z0: hall.z0, z1: hall.z1 };
  L.spawn = { x: 4.5, z: 5, yaw: 0.15, pitch: -0.05 };
  L.menuCam = { x: 4.5, z: 6, yaw: 0.3, y: 1.4, pitch: 0.0 };
  L.envFromScene(new THREE.Vector3(0, 2.2, -10), 0.45);
  L.far = 160;
  return L;
}
