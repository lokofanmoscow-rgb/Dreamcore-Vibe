import * as THREE from 'three';

const PLAYER_R = 0.3;

export function resolveCollisions(pos, colliders, r = PLAYER_R) {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of colliders) {
      if (c.enabled === false) continue;
      if (c.type === 'circle') {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const rr = c.r + r;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1e-4;
          const push = (rr - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
          moved = true;
        }
      } else if (c.type === 'obox') {
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const dx = pos.x - c.x, dz = pos.z - c.z;
        let lx = dx * cs - dz * sn;
        let lz = dx * sn + dz * cs;
        if (Math.abs(lx) > c.hw + r || Math.abs(lz) > c.hd + r) continue;
        const qx = Math.max(-c.hw, Math.min(c.hw, lx));
        const qz = Math.max(-c.hd, Math.min(c.hd, lz));
        let ox = lx - qx, oz = lz - qz;
        const d = Math.hypot(ox, oz);
        if (d > 1e-5) {
          if (d >= r) continue;
          const k = (r - d) / d;
          lx += ox * k; lz += oz * k;
        } else {
          // centre inside the box: push out along the shallowest axis
          const px = c.hw - Math.abs(lx) + r, pz = c.hd - Math.abs(lz) + r;
          if (px < pz) lx += Math.sign(lx || 1) * px; else lz += Math.sign(lz || 1) * pz;
        }
        pos.x = c.x + lx * cs + lz * sn;
        pos.z = c.z - lx * sn + lz * cs;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

export function applyBounds(pos, b, r = PLAYER_R) {
  if (!b) return;
  if (b.type === 'circle') {
    const dx = pos.x - b.x, dz = pos.z - b.z;
    const d = Math.hypot(dx, dz);
    const max = b.r - r;
    if (d > max) { pos.x = b.x + dx / d * max; pos.z = b.z + dz / d * max; }
  } else if (b.type === 'fn') {
    b.fn(pos);
  } else if (b.type === 'box') {
    pos.x = Math.max(b.x0 + r, Math.min(b.x1 - r, pos.x));
    pos.z = Math.max(b.z0 + r, Math.min(b.z1 - r, pos.z));
  }
}

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.eye = 1.65;
    this.groundY = 0;
    this.bobPhase = 0;
    this.stepDist = 0;
    this.lastStepSide = 0;
    this.onStep = null;
    this.level = null;
    this.prevPos = new THREE.Vector3();
  }

  spawn(level) {
    this.level = level;
    const s = level.spawn;
    this.pos.set(s.x, 0, s.z);
    this.yaw = s.yaw || 0;
    this.pitch = s.pitch || 0;
    this.vel.set(0, 0, 0);
    this.groundY = level.groundHeight(s.x, s.z);
    this.pos.y = this.groundY;
    this.prevPos.copy(this.pos);
    this.updateCamera(0, 0);
  }

  update(dt, input, settings) {
    const look = input.consumeLook();
    const sens = 0.0032 * settings.sensitivity;
    this.yaw -= look.x * sens;
    this.pitch -= look.y * sens * (settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));

    const mv = input.readMove();
    const speed = mv.run ? 5.4 : 3.1;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward is -Z in camera space
    const fx = -sy, fz = -cy;
    const rx = cy, rz = -sy;
    const tx = (fx * mv.y + rx * mv.x) * speed;
    const tz = (fz * mv.y + rz * mv.x) * speed;
    const accel = Math.min(1, dt * 9);
    this.vel.x += (tx - this.vel.x) * accel;
    this.vel.z += (tz - this.vel.z) * accel;

    this.prevPos.copy(this.pos);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const lv = this.level;
    if (lv) {
      resolveCollisions(this.pos, lv.colliders);
      applyBounds(this.pos, lv.bounds);
      const gy = lv.groundHeight(this.pos.x, this.pos.z);
      // step smoothing (stairs and slopes)
      const k = gy > this.groundY ? Math.min(1, dt * 14) : Math.min(1, dt * 10);
      this.groundY += (gy - this.groundY) * k;
      this.pos.y = this.groundY;
    }

    const moved = Math.hypot(this.pos.x - this.prevPos.x, this.pos.z - this.prevPos.z);
    const sp = dt > 0 ? moved / dt : 0;
    this.speed = sp;
    if (sp > 0.3) {
      this.bobPhase += moved * (mv.run ? 2.1 : 2.5);
      this.stepDist += moved;
      const stride = mv.run ? 0.82 : 0.62;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.lastStepSide ^= 1;
        if (this.onStep) this.onStep(this.pos, sp);
      }
    } else {
      this.bobPhase += (Math.round(this.bobPhase / Math.PI) * Math.PI - this.bobPhase) * Math.min(1, dt * 4);
    }
    this.updateCamera(dt, settings.headBob ? Math.min(1, sp / 3) : 0);
  }

  updateCamera(dt, bobAmt) {
    const c = this.camera;
    const bob = Math.sin(this.bobPhase) * 0.045 * bobAmt;
    const sway = Math.cos(this.bobPhase * 0.5) * 0.02 * bobAmt;
    c.position.set(this.pos.x + Math.cos(this.yaw) * sway, this.pos.y + this.eye + Math.abs(bob) - 0.02 * bobAmt, this.pos.z - Math.sin(this.yaw) * sway);
    c.rotation.order = 'YXZ';
    c.rotation.y = this.yaw;
    c.rotation.x = this.pitch;
    c.rotation.z = Math.sin(this.bobPhase * 0.5) * 0.004 * bobAmt;
  }
}
