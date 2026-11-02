import * as THREE from 'three';
import { glowTexture, canvasTexture } from './textures.js';

// Ripple rings and splash droplets on water surfaces.
export class WaterFX {
  constructor(scene) {
    this.scene = scene;
    const ringTex = canvasTexture(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.72, 'rgba(255,255,255,0.0)');
      g.addColorStop(0.86, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.94, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }, { wrap: false, srgb: false });
    this.ringTex = ringTex;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: ringTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: '#dffff4',
      }));
      m.visible = false;
      m.renderOrder = 6;
      m.userData = { t: 1, life: 1.6, size: 1 };
      scene.add(m);
      this.rings.push(m);
    }
    this.ringIdx = 0;
    // droplets
    this.maxDrops = 90;
    this.drops = [];
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxDrops * 3), 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 0.06, map: glowTexture(), color: '#f2fffa', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
  }

  ripple(x, y, z, size = 1) {
    const m = this.rings[this.ringIdx];
    this.ringIdx = (this.ringIdx + 1) % this.rings.length;
    m.position.set(x, y + 0.01, z);
    m.userData.t = 0;
    m.userData.size = size;
    m.userData.life = 1.2 + size * 0.6;
    m.visible = true;
  }

  splash(x, y, z, strength = 1) {
    const k = Math.max(0.3, Math.min(1.6, strength));
    this.ripple(x, y, z, 1.4 * k);
    setTimeout(() => this.ripple(x, y, z, 0.9 * k), 180);
    setTimeout(() => this.ripple(x, y, z, 0.6 * k), 380);
    const n = Math.round(25 + 30 * k);
    for (let i = 0; i < n; i++) {
      if (this.drops.length >= this.maxDrops) this.drops.shift();
      const a = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * 0.35;
      const sp = (0.6 + Math.random() * 1.6) * k;
      this.drops.push({
        p: new THREE.Vector3(x + Math.cos(a) * r, y + 0.05, z + Math.sin(a) * r),
        v: new THREE.Vector3(Math.cos(a) * sp * 0.6, 1.2 + Math.random() * 2.4 * k, Math.sin(a) * sp * 0.6),
        y0: y,
      });
    }
  }

  update(dt) {
    for (const m of this.rings) {
      if (!m.visible) continue;
      const u = m.userData;
      u.t += dt / u.life;
      if (u.t >= 1) { m.visible = false; continue; }
      const s = (0.25 + u.t * 1.6) * u.size;
      m.scale.set(s, 1, s);
      m.material.opacity = (1 - u.t) * (1 - u.t) * 0.55;
    }
    const pos = this.points.geometry.attributes.position;
    let n = 0;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < d.y0) { this.drops.splice(i, 1); continue; }
    }
    for (const d of this.drops) pos.setXYZ(n++, d.p.x, d.p.y, d.p.z);
    for (let i = n; i < this.maxDrops; i++) pos.setXYZ(i, 0, -1000, 0);
    pos.needsUpdate = true;
  }
}
