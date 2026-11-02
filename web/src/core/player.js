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
    this.vy = 0;
    this.grounded = true;
    this.wadeDip = 0;
  }

  spawn(level) {
    this.level = level;
    const s = level.spawn;
    this.pos.set(s.x, 0, s.z);
    this.yaw = s.yaw || 0;
    this.pitch = s.pitch || 0;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.grounded = true;
    this.groundY = level.groundHeight(s.x, s.z);
    this.pos.y = this.groundY;
    this.prevPos.copy(this.pos);
    this.wasInWater = this.waterDepth() > 0.15;
    this.wadeDip = 0;
    this.updateCamera(0, 0);
  }

  waterDepth() {
    const lv = this.level;
    if (!lv || !lv.waterLevel) return 0;
    const w = lv.waterLevel(this.pos.x, this.pos.z);
    return w === null || w === undefined ? 0 : w - this.pos.y;
  }

  update(dt, input, settings) {
    const look = input.consumeLook();
    const sens = 0.0032 * settings.sensitivity;
    this.yaw -= look.x * sens;
    this.pitch -= look.y * sens * (settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));

    const depth = this.waterDepth();
    const inWater = depth > 0.15;
    // water drags the legs
    const drag = inWater ? Math.max(0.55, 1 - Math.min(1, depth) * 0.7) : 1;
    const mv = input.readMove();
    const speed = (mv.run ? 5.4 : 3.1) * drag;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward is -Z in camera space
    const fx = -sy, fz = -cy;
    const rx = cy, rz = -sy;
    const tx = (fx * mv.y + rx * mv.x) * speed;
    const tz = (fz * mv.y + rz * mv.x) * speed;
    const accel = Math.min(1, dt * (this.grounded ? (inWater ? 5 : 9) : 2.5));
    this.vel.x += (tx - this.vel.x) * accel;
    this.vel.z += (tz - this.vel.z) * accel;

    if (input.consumeJump() && this.grounded) {
      this.vy = inWater ? 3.6 : 4.7;
      this.grounded = false;
      if (this.onJump) this.onJump(this.pos, inWater);
    }

    this.prevPos.copy(this.pos);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const lv = this.level;
    if (lv) {
      resolveCollisions(this.pos, lv.colliders);
      applyBounds(this.pos, lv.bounds);
      const gy = lv.groundHeight(this.pos.x, this.pos.z);
      if (this.grounded && gy < this.pos.y - 0.45) {
        // walked off a ledge: fall
        this.grounded = false;
        this.vy = 0;
      }
      if (!this.grounded) {
        const prevY = this.pos.y;
        this.vy -= 13.5 * dt;
        const wl = lv.waterLevel ? lv.waterLevel(this.pos.x, this.pos.z) : null;
        if (wl !== null && wl !== undefined && this.pos.y < wl) this.vy *= Math.max(0, 1 - dt * 5);
        this.pos.y += this.vy * dt;
        if (wl !== null && wl !== undefined && prevY > wl && this.pos.y <= wl && this.onWaterEnter) {
          this.onWaterEnter(this.pos, Math.abs(this.vy), wl);
          this.wadeDip = Math.min(0.35, Math.abs(this.vy) * 0.06);
        }
        if (this.pos.y <= gy) {
          const impact = -this.vy;
          this.pos.y = gy;
          this.groundY = gy;
          this.vy = 0;
          this.grounded = true;
          if (this.onLand) this.onLand(this.pos, impact, this.waterDepth() > 0.15);
          this.wadeDip = Math.max(this.wadeDip, Math.min(0.18, impact * 0.025));
        }
      } else {
        // step smoothing (stairs and slopes)
        const k = gy > this.groundY ? Math.min(1, dt * 14) : Math.min(1, dt * 10);
        this.groundY += (gy - this.groundY) * k;
        this.pos.y = this.groundY;
        const d2 = this.waterDepth();
        if (!this.wasInWater && d2 > 0.15 && this.onWaterEnter) this.onWaterEnter(this.pos, 1.5, this.pos.y + d2);
      }
      this.wasInWater = this.waterDepth() > 0.15;
    }
    this.wadeDip = Math.max(0, this.wadeDip - dt * 0.5);

    const moved = Math.hypot(this.pos.x - this.prevPos.x, this.pos.z - this.prevPos.z);
    const sp = dt > 0 ? moved / dt : 0;
    this.speed = sp;
    this.inWater = inWater;
    if (sp > 0.3 && this.grounded) {
      this.bobPhase += moved * (mv.run ? 2.1 : 2.5) * (inWater ? 0.8 : 1);
      this.stepDist += moved;
      const stride = (mv.run ? 0.82 : 0.62) * (inWater ? 0.85 : 1);
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.lastStepSide ^= 1;
        if (this.onStep) this.onStep(this.pos, sp, inWater);
      }
    } else if (this.grounded) {
      this.bobPhase += (Math.round(this.bobPhase / Math.PI) * Math.PI - this.bobPhase) * Math.min(1, dt * 4);
    }
    this.updateCamera(dt, settings.headBob ? Math.min(1, sp / 3) * (inWater ? 1.3 : 1) : 0);
  }

  updateCamera(dt, bobAmt) {
    const c = this.camera;
    const bob = Math.sin(this.bobPhase) * 0.045 * bobAmt;
    const sway = Math.cos(this.bobPhase * 0.5) * 0.02 * bobAmt;
    c.position.set(this.pos.x + Math.cos(this.yaw) * sway, this.pos.y + this.eye + Math.abs(bob) - 0.02 * bobAmt - (this.wadeDip || 0), this.pos.z - Math.sin(this.yaw) * sway);
    c.rotation.order = 'YXZ';
    c.rotation.y = this.yaw;
    c.rotation.x = this.pitch;
    c.rotation.z = Math.sin(this.bobPhase * 0.5) * 0.004 * bobAmt;
  }
}
