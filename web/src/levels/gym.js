import * as THREE from 'three';
import { LevelBase, floatingMotes } from './common.js';
import { woodFloorTexture, paintedWallTexture, glowTexture, canvasTexture, nrm, rep } from '../core/textures.js';
import { bx, cyl, mesh, std, boxCollider, circleCollider } from '../props/props.js';

const W = 13, D = 17, H = 10; // half width, half depth, height

function courtLinesTexture() {
  // 17 x 28 m court drawn at 40 px per metre
  const ppm = 40, cw = 17, cl = 28;
  return canvasTexture(cw * ppm, cl * ppm, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const X = (m) => (m + cw / 2) * ppm, Y = (m) => (m + cl / 2) * ppm;
    // painted keys
    ctx.fillStyle = 'rgba(196, 92, 40, 0.55)';
    ctx.fillRect(X(-2.45), Y(-14), 4.9 * ppm, 5.8 * ppm);
    ctx.fillRect(X(-2.45), Y(14 - 5.8), 4.9 * ppm, 5.8 * ppm);
    ctx.beginPath(); ctx.arc(X(0), Y(0), 1.8 * ppm, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(40, 24, 14, 0.9)';
    ctx.lineWidth = 0.06 * ppm;
    ctx.strokeRect(X(-8.4), Y(-13.9), 16.8 * ppm, 27.8 * ppm);
    ctx.beginPath(); ctx.moveTo(X(-8.4), Y(0)); ctx.lineTo(X(8.4), Y(0)); ctx.stroke();
    ctx.beginPath(); ctx.arc(X(0), Y(0), 1.8 * ppm, 0, Math.PI * 2); ctx.stroke();
    for (const s of [-1, 1]) {
      const base = s * 14;
      ctx.strokeRect(X(-2.45), s < 0 ? Y(-14) : Y(14 - 5.8), 4.9 * ppm, 5.8 * ppm);
      ctx.beginPath(); ctx.arc(X(0), Y(base - s * 5.8), 1.8 * ppm, 0, Math.PI * 2); ctx.stroke();
      // three point arc
      ctx.beginPath();
      const cy = Y(base - s * 1.575);
      if (s < 0) ctx.arc(X(0), cy, 6.75 * ppm, 0.15, Math.PI - 0.15);
      else ctx.arc(X(0), cy, 6.75 * ppm, Math.PI + 0.15, -0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(X(-6.6), Y(base)); ctx.lineTo(X(-6.6), Y(base - s * 2.6));
      ctx.moveTo(X(6.6), Y(base)); ctx.lineTo(X(6.6), Y(base - s * 2.6));
      ctx.stroke();
    }
  }, { wrap: false });
}

function scoreboardTexture() {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1b1a1c'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3a3a3e'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#f1e9d8'; ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center';
    ctx.fillText('СНОВИДЦЫ', w / 2, 46);
    ctx.font = 'bold 22px Arial';
    ctx.fillText('ДОМА', 70, 92); ctx.fillText('ГОСТИ', w - 70, 92);
    ctx.shadowColor = '#ff4020'; ctx.shadowBlur = 16; ctx.fillStyle = '#ff5030';
    ctx.font = 'bold 64px "Courier New", monospace';
    ctx.fillText('4', 70, 162); ctx.fillText('5', w - 70, 162);
    ctx.shadowColor = '#ffcc20'; ctx.fillStyle = '#ffd040';
    ctx.fillText('06:47', w / 2, 140);
    ctx.shadowColor = '#40ff60'; ctx.fillStyle = '#50ff70'; ctx.font = 'bold 40px "Courier New", monospace';
    ctx.fillText('0', 70, 222); ctx.fillText('0', w - 70, 222);
    ctx.shadowBlur = 0; ctx.fillStyle = '#f1e9d8'; ctx.font = 'bold 18px Arial';
    ctx.fillText('ПЕРИОД  1', w / 2, 200);
  }, { wrap: false });
}

function basketballTexture() {
  return canvasTexture(512, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#d8622a'); g.addColorStop(0.5, '#e8712f'); g.addColorStop(1, '#c85a24');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(90,30,10,${Math.random() * 0.25})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    ctx.strokeStyle = '#1e120c'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    for (const x of [w / 4, (3 * w) / 4]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) { const y = h / 2 + Math.sin((x / w) * Math.PI * 4) * h * 0.32; x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
  });
}

const shaftFrag = /* glsl */`
  uniform vec3 uColor; uniform float uTime, uStrength;
  varying vec2 vUv; varying vec3 vWPos;
  void main() {
    float along = vUv.y;
    float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
    float flick = 0.85 + 0.15 * sin(uTime * 0.6 + vWPos.x * 0.7 + vWPos.z * 0.4);
    float a = (0.35 + 0.65 * along) * edge * flick * uStrength;
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;
const shaftVert = /* glsl */`
  varying vec2 vUv; varying vec3 vWPos;
  void main() { vUv = uv; vWPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vWPos, 1.0); }`;

export function build(ctx, def) {
  const L = new LevelBase(ctx, def);
  const q = ctx.q;
  const toSun = new THREE.Vector3(-0.62, 0.72, 0.3).normalize();
  const ray = toSun.clone().negate();

  // ---------------------------------------------------------------- floor
  const woodTex = rep(woodFloorTexture(), 7, 7);
  const floorMat = new THREE.MeshStandardMaterial({
    map: woodTex, normalMap: nrm(woodTex), normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.32, metalness: 0.0,
  });
  const lines = courtLinesTexture();
  floorMat.onBeforeCompile = (sh) => {
    sh.uniforms.uLines = { value: lines };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosF;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPosF = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosF;\nuniform sampler2D uLines;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 luv = vec2((vWPosF.x + 8.5) / 17.0, 1.0 - (vWPosF.z + 14.0) / 28.0);
        if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) {
          vec4 ln = texture2D(uLines, luv);
          diffuseColor.rgb = mix(diffuseColor.rgb, ln.rgb, ln.a);
        }`);
  };
  floorMat.customProgramCacheKey = () => 'gymfloor';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  L.add(floor);

  // ---------------------------------------------------------------- walls with window openings
  const wallTex = rep(paintedWallTexture('#eadcc3', true, 'gymwall'), 6, 3);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, normalMap: nrm(wallTex), roughness: 0.85 });
  const trimMat = std('#c9a06a', 0.7);
  const padMat = std('#a8582c', 0.65);
  const T = 0.4;
  const walls = [];
  const winY0 = 5.4, winY1 = 8.6;
  const winZ = [-13, -7.5, -2, 3.5, 9];
  const winW = 4.0;
  // left wall (x = -W) with windows
  walls.push(bx(T, winY0, D * 2, -W - T / 2, winY0 / 2, 0));
  walls.push(bx(T, H - winY1, D * 2, -W - T / 2, (H + winY1) / 2, 0));
  let zc = -D;
  for (const z of winZ) {
    const a = z - winW / 2;
    walls.push(bx(T, winY1 - winY0, a - zc, -W - T / 2, (winY0 + winY1) / 2, (a + zc) / 2));
    zc = z + winW / 2;
  }
  walls.push(bx(T, winY1 - winY0, D - zc, -W - T / 2, (winY0 + winY1) / 2, (D + zc) / 2));
  // right wall: windows too (sun from the left so these just glow)
  walls.push(bx(T, winY0, D * 2, W + T / 2, winY0 / 2, 0));
  walls.push(bx(T, H - winY1, D * 2, W + T / 2, (H + winY1) / 2, 0));
  zc = -D;
  for (const z of winZ) {
    const a = z - winW / 2;
    walls.push(bx(T, winY1 - winY0, a - zc, W + T / 2, (winY0 + winY1) / 2, (a + zc) / 2));
    zc = z + winW / 2;
  }
  walls.push(bx(T, winY1 - winY0, D - zc, W + T / 2, (winY0 + winY1) / 2, (D + zc) / 2));
  // end walls
  walls.push(bx(W * 2 + T * 2, H, T, 0, H / 2, -D - T / 2));
  walls.push(bx(W * 2 + T * 2, H, T, 0, H / 2, D + T / 2));
  const wallMesh = mesh(walls, wallMat);
  L.add(wallMesh);
  // ceiling
  const ceil = mesh([bx(W * 2 + 1, 0.3, D * 2 + 1, 0, H + 0.15, 0)], std('#efe6d6', 0.9));
  L.add(ceil);
  // beams
  const beams = [];
  for (let z = -D + 3; z < D; z += 5) beams.push(bx(W * 2, 0.5, 0.35, 0, H - 0.25, z));
  beams.push(bx(0.4, 0.6, D * 2, -W + 3, H - 0.3, 0), bx(0.4, 0.6, D * 2, W - 3, H - 0.3, 0));
  L.add(mesh(beams, std('#f2ead8', 0.7)));
  // wainscot stripe and pads
  const stripe = [bx(0.05, 0.12, D * 2, -W + 0.02, 2.35, 0), bx(0.05, 0.12, D * 2, W - 0.02, 2.35, 0),
    bx(W * 2, 0.12, 0.05, 0, 2.35, -D + 0.02), bx(W * 2, 0.12, 0.05, 0, 2.35, D - 0.02)];
  L.add(mesh(stripe, trimMat));
  const lower = [bx(0.04, 2.3, D * 2, -W + 0.02, 1.15, 0), bx(0.04, 2.3, D * 2, W - 0.02, 1.15, 0),
    bx(W * 2, 2.3, 0.04, 0, 1.15, -D + 0.02), bx(W * 2, 2.3, 0.04, 0, 1.15, D - 0.02)];
  L.add(mesh(lower, std('#d9b98a', 0.75)));
  const pads = [];
  for (let i = 0; i < 6; i++) pads.push(bx(1.2, 2.0, 0.12, -W + 1.2 + i * 1.25, 1.05, -D + 0.1));
  for (let i = 0; i < 7; i++) pads.push(bx(1.2, 2.0, 0.12, -1.5 - i * 1.25 + 0.0, 1.05, D - 0.1));
  for (let i = 0; i < 8; i++) pads.push(bx(0.12, 2.0, 1.2, W - 0.1, 1.05, -6 + i * 1.25));
  L.add(mesh(pads, padMat));

  // windows: bright panes + mullions
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2d4').multiplyScalar(3.2), fog: false });
  const glow2 = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe8c8').multiplyScalar(1.7), fog: false });
  const panes = [], panes2 = [], mull = [];
  for (const z of winZ) {
    panes.push(bx(0.02, winY1 - winY0, winW, -W - T - 0.05, (winY0 + winY1) / 2, z));
    panes2.push(bx(0.02, winY1 - winY0, winW, W + T + 0.05, (winY0 + winY1) / 2, z));
    for (const sx of [-1, 1]) {
      const x = sx * (W + T / 2);
      mull.push(bx(T + 0.04, 0.12, winW, x, (winY0 + winY1) / 2, z));
      for (const k of [-1, 0, 1]) mull.push(bx(T + 0.04, winY1 - winY0, 0.1, x, (winY0 + winY1) / 2, z + k * winW / 3));
      mull.push(bx(T + 0.1, 0.12, winW + 0.2, x, winY0 - 0.04, z));
    }
  }
  L.add(mesh(panes, glow, { cast: false }));
  L.add(mesh(panes2, glow2, { cast: false }));
  L.add(mesh(mull, std('#f4efe6', 0.5)));

  // ---------------------------------------------------------------- light
  const hemi = L.setupHemi('#ffe2b8', '#a86a3a', 0.55);
  const sun = new THREE.DirectionalLight('#ffd59a', q.shadows ? 7.5 : 1.2);
  sun.position.copy(toSun).multiplyScalar(40);
  sun.target.position.set(0, 0, 0);
  if (q.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const c = sun.shadow.camera;
    c.left = -26; c.right = 26; c.top = 26; c.bottom = -26; c.near = 5; c.far = 90;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
  }
  L.add(sun);
  L.add(sun.target);
  L.setupFogExp('#e9c99a', 0.0042);

  // light shafts + floor patches (patches only when no real shadows)
  const shaftU = { uColor: { value: new THREE.Color('#ffdcaa') }, uTime: { value: 0 }, uStrength: { value: 0.11 } };
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: shaftU, vertexShader: shaftVert, fragmentShader: shaftFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const patchMat = new THREE.MeshBasicMaterial({ color: '#ffcf8a', transparent: true, opacity: q.shadows ? 0.0 : 0.35, blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture() });
  const proj = (p) => {
    const t = p.y / -ray.y;
    return new THREE.Vector3(p.x + ray.x * t, 0.01, p.z + ray.z * t);
  };
  for (const z of winZ) {
    const a = new THREE.Vector3(-W, winY1, z - winW / 2), b = new THREE.Vector3(-W, winY1, z + winW / 2);
    const c = new THREE.Vector3(-W, winY0, z + winW / 2), d = new THREE.Vector3(-W, winY0, z - winW / 2);
    const A = proj(a), B = proj(b), C = proj(c), Dd = proj(d);
    // two crossing sheets per window make a convincing volume
    const sheet = (p0, p1, P1, P0) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...p0.toArray(), ...p1.toArray(), ...P1.toArray(), ...P0.toArray()], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new THREE.Mesh(g, shaftMat);
      m.renderOrder = 5;
      L.add(m);
    };
    const mid0 = a.clone().lerp(d, 0.5), mid1 = b.clone().lerp(c, 0.5);
    sheet(mid0, mid1, B.clone().lerp(C, 0.5), A.clone().lerp(Dd, 0.5));
    sheet(a.clone().lerp(b, 0.5), d.clone().lerp(c, 0.5), Dd.clone().lerp(C, 0.5), A.clone().lerp(B, 0.5));
    if (!q.shadows) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...A.toArray(), ...B.toArray(), ...C.toArray(), ...Dd.toArray()], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      L.add(new THREE.Mesh(g, patchMat));
    }
  }
  L.onUpdate((dt) => { shaftU.uTime.value += dt; });

  // ---------------------------------------------------------------- hanging lamps & speakers
  const lampMat = std('#e8e2d6', 0.4, 0.3);
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1d0').multiplyScalar(2.2) });
  const lamps = [], bulbs = [], cords = [];
  for (const x of [-7, 0, 7]) {
    for (const z of [-11, -4, 3, 10]) {
      if (x === 0 && Math.abs(z) < 5) continue;
      lamps.push(new THREE.ConeGeometry(0.35, 0.4, 14, 1, true).translate(x, 7.6, z));
      bulbs.push(new THREE.SphereGeometry(0.12, 10, 8).translate(x, 7.42, z));
      cords.push(cyl(0.01, 0.01, H - 7.8, x, (H + 7.8) / 2, z, 4));
    }
  }
  L.add(mesh(lamps, new THREE.MeshStandardMaterial({ color: '#e8e2d6', roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }), { cast: false }));
  L.add(mesh(bulbs, bulbMat, { cast: false }));
  L.add(mesh(cords, std('#333', 0.6), { cast: false }));
  const spk = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const g = new THREE.BoxGeometry(0.7, 1.0, 0.6);
    g.rotateX(0.35);
    g.rotateY(a);
    g.translate(Math.sin(a) * 0.55, 8.3, Math.cos(a) * 0.55);
    spk.push(g);
  }
  spk.push(new THREE.TorusGeometry(0.9, 0.04, 6, 24).rotateX(Math.PI / 2).translate(0, 8.9, 0), cyl(0.03, 0.03, 1.2, 0, 9.4, 0, 6));
  L.add(mesh(spk, std('#1c1c1f', 0.6, 0.2)));

  // ---------------------------------------------------------------- hoops
  const boardMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.35 });
  const rimMat = std('#e2551c', 0.4, 0.6);
  const poleMat = std('#2a2a2e', 0.5, 0.6);
  for (const s of [-1, 1]) {
    const z = s * 12.8;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, 0.04), boardMat);
    board.position.set(0, 3.55, z);
    L.add(board);
    const frame = [bx(1.8, 0.05, 0.06, 0, 4.08, z), bx(1.8, 0.05, 0.06, 0, 3.03, z), bx(0.05, 1.05, 0.06, -0.9, 3.55, z), bx(0.05, 1.05, 0.06, 0.9, 3.55, z),
      bx(0.59, 0.03, 0.05, 0, 3.47, z - s * 0.01), bx(0.59, 0.03, 0.05, 0, 3.15, z - s * 0.01), bx(0.03, 0.35, 0.05, -0.3, 3.31, z - s * 0.01), bx(0.03, 0.35, 0.05, 0.3, 3.31, z - s * 0.01)];
    L.add(mesh(frame, std('#f4f4f4', 0.4)));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.012, 8, 24), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 3.05, z - s * 0.32);
    rim.castShadow = true;
    L.add(rim);
    // net
    const netPts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const a2 = a + 0.4;
      netPts.push(new THREE.Vector3(Math.cos(a) * 0.23, 0, Math.sin(a) * 0.23), new THREE.Vector3(Math.cos(a2) * 0.15, -0.42, Math.sin(a2) * 0.15));
    }
    const net = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(netPts), new THREE.LineBasicMaterial({ color: '#f8f8f8' }));
    net.position.copy(rim.position);
    L.add(net);
    L.add(mesh([bx(0.12, H - 4.1, 0.12, 0, (H + 4.1) / 2, z + s * 0.25), bx(0.1, 0.1, 2.4, 0, 4.3, z + s * 1.3)], poleMat));
  }

  // scoreboard
  const sb = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.7, 0.25), [
    std('#222'), std('#222'), std('#222'), std('#222'),
    new THREE.MeshStandardMaterial({ map: scoreboardTexture(), emissive: '#ffffff', emissiveMap: scoreboardTexture(), emissiveIntensity: 1.1, roughness: 0.5 }),
    std('#222'),
  ]);
  sb.position.set(0, 6.4, -D + 0.2);
  L.add(sb);

  // ---------------------------------------------------------------- props
  const chairMat = std('#4a4a52', 0.5, 0.6);
  const chairs = [];
  for (let i = 0; i < 6; i++) {
    const x = -W + 2.2 + i * 0.75, z = -D + 2.2 + (i % 2) * 0.1;
    chairs.push(bx(0.45, 0.04, 0.45, x, 0.46, z), bx(0.45, 0.45, 0.04, x, 0.72, z - 0.21),
      bx(0.03, 0.46, 0.03, x - 0.2, 0.23, z + 0.2), bx(0.03, 0.46, 0.03, x + 0.2, 0.23, z + 0.2),
      bx(0.03, 0.95, 0.03, x - 0.2, 0.47, z - 0.22), bx(0.03, 0.95, 0.03, x + 0.2, 0.47, z - 0.22));
  }
  L.add(mesh(chairs, chairMat));
  L.collide(boxCollider(-W + 4.1, -D + 2.2, 4.6, 0.7));
  const table = [bx(2.0, 0.05, 0.8, -W + 6.8, 0.76, -D + 1.4), bx(0.04, 0.76, 0.04, -W + 5.9, 0.38, -D + 1.1), bx(0.04, 0.76, 0.04, -W + 7.7, 0.38, -D + 1.1),
    bx(0.04, 0.76, 0.04, -W + 5.9, 0.38, -D + 1.7), bx(0.04, 0.76, 0.04, -W + 7.7, 0.38, -D + 1.7)];
  L.add(mesh(table, std('#e8e4dc', 0.5, 0.3)));
  L.collide(boxCollider(-W + 6.8, -D + 1.4, 2.1, 0.9));
  // folded bleachers on the right wall
  const bl = [];
  for (let i = 0; i < 5; i++) bl.push(bx(0.35, 1.9 - i * 0.05, 9, W - 0.4 - i * 0.36, (1.9 - i * 0.05) / 2, 10.5));
  L.add(mesh(bl, std('#9c6a3c', 0.6)));
  L.collide(boxCollider(W - 1.2, 10.5, 2.0, 9.2));
  // ball rack
  const rack = [bx(1.6, 0.04, 0.5, -W + 1.0, 0.5, 6), bx(1.6, 0.04, 0.5, -W + 1.0, 1.0, 6),
    bx(0.04, 1.1, 0.04, -W + 0.2, 0.55, 5.75), bx(0.04, 1.1, 0.04, -W + 1.8, 0.55, 5.75), bx(0.04, 1.1, 0.04, -W + 0.2, 0.55, 6.25), bx(0.04, 1.1, 0.04, -W + 1.8, 0.55, 6.25)];
  L.add(mesh(rack, std('#b8b8b8', 0.3, 0.8)));
  L.collide(boxCollider(-W + 1.0, 6, 1.7, 0.6));
  const ballTex = basketballTexture();
  const ballMat = new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.75 });
  const ballGeo = new THREE.SphereGeometry(0.12, 24, 16);
  const balls = [[-W + 0.5, 0.65, 6], [-W + 0.85, 0.65, 6.05], [-W + 1.2, 0.65, 5.95], [-W + 0.6, 1.15, 6], [-W + 1.35, 1.15, 6], [2.2, 0.12, 12.6]];
  for (const [x, y, z] of balls) {
    const b = new THREE.Mesh(ballGeo, ballMat);
    b.position.set(x, y, z);
    b.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    b.castShadow = true;
    L.add(b);
  }
  L.collide(circleCollider(2.2, 12.6, 0.15));

  // exit sign
  const exitTex = canvasTexture(256, 96, (c, w, h) => {
    c.fillStyle = '#0e2a14'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#5dff7a'; c.font = 'bold 54px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#5dff7a'; c.shadowBlur = 14; c.fillText('ВЫХОД', w / 2, h / 2 + 2);
  }, { wrap: false });
  const exitSign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.34, 0.12), new THREE.MeshBasicMaterial({ map: exitTex, color: new THREE.Color(2.2, 2.2, 2.2) }));
  exitSign.position.set(9, 2.85, -D + 0.08);
  L.add(exitSign);

  // decoy: locker room door
  L.makeDecoy({ color: '#b86a3e', frameColor: '#7a5a42', style: 'glass' }, W - 0.12, 0, -10, -Math.PI / 2);
  L.makeDecoy({ color: '#b86a3e', frameColor: '#7a5a42', style: 'glass' }, -6, 0, D - 0.12, Math.PI);
  // the real exit
  L.makeDoor({ color: '#c87a46', frameColor: '#8a6a50', glow: '#fff0c8', style: 'glass', width: 1.1 }, 9, 0, -D + 0.14, 0);

  // dust in the sunbeams
  const motes = floatingMotes(Math.round(380 * q.particles), { color: '#ffe6b8', size: 0.045, area: 12, height: 8.5, speed: 0.08, opacity: 0.9, tex: glowTexture() });
  L.add(motes);
  L.onUpdate((dt, t, player) => motes.userData.update(t, player.pos, 0.2));

  L.colliders.push(
    boxCollider(0, 12.8 + 0.25, 0.3, 0.3), boxCollider(0, -12.8 - 0.25, 0.3, 0.3),
  );
  L.bounds = { type: 'box', x0: -W + 0.2, x1: W - 0.2, z0: -D + 0.2, z1: D - 0.2 };
  L.surface = () => 'wood';
  L.spawn = { x: 3.2, z: 13.5, yaw: 0.12, pitch: -0.06 };
  L.menuCam = { x: 3.0, z: 13.5, yaw: 0.1, y: 1.0, pitch: 0.12 };

  // reflections: capture the finished room once
  L.envFromScene(new THREE.Vector3(0, 3, 4), 0.9);
  L.far = 120;
  return L;
}
