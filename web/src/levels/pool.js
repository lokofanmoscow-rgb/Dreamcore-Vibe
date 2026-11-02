import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water2.js';
import { LevelBase, floatingMotes } from './common.js';
import { tileTexture, waterNormalTexture, nrm, glowTexture, concreteTexture, rep } from '../core/textures.js';
import { boxCollider, circleCollider } from '../props/props.js';

// Flooded poolrooms: white mosaic pillars, green-teal tiled floor under clear
// water, sunlight pouring in sideways from open courts, caustics everywhere.

const WL = 0.55;      // water surface
const CEIL = 3.6;     // ceiling height
const T = 0.35;       // wall thickness
const DRY = 0.8;      // dry platforms

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

function tiledCylinder(r, h, x, y0, z, seg = 40, open = true, thetaStart = 0, thetaLen = Math.PI * 2) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, Math.max(1, Math.round(h)), open, thetaStart, thetaLen);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * thetaLen, uv.getY(i) * h);
  g.translate(x, y0 + h / 2, z);
  return g;
}

function discGeometry(r, x, y, z, seg = 40) {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
  g.translate(x, y, z);
  return g;
}

// floor/ceiling rectangles with rectangular holes
function rectsWithHoles(area, holes) {
  const xs = new Set([area.x0, area.x1]);
  for (const p of holes) { xs.add(Math.max(area.x0, p.x0)); xs.add(Math.min(area.x1, p.x1)); }
  const xa = [...xs].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xa.length - 1; i++) {
    const x0 = xa[i], x1 = xa[i + 1], xm = (x0 + x1) / 2;
    const cover = holes.filter((p) => xm > p.x0 && xm < p.x1).map((p) => [p.z0, p.z1]).sort((a, b) => a[0] - b[0]);
    let z = area.z0;
    for (const [a, b] of cover) {
      if (a > z) out.push({ x0, x1, z0: z, z1: a });
      z = Math.max(z, b);
    }
    if (z < area.z1) out.push({ x0, x1, z0: z, z1: area.z1 });
  }
  return out;
}

const causticChunk = /* glsl */`
  uniform float uTime, uUnder, uAbove, uCeil;
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
    return clamp(pow(abs(c), 8.0), 0.0, 2.0);
  }`;

// caustics in direct sunlight under water, reflected ripples above the water line
function causticMaterial(mat, uniforms, { under = 1.4, above = 0.5, ceil = 0.0, tint = true } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uUnder = { value: under };
    sh.uniforms.uAbove = { value: above };
    sh.uniforms.uCeil = { value: ceil };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosC;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPosC = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + causticChunk)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float underW = 1.0 - smoothstep(${(WL - 0.04).toFixed(3)}, ${(WL + 0.02).toFixed(3)}, vWPosC.y);
        ${tint ? 'diffuseColor.rgb *= mix(vec3(1.0), vec3(0.72, 0.97, 0.86), underW);' : ''}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float csA = caustic(vWPosC.xz * 1.25 + vec2(vWPosC.y * 0.4, -vWPosC.y * 0.3), uTime * 0.55);
        float aboveW = smoothstep(${WL.toFixed(2)}, ${(WL + 0.08).toFixed(2)}, vWPosC.y) * (1.0 - smoothstep(${(WL + 0.25).toFixed(2)}, ${(WL + 2.6).toFixed(2)}, vWPosC.y));
        reflectedLight.directDiffuse *= 1.0 + csA * (uUnder * underW + uAbove * aboveW);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * csA * uCeil * vec3(0.75, 1.0, 0.9) * step(${(CEIL - 0.05).toFixed(2)}, vWPosC.y);`);
  };
  mat.customProgramCacheKey = () => `pc${under}_${above}_${ceil}_${tint}`;
  return mat;
}

// calm, clear pool water: mostly refraction of the tiles, soft reflections,
// gentle wobble and sun glints
const PoolWaterShader = {
  ...Water.WaterShader,
  uniforms: { ...Water.WaterShader.uniforms, uSun: { value: new THREE.Vector3(-0.88, 0.36, 0.3).normalize() } },
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
      vec3 n1 = texture2D(tNormalMap1, vUv * scale * 0.63 - flow.yx * config.y + 0.37).rgb * 2.0 - 1.0;
      vec3 nm = normalize(vec3(n0.x + n1.x, n0.z + n1.z, n0.y + n1.y));
      vec3 normal = normalize(mix(vec3(0.0, 1.0, 0.0), nm, 0.32));
      vec3 toEye = normalize(vToEye);
      float cosT = max(dot(toEye, normal), 0.0);
      float fres = reflectivity + (1.0 - reflectivity) * pow(1.0 - cosT, 5.0);
      vec3 coord = vCoord.xyz / vCoord.w;
      vec2 d = normal.xz * 0.018;
      vec3 refl = texture2D(tReflectionMap, vec2(1.0 - coord.x - d.x, coord.y + d.y)).rgb;
      vec3 refr = texture2D(tRefractionMap, coord.xy + d * 1.4).rgb;
      refr = mix(refr, refr * vec3(0.72, 1.0, 0.9), 0.55);
      vec3 col = mix(refr, refl, clamp(fres * 0.9, 0.0, 1.0)) * color;
      vec3 h = normalize(uSun + toEye);
      col += vec3(1.0, 0.97, 0.88) * pow(max(dot(normal, h), 0.0), 420.0) * 3.0;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
};

export const skyOpts = {
  top: '#9fd0c4', mid: '#d6f2e6', horizon: '#f4fff8', midHeight: 0.4,
  sunDir: [-0.88, 0.36, 0.3], sunColor: '#fff6dc', sunGlow: 0.22, sunGlow2: 0.9, sunSize: 0.03, sunIntensity: 2,
  cloudCover: 0.18, cloudShade: '#c9e2d6', haze: 0.5,
};

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  L.def.skyOpts = skyOpts;
  const q = ctx.q;
  const uniforms = { uTime: { value: 0 } };
  L.onUpdate((dt) => { uniforms.uTime.value += dt; });

  // ---------------------------------------------------------------- materials
  const white = tileTexture('#f8f6ee', '#b2b2aa', 14, 'pt_white', 0.032, 1024);
  const whiteMat = causticMaterial(new THREE.MeshStandardMaterial({
    map: white, normalMap: nrm(white), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.2, side: THREE.DoubleSide,
  }), uniforms, { under: 1.2, above: 0.55 });
  const green = tileTexture('#46cdb0', '#2a7a66', 10, 'pt_green', 0.05, 1024);
  const floorMat = causticMaterial(new THREE.MeshStandardMaterial({
    map: green, normalMap: nrm(green), normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.3,
  }), uniforms, { under: 1.8, above: 0.0, tint: false });
  const ceilMat = new THREE.MeshStandardMaterial({ color: '#efede2', roughness: 1.0, side: THREE.DoubleSide, envMapIntensity: 0.12 });

  const wallG = [];   // white mosaic
  const ceilG = [];
  const addWall = (x0, z0, x1, z1, h = CEIL, y0 = 0) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.01) return;
    const horiz = Math.abs(z1 - z0) < 1e-6;
    const g = horiz ? tiledBox(len, h, T, (x0 + x1) / 2, y0 + h / 2, z0) : tiledBox(T, h, len, x0, y0 + h / 2, (z0 + z1) / 2);
    wallG.push(g);
    if (y0 < 2) L.collide(horiz ? boxCollider((x0 + x1) / 2, z0, len, T) : boxCollider(x0, (z0 + z1) / 2, T, len));
  };
  // wall along z at x with openings [[z0,z1,lintelY], ...]
  const wallZ = (x, z0, z1, openings = [], h = CEIL) => {
    let z = z0;
    for (const [a, b, lin] of openings.sort((p, q2) => p[0] - q2[0])) {
      addWall(x, z, x, a, h);
      if (lin < h) wallG.push(tiledBox(T, h - lin, b - a, x, lin + (h - lin) / 2, (a + b) / 2));
      z = b;
    }
    addWall(x, z, x, z1, h);
  };
  const wallX = (z, x0, x1, openings = [], h = CEIL) => {
    let x = x0;
    for (const [a, b, lin] of openings.sort((p, q2) => p[0] - q2[0])) {
      addWall(x, z, a, z, h);
      if (lin < h) wallG.push(tiledBox(b - a, h - lin, T, (a + b) / 2, lin + (h - lin) / 2, z));
      x = b;
    }
    addWall(x, z, x1, z, h);
  };
  const arc = (cx, cz, r, t0, len, h = CEIL) => {
    wallG.push(tiledCylinder(r, h, cx, 0, cz, Math.max(6, Math.round(len * r * 2)), true, t0, len));
    const n = Math.max(2, Math.round(len * r / 0.9));
    for (let i = 0; i < n; i++) {
      const a0 = t0 + (i / n) * len, a1 = t0 + ((i + 1) / n) * len;
      const p0 = [cx + Math.sin(a0) * r, cz + Math.cos(a0) * r], p1 = [cx + Math.sin(a1) * r, cz + Math.cos(a1) * r];
      const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
      const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      L.collide({ type: 'obox', x: mx, z: mz, hw: 0.2, hd: l / 2 + 0.05, rot: Math.atan2(p1[0] - p0[0], p1[1] - p0[1]), enabled: true });
    }
  };
  const pillar = (x, z, r = 0.95, h = CEIL) => {
    wallG.push(tiledCylinder(r, h, x, 0, z, 44));
    L.collide(circleCollider(x, z, r + 0.02));
  };

  // ---------------------------------------------------------------- main hall
  const MH = { x0: -10, x1: 10, z0: -120, z1: 6 };
  const RC = 3; // rounded corner radius
  const courts = [];
  for (let z = -12; z >= -112; z -= 14) courts.push([z - 4.5, z + 4.5]);
  const rooms = [-20, -60];
  wallX(MH.z1, MH.x0 + RC, MH.x1 - RC);
  arc(MH.x0 + RC, MH.z1 - RC, RC, Math.PI * 1.5, Math.PI / 2);
  arc(MH.x1 - RC, MH.z1 - RC, RC, 0, Math.PI / 2);
  wallZ(MH.x0, MH.z0 + RC, MH.z1 - RC, courts.map(([a, b]) => [a, b, 3.35]));
  wallZ(MH.x1, MH.z0 + RC, MH.z1 - RC, rooms.map((z) => [z - 2, z + 2, 2.9]));
  arc(MH.x0 + RC, MH.z0 + RC, RC, Math.PI, Math.PI / 2);
  arc(MH.x1 - RC, MH.z0 + RC, RC, Math.PI / 2, Math.PI / 2);
  wallX(MH.z0, MH.x0 + RC, MH.x1 - RC, [[-2.5, 2.5, 2.9]]);
  for (let z = -10; z >= -112; z -= 9) { pillar(-4.6, z); pillar(4.6, z); }

  // start platform with steps down into the water
  wallG.push(tiledBox(MH.x1 - MH.x0, DRY, 10, 0, DRY / 2, 1));
  wallG.push(tiledBox(MH.x1 - MH.x0, 0.53, 0.6, 0, 0.265, -4.3));
  wallG.push(tiledBox(MH.x1 - MH.x0, 0.27, 0.6, 0, 0.135, -4.9));

  // the wall above the openings continues as a parapet seen from the terrace
  wallG.push(tiledBox(T, 0.6, MH.z1 - MH.z0 - 2 * RC, MH.x0, CEIL + 0.3, (MH.z0 + MH.z1) / 2));

  // ---------------------------------------------------------------- the open terrace
  for (let i = 0; i < 9; i++) {
    const z = -14 - i * 13;
    pillar(-38, z, 1.0, 4.2);
    if (i % 2 === 0) pillar(-52, z - 5, 1.2, 6.5);
    if (i % 3 === 1) {
      // a lone archway standing in the water
      wallG.push(tiledBox(0.9, 4.0, 0.9, -62, 2.0, z - 2), tiledBox(0.9, 4.0, 0.9, -62, 2.0, z + 2), tiledBox(0.9, 0.9, 4.9, -62, 4.45, z));
      L.collide(boxCollider(-62, z - 2, 0.9, 0.9), boxCollider(-62, z + 2, 0.9, 0.9));
    }
  }

  // ---------------------------------------------------------------- round rooms (right) + right hall
  const RR = 6, RX = 17;
  rooms.forEach((z) => {
    const ha = Math.asin(2 / RR);
    arc(RX, z, RR, -Math.PI / 2 + ha, Math.PI - 2 * ha);
    arc(RX, z, RR, Math.PI / 2 + ha, Math.PI - 2 * ha);
    // short tunnels joining the circles to the halls
    const tx0 = MH.x1, tx1 = RX - RR * Math.cos(ha) + 0.2;
    addWall(tx0, z - 2, tx1, z - 2); addWall(tx0, z + 2, tx1, z + 2);
    const ux0 = RX + RR * Math.cos(ha) - 0.2, ux1 = 23;
    addWall(ux0, z - 2, ux1, z - 2); addWall(ux0, z + 2, ux1, z + 2);
    pillar(RX, z, 1.1);
  });
  const RH = { x0: 23, x1: 37, z0: -92, z1: -8 };
  wallZ(RH.x0, RH.z0, RH.z1, rooms.map((z) => [z - 2, z + 2, 2.9]));
  wallZ(RH.x1, RH.z0, RH.z1);
  wallX(RH.z0, RH.x0, RH.x1);
  wallX(RH.z1, RH.x0, RH.x1);
  for (let z = -14; z >= -86; z -= 9) pillar(30, z, 0.85);

  // ---------------------------------------------------------------- corridor + final rotunda
  wallZ(-2.5, -138, MH.z0, [], 2.9);
  wallZ(2.5, -138, MH.z0, [], 2.9);
  ceilG.push(tiledBox(5, 0.7, 18, 0, 2.9 + 0.35, -129));
  const FR = 8, FZ = -146;
  const fha = Math.asin(2.5 / FR);
  arc(0, FZ, FR, fha, Math.PI * 2 - 2 * fha);
  addWall(-2.5, -138, -2.5, FZ + FR * Math.cos(fha) - 0.1);
  addWall(2.5, -138, 2.5, FZ + FR * Math.cos(fha) - 0.1);
  wallG.push(tiledCylinder(2.6, DRY, 0, 0, FZ, 40, false));

  // ---------------------------------------------------------------- floor, ceiling, merge
  const AREA = { x0: -75, x1: 37.5, z0: -155, z1: 6.5 };
  const floorGeo = new THREE.PlaneGeometry(AREA.x1 - AREA.x0, AREA.z1 - AREA.z0);
  floorGeo.rotateX(-Math.PI / 2);
  {
    const p = floorGeo.attributes.position, uv = floorGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
  }
  floorGeo.translate((AREA.x0 + AREA.x1) / 2, 0, (AREA.z0 + AREA.z1) / 2);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;
  L.add(floor);
  // a green tiled top on the dry island
  const islandTop = new THREE.Mesh(discGeometry(2.6, 0, DRY + 0.001, FZ), floorMat);
  islandTop.receiveShadow = true;
  L.add(islandTop);

  const skylights = [
    { x0: 28, x1: 32, z0: -32, z1: -28 }, { x0: 28, x1: 32, z0: -52, z1: -48 }, { x0: 28, x1: 32, z0: -72, z1: -68 },
    { x0: -2.6, x1: 2.6, z0: FZ - 2.6, z1: FZ + 2.6 },
  ];
  const ceilArea = { x0: MH.x0 - 0.4, x1: RH.x1 + 0.4, z0: AREA.z0, z1: MH.z1 + 0.4 };
  for (const r of rectsWithHoles(ceilArea, skylights)) ceilG.push(tiledBox(r.x1 - r.x0, 0.3, r.z1 - r.z0, (r.x0 + r.x1) / 2, CEIL + 0.15, (r.z0 + r.z1) / 2));
  const ceil = new THREE.Mesh(mergeGeometries(ceilG), ceilMat);
  ceil.castShadow = true;
  ceil.receiveShadow = true;
  L.add(ceil);
  const walls = new THREE.Mesh(mergeGeometries(wallG.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; })), whiteMat);
  walls.castShadow = true;
  walls.receiveShadow = true;
  L.add(walls);

  // ---------------------------------------------------------------- light
  L.setupSky(skyOpts);
  L.setupSun({ dir: skyOpts.sunDir, color: '#fff1d6', intensity: q.shadows ? 5.0 : 1.3, area: 32, far: 160, bias: -0.0006, normalBias: 0.04 });
  L.setupHemi('#f7f6ee', '#e4ebe2', q.shadows ? 0.85 : 1.1);
  L.setupFogExp('#e4e8dc', 0.0045);

  // ---------------------------------------------------------------- water
  const useMirror = q.bloom && ctx.renderer.halfFloat;
  const WS = 200, WC = { x: (AREA.x0 + AREA.x1) / 2, z: (AREA.z0 + AREA.z1) / 2 };
  let water;
  if (useMirror) {
    const n0 = waterNormalTexture();
    const n1 = n0.clone();
    const res = q.pixelRatio >= 2 ? [1536, 768] : q.pixelRatio >= 1.5 ? [1024, 512] : [768, 384];
    water = new Water(new THREE.PlaneGeometry(WS, WS), {
      color: '#f2fffa', scale: WS / 5.5, flowDirection: new THREE.Vector2(0.7, 0.35), flowSpeed: 0.006,
      textureWidth: res[0], textureHeight: res[1], reflectivity: 0.06, normalMap0: n0, normalMap1: n1, shader: PoolWaterShader,
    });
    water.rotation.x = -Math.PI / 2;
  } else {
    const wn = waterNormalTexture().clone();
    wn.repeat.set(WS / 3, WS / 3);
    water = new THREE.Mesh(new THREE.PlaneGeometry(WS, WS).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      color: '#4fd0b0', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.5, normalMap: wn,
      normalScale: new THREE.Vector2(0.3, 0.3), depthWrite: false,
    }));
    L.onUpdate((dt) => { wn.offset.x += dt * 0.01; wn.offset.y += dt * 0.006; });
  }
  water.position.set(WC.x, WL, WC.z);
  water.renderOrder = 2;
  water.userData.dynamic = true;

  // dust glittering in the sunbeams
  const motes = floatingMotes(Math.round(200 * q.particles), { color: '#f4fff4', size: 0.035, area: 12, height: 3, speed: 0.05, opacity: 0.7, tex: glowTexture() });
  L.add(motes);
  L.onUpdate((dt, t, player) => motes.userData.update(t, player.pos, WL));

  // ---------------------------------------------------------------- doors
  L.makeDecoy({ color: '#ffffff', frameColor: '#efefe6' }, RX + RR - 0.25, 0, rooms[0], -Math.PI / 2);
  L.makeDecoy({ color: '#ffffff', frameColor: '#efefe6' }, -27.8, 0, -61, Math.PI / 2);
  L.makeDecoy({ color: '#ffffff', frameColor: '#efefe6' }, 36.8, 0, -50, -Math.PI / 2);
  L.makeDoor({ color: '#9ee8d2', frameColor: '#f3f1e8', glow: '#f2fff6', style: 'panel' }, 0, DRY, FZ - 0.6, 0);

  // ---------------------------------------------------------------- gameplay
  const onIsland = (x, z) => Math.hypot(x, z - FZ) < 2.6;
  L.groundHeight = (x, z) => {
    if (x > MH.x0 && x < MH.x1) {
      if (z > -4) return DRY;
      if (z > -4.6) return 0.53;
      if (z > -5.2) return 0.27;
    }
    if (onIsland(x, z)) return DRY;
    return 0;
  };
  L.waterLevel = () => WL;
  L.surface = (x, z) => (L.groundHeight(x, z) > WL ? 'tile' : 'water');
  L.bounds = { type: 'box', x0: AREA.x0 + 0.4, x1: AREA.x1 - 0.4, z0: AREA.z0 + 0.4, z1: AREA.z1 - 0.4 };
  L.spawn = { x: 0, z: 2, yaw: 0, pitch: -0.08 };
  L.menuCam = { x: 1.2, z: -6, yaw: 0.05, y: 1.2, pitch: 0.02 };

  // reflections: capture once without the water, then add it
  L.envFromScene(new THREE.Vector3(0, 1.8, -40), 0.35);
  L.add(water);
  L.far = 260;
  return L;
}
