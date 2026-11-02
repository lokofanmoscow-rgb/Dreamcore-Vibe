import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSky } from '../core/sky.js';
import { isCached } from '../core/textures.js';
import { Door } from '../props/door.js';

// Shared scaffolding for levels: sky, sun with player-following shadows,
// hemisphere fill, fog and image based lighting.
export class LevelBase {
  constructor(ctx, def) {
    this.ctx = ctx;
    this.def = def;
    this.scene = new THREE.Scene();
    this.colliders = [];
    this.updaters = [];
    this.bounds = null;
    this.spawn = { x: 0, z: 0, yaw: 0 };
    this.menuCam = null;
    this.door = null;
    this.decoys = [];
    this.music = def.music;
    this.ambience = def.ambience;
    this.grade = def.grade || {};
    this.time = 0;
    this.envTarget = null;
    this.surfaceDefault = 'grass';
  }

  groundHeight() { return 0; }
  surface() { return this.surfaceDefault; }

  add(obj) { this.scene.add(obj); return obj; }
  collide(...cs) { for (const c of cs.flat()) this.colliders.push(c); }
  onUpdate(fn) { this.updaters.push(fn); }

  setupSky(skyOpts) {
    this.sky = createSky(skyOpts);
    this.scene.add(this.sky);
    return this.sky;
  }

  setupSun({ dir = [0.4, 0.6, -0.5], color = '#fff2dc', intensity = 3.0, area = 30, far = 220, bias = -0.0004, normalBias = 0.03 } = {}) {
    const q = this.ctx.q;
    const light = new THREE.DirectionalLight(color, intensity);
    this.sunDir = new THREE.Vector3(...dir).normalize();
    light.castShadow = q.shadows;
    if (q.shadows) {
      light.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      const cam = light.shadow.camera;
      cam.left = -area; cam.right = area; cam.top = area; cam.bottom = -area;
      cam.near = 1; cam.far = far;
      light.shadow.bias = bias;
      light.shadow.normalBias = normalBias;
      light.shadow.radius = q.softShadows ? 3 : 1;
    }
    this.shadowArea = area;
    this.sun = light;
    this.scene.add(light);
    this.scene.add(light.target);
    return light;
  }

  setupHemi(sky = '#bfe3ff', ground = '#6a8a4a', intensity = 1.0) {
    const h = new THREE.HemisphereLight(sky, ground, intensity);
    this.scene.add(h);
    this.hemi = h;
    return h;
  }

  setupFog(color, near, far) {
    const dd = this.ctx.q.drawDistance;
    this.scene.fog = new THREE.Fog(color, near * dd, far * dd);
    this.scene.background = new THREE.Color(color);
  }

  setupFogExp(color, density) {
    this.scene.fog = new THREE.FogExp2(color, density / this.ctx.q.drawDistance);
    this.scene.background = new THREE.Color(color);
  }

  // Image based lighting from the sky only (outdoor levels).
  envFromSky(intensity = 1.0) {
    if (!this.sky) return;
    const envScene = new THREE.Scene();
    const sky = createSky(this.def.skyOpts || {});
    sky.children.forEach((c) => { c.visible = false; });
    envScene.add(sky);
    this.applyEnv(envScene, new THREE.Vector3(0, 0, 0), intensity, 0.04);
    sky.geometry.dispose();
    sky.material.dispose();
  }

  // Image based lighting captured from the level itself (interiors).
  envFromScene(position, intensity = 1.0) {
    this.applyEnv(this.scene, position, intensity, 0.0);
  }

  applyEnv(scene, position, intensity, sigma) {
    const r = this.ctx.renderer.renderer;
    const pmrem = new THREE.PMREMGenerator(r);
    const prevFog = scene.fog;
    const rt = pmrem.fromScene(scene, sigma, 0.1, 600, { size: this.ctx.q.envSize, position });
    scene.fog = prevFog;
    pmrem.dispose();
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = intensity;
  }

  makeDoor(opts, x, y, z, rotY) {
    const d = new Door(opts).place(x, y, z, rotY);
    this.scene.add(d.group);
    this.collide(d.allColliders());
    this.door = d;
    return d;
  }

  makeDecoy(opts, x, y, z, rotY) {
    const d = new Door({ ...opts, sparkles: false, locked: true }).place(x, y, z, rotY);
    d.decoy = true;
    d.decal.visible = false;
    this.scene.add(d.group);
    this.collide(d.allColliders());
    this.decoys.push(d);
    return d;
  }

  // Merge static meshes that share an identical-looking material into one draw
  // call each. Phones are far more limited by draw calls than by triangles.
  batchStatic() {
    const groups = new Map();
    const texKey = (t) => (t ? `${t.source.uuid}:${t.repeat.x.toFixed(3)},${t.repeat.y.toFixed(3)}:${t.offset.x.toFixed(3)},${t.offset.y.toFixed(3)}` : '-');
    const ok = new Set(['MeshStandardMaterial', 'MeshLambertMaterial', 'MeshBasicMaterial']);
    this.scene.updateMatrixWorld(true);
    const isDynamic = (o) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.dynamic) return true; return false; };
    this.scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.geometry) return;
      const m = o.material;
      if (!ok.has(m.type) || Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')) return;
      if (m.transparent || m.blending !== THREE.NormalBlending || o.renderOrder !== 0 || !o.visible) return;
      if (o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) return;
      if (isDynamic(o)) return;
      const key = [m.type, m.color && m.color.getHexString(), m.roughness, m.metalness, m.emissive && m.emissive.getHexString(), m.emissiveIntensity,
        texKey(m.map), texKey(m.normalMap), texKey(m.emissiveMap), m.side, m.alphaTest, m.toneMapped, m.fog, o.castShadow, o.receiveShadow,
        m.normalScale ? m.normalScale.x : 0].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    });
    let merged = 0;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = [];
      for (const o of list) {
        let g = o.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!g.index) {
          const n = g.attributes.position.count;
          const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
          for (let i = 0; i < n; i++) idx[i] = i;
          g.setIndex(new THREE.BufferAttribute(idx, 1));
        }
        g.morphAttributes = {};
        g.applyMatrix4(o.matrixWorld);
        geos.push(g);
      }
      const mg = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!mg) continue;
      const first = list[0];
      const mesh = new THREE.Mesh(mg, first.material);
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.name = 'batched';
      this.scene.add(mesh);
      for (const o of list) {
        o.parent.remove(o);
        o.geometry.dispose();
      }
      merged += list.length;
    }
    this.batchedCount = merged;
    return merged;
  }

  update(dt, player) {
    this.time += dt;
    const p = player.pos;
    if (this.sky) {
      this.sky.userData.update(dt);
      this.sky.userData.placeSun(this.ctx.camera);
    }
    if (this.sun) {
      // follow the player, snapped to shadow texels to avoid shimmering
      const q = this.ctx.q;
      const texel = q.shadows ? (this.shadowArea * 2) / q.shadowSize : 1;
      const sx = Math.round(p.x / texel) * texel;
      const sz = Math.round(p.z / texel) * texel;
      this.sun.target.position.set(sx, p.y, sz);
      this.sun.position.set(sx, p.y, sz).addScaledVector(this.sunDir, 100);
      this.sun.target.updateMatrixWorld();
    }
    for (const fn of this.updaters) fn(dt, this.time, player);
  }

  dispose() {
    const seenTex = new Set();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.customDepthMaterial) o.customDepthMaterial.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          for (const k of Object.keys(m)) {
            const v = m[k];
            if (v && v.isTexture && !isCached(v) && !seenTex.has(v)) { seenTex.add(v); v.dispose(); }
          }
          if (m.uniforms) {
            for (const u of Object.values(m.uniforms)) {
              const v = u && u.value;
              if (v && v.isTexture && !isCached(v) && !seenTex.has(v)) { seenTex.add(v); v.dispose(); }
            }
          }
          m.dispose();
        }
      }
    });
    if (this.envTarget) this.envTarget.dispose();
    if (this.extraDispose) this.extraDispose();
  }
}

export function ribbon(points, width, { segments = 1, uvScale = 1, y = 0.02, heightAt = null } = {}) {
  // flat strip along a polyline (roads, paths)
  const pos = [], uv = [], idx = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    if (i > 0) acc += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    for (let s = 0; s <= segments; s++) {
      const t = s / segments - 0.5;
      const x = p.x + nx * width * t, z = p.z + nz * width * t;
      pos.push(x, (heightAt ? heightAt(x, z) : 0) + y, z);
      uv.push(s / segments, acc * uvScale);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < points.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * row + s, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// distance from point to polyline (XZ)
export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)));
    const px = a.x + abx * t, pz = a.z + abz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}

// Dust motes / pollen floating in the air around the player
export function floatingMotes(count, { color = '#fff6d8', size = 0.05, area = 18, height = 6, speed = 0.15, opacity = 0.8, tex } = {}) {
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = Math.random() * area * 2 - area;
    seeds[i * 3 + 1] = Math.random() * height;
    seeds[i * 3 + 2] = Math.random() * area * 2 - area;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({
    color, size, map: tex, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.update = (t, center, baseY = 0) => {
    const a = geo.attributes.position;
    for (let i = 0; i < count; i++) {
      const sx = seeds[i * 3], sy = seeds[i * 3 + 1], sz = seeds[i * 3 + 2];
      let x = sx + Math.sin(t * speed + i) * 0.6;
      let z = sz + Math.cos(t * speed * 0.8 + i * 1.3) * 0.6;
      // wrap around the center
      x = ((x - center.x + area) % (area * 2) + area * 2) % (area * 2) - area + center.x;
      z = ((z - center.z + area) % (area * 2) + area * 2) % (area * 2) - area + center.z;
      const y = baseY + ((sy + t * speed * 0.3) % height);
      a.setXYZ(i, x, y, z);
    }
    a.needsUpdate = true;
  };
  return pts;
}
