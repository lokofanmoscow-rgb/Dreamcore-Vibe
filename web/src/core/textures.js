import * as THREE from 'three';
import { makeTileNoise, mulberry32 } from './noise.js';

// Procedural canvas textures. Everything is generated on the device, so the
// APK stays tiny and every level can have its own palette.

const cache = new Map();
const cachedSet = new WeakSet();
const normals = new WeakMap();

// normal map generated alongside a colour texture
export function nrm(t) { return normals.get(t) || null; }
export function isCached(t) { return cachedSet.has(t); }

// clone a cached texture with its own repeat
export function rep(t, rx, ry = rx) {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  const n = normals.get(t);
  if (n) {
    const nc = n.clone();
    nc.repeat.set(rx, ry);
    nc.needsUpdate = true;
    normals.set(c, nc);
  }
  return c;
}
let maxAniso = 4;
export function setMaxAnisotropy(a) { maxAniso = a; }

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = [1, 1], wrap = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = maxAniso;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function cached(key, fn) {
  if (!cache.has(key)) {
    const v = fn();
    cache.set(key, v);
    if (v && v.isTexture) {
      cachedSet.add(v);
      const n = normals.get(v);
      if (n) cachedSet.add(n);
    }
  }
  return cache.get(key);
}

function hexToRgb(hex) {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}

// Generic per-pixel painter with tileable fbm helpers.
function paint(size, seed, fn, height = size) {
  const c = canvas(size, height);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, height);
  const d = img.data;
  const n = [8, 16, 32, 64, 128].map((p, i) => makeTileNoise(seed * 31 + i, p));
  const fbm = (u, v, oct = 5, base = 0) => {
    let s = 0, a = 0.5, norm = 0;
    for (let i = base; i < Math.min(n.length, base + oct); i++) {
      const p = [8, 16, 32, 64, 128][i];
      s += n[i](u * p, v * p) * a; norm += a; a *= 0.5;
    }
    return s / norm;
  };
  const out = [0, 0, 0, 255];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < size; x++) {
      fn(x / size, y / height, fbm, out, x, y);
      const i = (y * size + x) * 4;
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, ctx, img };
}

// Height (0..1 array) -> tangent space normal map canvas
function normalFromHeight(hgt, w, h, strength = 2) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => hgt[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------- ground
export function grassGroundTexture() {
  return cached('grassGround', () => {
    const { canvas: c } = paint(512, 3, (u, v, fbm, o) => {
      const n = fbm(u, v, 5);
      const m = fbm(u + 0.3, v + 0.7, 3, 2);
      const r = mix(38, 76, n) + m * 16;
      const g = mix(88, 140, n) + m * 22;
      const b = mix(22, 40, n);
      o[0] = r; o[1] = g; o[2] = b; o[3] = 255;
    });
    // little blade strokes
    const ctx = c.getContext('2d');
    const rnd = mulberry32(5);
    for (let i = 0; i < 5000; i++) {
      const x = rnd() * 512, y = rnd() * 512;
      const l = 3 + rnd() * 7;
      ctx.strokeStyle = `rgba(${90 + rnd() * 70},${140 + rnd() * 60},${30 + rnd() * 40},${0.25 + rnd() * 0.35})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 3, y - l); ctx.stroke();
    }
    return toTexture(c);
  });
}

export function dirtTexture(tint = '#c99a6b') {
  return cached('dirt' + tint, () => {
    const [tr, tg, tb] = hexToRgb(tint);
    const hgt = new Float32Array(512 * 512);
    const { canvas: c } = paint(512, 7, (u, v, fbm, o, x, y) => {
      const n = fbm(u, v, 5);
      const p = fbm(u * 2.0 % 1, v * 2.0 % 1, 2, 3);
      const pebble = p > 0.68 ? (p - 0.68) * 3 : 0;
      const k = 0.78 + n * 0.35 + pebble * 0.4;
      o[0] = clamp01(tr / 255 * k) * 255; o[1] = clamp01(tg / 255 * k) * 255; o[2] = clamp01(tb / 255 * k) * 255; o[3] = 255;
      hgt[y * 512 + x] = n * 0.6 + pebble;
    });
    const t = toTexture(c);
    normals.set(t, toTexture(normalFromHeight(hgt, 512, 512, 3), { srgb: false }));
    return t;
  });
}

export function asphaltTexture() {
  return cached('asphalt', () => {
    const hgt = new Float32Array(512 * 512);
    const rnd = mulberry32(9);
    const { canvas: c } = paint(512, 11, (u, v, fbm, o, x, y) => {
      const n = fbm(u, v, 5);
      const speck = rnd();
      let k = 70 + n * 45;
      if (speck > 0.985) k += 50; else if (speck < 0.02) k -= 25;
      o[0] = k * 1.02; o[1] = k * 0.97; o[2] = k * 0.95; o[3] = 255;
      hgt[y * 512 + x] = n + (speck > 0.97 ? 0.3 : 0);
    });
    const t = toTexture(c);
    normals.set(t, toTexture(normalFromHeight(hgt, 512, 512, 2.5), { srgb: false }));
    return t;
  });
}

export function concreteTexture(tint = '#d9d4c8') {
  return cached('concrete' + tint, () => {
    const [tr, tg, tb] = hexToRgb(tint);
    const { canvas: c } = paint(512, 13, (u, v, fbm, o) => {
      const n = fbm(u, v, 5);
      const k = 0.85 + n * 0.25;
      o[0] = tr * k; o[1] = tg * k; o[2] = tb * k; o[3] = 255;
    });
    return toTexture(c);
  });
}

// --------------------------------------------------------------- interiors
export function woodFloorTexture() {
  return cached('woodFloor', () => {
    const W = 1024, H = 1024;
    const hgt = new Float32Array(W * H);
    const rnd = mulberry32(21);
    const plankW = 1024 / 16; // 16 planks across the texture
    const offsets = [];
    for (let i = 0; i < 16; i++) offsets.push([rnd(), 0.8 + rnd() * 0.35, rnd() * 0.25]);
    const { canvas: c } = paint(W, 23, (u, v, fbm, o, x, y) => {
      const pi = Math.floor(x / plankW);
      const [off, tone, len] = offsets[pi];
      const vv = (v + off) % 1;
      const seg = Math.floor(vv * 3 + len * 3);
      const segTone = 0.92 + ((seg * 7919 + pi * 104729) % 97) / 97 * 0.16;
      const grain = fbm((u * 0.2 + pi * 0.37) % 1, (vv * 6) % 1, 4) ;
      const streak = Math.sin((x * 0.9 + grain * 40) * 0.6) * 0.5 + 0.5;
      const k = tone * segTone * (0.88 + grain * 0.16 + streak * 0.05);
      o[0] = clamp01(0.86 * k) * 255;
      o[1] = clamp01(0.6 * k) * 255;
      o[2] = clamp01(0.36 * k) * 255;
      o[3] = 255;
      const edge = (x % plankW) < 1.5 || ((vv * 3 + len * 3) % 1) < 0.004 ? 1 : 0;
      if (edge) { o[0] *= 0.6; o[1] *= 0.55; o[2] *= 0.5; }
      hgt[y * W + x] = edge ? 0 : 0.5 + grain * 0.1;
    }, H);
    const t = toTexture(c);
    normals.set(t, toTexture(normalFromHeight(hgt, W, H, 1.5), { srgb: false }));
    return t;
  });
}

export function tileTexture(color = '#f4fbff', grout = '#b8cdd6', count = 8, key = 'tile', groutFrac = 0.06, S = 512) {
  return cached(key + color + grout + count + groutFrac + S, () => {
    const [cr, cg, cb] = hexToRgb(color);
    const [gr, gg, gb] = hexToRgb(grout);
    const hgt = new Float32Array(S * S);
    const rnd = mulberry32(33);
    const tones = [];
    for (let i = 0; i < count * count; i++) tones.push(0.95 + rnd() * 0.07);
    const cell = S / count;
    const gw = Math.max(1.2, cell * groutFrac);
    const { canvas: c } = paint(S, 35, (u, v, fbm, o, x, y) => {
      const cx = x % cell, cy = y % cell;
      const ti = Math.floor(y / cell) * count + Math.floor(x / cell);
      const dEdge = Math.min(cx, cy, cell - cx, cell - cy);
      const n = fbm(u, v, 3, 2);
      if (dEdge < gw) {
        o[0] = gr * (0.95 + n * 0.1); o[1] = gg * (0.95 + n * 0.1); o[2] = gb * (0.95 + n * 0.1);
        hgt[y * S + x] = 0;
      } else {
        const k = tones[ti] * (0.97 + n * 0.05);
        o[0] = Math.min(255, cr * k); o[1] = Math.min(255, cg * k); o[2] = Math.min(255, cb * k);
        const bevel = Math.min(1, (dEdge - gw) / (gw * 1.5));
        hgt[y * S + x] = 0.4 + bevel * 0.6;
      }
      o[3] = 255;
    });
    const t = toTexture(c);
    normals.set(t, toTexture(normalFromHeight(hgt, S, S, 2.5), { srgb: false }));
    return t;
  });
}

export function paintedWallTexture(color = '#efe6d2', blocks = true, key = 'wall') {
  return cached(key + color + blocks, () => {
    const S = 512;
    const [cr, cg, cb] = hexToRgb(color);
    const hgt = new Float32Array(S * S);
    const bw = S / 4, bh = S / 8;
    const { canvas: c } = paint(S, 41, (u, v, fbm, o, x, y) => {
      const n = fbm(u, v, 4, 1);
      let k = 0.94 + n * 0.08;
      let hh = 0.5 + n * 0.05;
      if (blocks) {
        const row = Math.floor(y / bh);
        const xx = (x + (row % 2) * bw * 0.5) % bw;
        const yy = y % bh;
        if (xx < 2 || yy < 2) { k *= 0.86; hh = 0.2; }
      }
      o[0] = cr * k; o[1] = cg * k; o[2] = cb * k; o[3] = 255;
      hgt[y * S + x] = hh;
    });
    const t = toTexture(c);
    normals.set(t, toTexture(normalFromHeight(hgt, S, S, 1.5), { srgb: false }));
    return t;
  });
}

export function sidingTexture(color = '#e9d8b8') {
  return cached('siding' + color, () => {
    const S = 256;
    const [cr, cg, cb] = hexToRgb(color);
    const hgt = new Float32Array(S * S);
    const rows = 12;
    const { canvas: c } = paint(S, 51, (u, v, fbm, o, x, y) => {
      const n = fbm(u, v, 3, 2);
      const t = (v * rows) % 1;
      const shade = 0.82 + t * 0.2;
      const k = shade * (0.96 + n * 0.06);
      o[0] = Math.min(255, cr * k); o[1] = Math.min(255, cg * k); o[2] = Math.min(255, cb * k); o[3] = 255;
      hgt[y * S + x] = t;
    });
    const t = toTexture(c);
    normals.set(t, toTexture(normalFromHeight(hgt, S, S, 0.6), { srgb: false }));
    return t;
  });
}

export function roofTexture(color = '#7a2f25') {
  return cached('roof' + color, () => {
    const S = 256;
    const [cr, cg, cb] = hexToRgb(color);
    const hgt = new Float32Array(S * S);
    const rows = 10, cols = 8;
    const { canvas: c } = paint(S, 61, (u, v, fbm, o, x, y) => {
      const n = fbm(u, v, 4, 1);
      const row = Math.floor(v * rows);
      const t = (v * rows) % 1;
      const cu = (u * cols + (row % 2) * 0.5) % 1;
      const gap = cu < 0.04 ? 0.7 : 1;
      const k = (0.75 + t * 0.3) * gap * (0.9 + n * 0.18);
      o[0] = Math.min(255, cr * k); o[1] = Math.min(255, cg * k); o[2] = Math.min(255, cb * k); o[3] = 255;
      hgt[y * S + x] = t * gap;
    });
    const t = toTexture(c);
    normals.set(t, toTexture(normalFromHeight(hgt, S, S, 1.2), { srgb: false }));
    return t;
  });
}

export function leafyTexture(base = '#3f7a35', key = 'leafy') {
  return cached(key + base, () => {
    const S = 256;
    const [cr, cg, cb] = hexToRgb(base);
    const hgt = new Float32Array(S * S);
    const { canvas: c } = paint(S, 71, (u, v, fbm, o, x, y) => {
      const n = fbm(u, v, 5, 1);
      const cell = fbm(u, v, 2, 3);
      const k = 0.8 + n * 0.55 + (cell > 0.6 ? 0.12 : 0);
      o[0] = Math.min(255, cr * k); o[1] = Math.min(255, cg * k); o[2] = Math.min(255, cb * k); o[3] = 255;
      hgt[y * S + x] = n;
    });
    const t = toTexture(c);
    normals.set(t, toTexture(normalFromHeight(hgt, S, S, 1.6), { srgb: false }));
    return t;
  });
}

export function rubberTexture(a = '#ff8fb8', b = '#7fe0d0', key = 'rubber') {
  return cached(key + a + b, () => {
    const S = 512;
    const A = hexToRgb(a), B = hexToRgb(b);
    const rnd = mulberry32(81);
    const count = 4, cell = S / count;
    const { canvas: c } = paint(S, 83, (u, v, fbm, o, x, y) => {
      const ti = (Math.floor(x / cell) + Math.floor(y / cell)) % 2;
      const col = ti ? A : B;
      const sp = rnd();
      const k = 0.92 + (sp > 0.6 ? 0.08 : 0) - (sp < 0.15 ? 0.06 : 0);
      const edge = Math.min(x % cell, y % cell) < 2 ? 0.8 : 1;
      o[0] = Math.min(255, col[0] * k * edge); o[1] = Math.min(255, col[1] * k * edge); o[2] = Math.min(255, col[2] * k * edge); o[3] = 255;
    });
    return toTexture(c);
  });
}

// --------------------------------------------------------------- plants
export function sunflowerHeadTexture() {
  return cached('sunflowerHead', () => {
    const S = 512;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const cx = S / 2, cy = S / 2;
    const rnd = mulberry32(91);
    // petals (two layers)
    for (let layer = 0; layer < 2; layer++) {
      const nP = layer ? 21 : 23;
      for (let i = 0; i < nP; i++) {
        const a = (i / nP) * Math.PI * 2 + layer * 0.14 + rnd() * 0.05;
        const len = S * (layer ? 0.43 : 0.47) * (0.92 + rnd() * 0.1);
        const wid = S * 0.075 * (0.85 + rnd() * 0.3);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        const grad = ctx.createLinearGradient(0, 0, len, 0);
        const hue = 42 + rnd() * 6;
        grad.addColorStop(0.0, `hsl(${hue - 14}, 95%, ${layer ? 36 : 32}%)`);
        grad.addColorStop(0.35, `hsl(${hue - 4}, 100%, ${layer ? 49 : 45}%)`);
        grad.addColorStop(1.0, `hsl(${hue}, 100%, ${layer ? 56 : 52}%)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(S * 0.12, 0);
        ctx.bezierCurveTo(len * 0.45, -wid, len * 0.85, -wid * 0.7, len, 0);
        ctx.bezierCurveTo(len * 0.85, wid * 0.7, len * 0.45, wid, S * 0.12, 0);
        ctx.fill();
        ctx.strokeStyle = `hsla(${hue - 8}, 90%, 40%, 0.35)`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(S * 0.14, 0); ctx.lineTo(len * 0.95, 0); ctx.stroke();
        ctx.restore();
      }
    }
    // disc
    const R = S * 0.2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, '#3a1f0c');
    g.addColorStop(0.55, '#5a3214');
    g.addColorStop(0.85, '#7a4a1a');
    g.addColorStop(1, '#a8661e');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    // seeds (phyllotaxis)
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < 650; i++) {
      const r = Math.sqrt(i / 650) * R * 0.96;
      const a = i * golden;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      ctx.fillStyle = `rgba(${30 + rnd() * 40},${15 + rnd() * 20},${5},0.7)`;
      ctx.beginPath(); ctx.arc(x, y, 2.2 * (0.6 + r / R * 0.6), 0, Math.PI * 2); ctx.fill();
    }
    return toTexture(c, { wrap: false });
  });
}

export function leafTexture(color = '#4f8a3a', key = 'leaf') {
  return cached(key + color, () => {
    const S = 256;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const col = new THREE.Color(color);
    const grad = ctx.createLinearGradient(0, S, 0, 0);
    grad.addColorStop(0, `rgb(${col.r * 200},${col.g * 220},${col.b * 200})`);
    grad.addColorStop(1, `rgb(${col.r * 255},${col.g * 255},${col.b * 255})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(S / 2, S * 0.98);
    ctx.bezierCurveTo(S * 0.02, S * 0.7, S * 0.08, S * 0.2, S / 2, S * 0.02);
    ctx.bezierCurveTo(S * 0.92, S * 0.2, S * 0.98, S * 0.7, S / 2, S * 0.98);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,255,200,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(S / 2, S * 0.98); ctx.lineTo(S / 2, S * 0.08); ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let i = 1; i < 7; i++) {
      const y = S * (0.9 - i * 0.12);
      ctx.beginPath(); ctx.moveTo(S / 2, y); ctx.quadraticCurveTo(S * 0.35, y - 10, S * 0.18, y - 30); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S / 2, y); ctx.quadraticCurveTo(S * 0.65, y - 10, S * 0.82, y - 30); ctx.stroke();
    }
    return toTexture(c, { wrap: false });
  });
}

export function flowerSpriteTexture(petal = '#ffffff', center = '#ffd23a', key = 'flower') {
  return cached(key + petal + center, () => {
    const S = 128;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.translate(S / 2, S / 2);
    ctx.fillStyle = petal;
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath(); ctx.ellipse(0, -S * 0.24, S * 0.12, S * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = center;
    ctx.beginPath(); ctx.arc(0, 0, S * 0.12, 0, Math.PI * 2); ctx.fill();
    return toTexture(c, { wrap: false });
  });
}

// --------------------------------------------------------------- fx
export function glowTexture(key = 'glow') {
  return cached(key, () => {
    const S = 128;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return toTexture(c, { wrap: false, srgb: false });
  });
}

export function textTexture(lines, opts = {}) {
  const {
    width = 512, height = 256, bg = '#2d3b2a', fg = '#f4ecd2', font = 'bold 64px Georgia, serif',
    border = '#c9b98f', borderWidth = 10, radius = 26, glow = null, align = 'center', key = null,
  } = opts;
  const build = () => {
    const c = canvas(width, height);
    const ctx = c.getContext('2d');
    if (bg) {
      ctx.fillStyle = bg;
      roundRect(ctx, borderWidth / 2, borderWidth / 2, width - borderWidth, height - borderWidth, radius);
      ctx.fill();
      if (border) {
        ctx.lineWidth = borderWidth;
        ctx.strokeStyle = border;
        ctx.stroke();
      }
    }
    ctx.fillStyle = fg;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 18; }
    const list = Array.isArray(lines) ? lines : [lines];
    const lh = height / (list.length + 1);
    list.forEach((l, i) => ctx.fillText(l, align === 'center' ? width / 2 : 24, lh * (i + 1)));
    return toTexture(c, { wrap: false });
  };
  return key ? cached('text' + key, build) : build();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function canvasTexture(w, h, draw, opts = {}) {
  const c = canvas(w, h);
  draw(c.getContext('2d'), w, h);
  return toTexture(c, opts);
}

export function noiseDataTexture(size = 128, seed = 5) {
  return cached('noiseData' + size + seed, () => {
    const { canvas: c } = paint(size, seed, (u, v, fbm, o) => {
      o[0] = fbm(u, v, 4) * 255; o[1] = fbm(u + 0.5, v + 0.3, 4) * 255; o[2] = fbm(u + 0.2, v + 0.8, 3, 1) * 255; o[3] = 255;
    });
    return toTexture(c, { srgb: false });
  });
}

export function disposeTextureCache() {
  for (const t of cache.values()) {
    if (t && t.dispose) {
      const n = normals.get(t);
      if (n) n.dispose();
      t.dispose();
    }
  }
  cache.clear();
}

export function waterNormalTexture() {
  return cached('waterNormal', () => {
    const S = 256;
    const hgt = new Float32Array(S * S);
    paint(S, 101, (u, v, fbm, o, x, y) => {
      hgt[y * S + x] = fbm(u, v, 4, 0) * 0.7 + fbm(u, v, 2, 2) * 0.3;
      o[0] = o[1] = o[2] = 0; o[3] = 255;
    });
    return toTexture(normalFromHeight(hgt, S, S, 6), { srgb: false });
  });
}
