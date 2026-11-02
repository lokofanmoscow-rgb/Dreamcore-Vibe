// Touch (virtual joystick + drag-to-look) and keyboard/mouse input.

export class Input {
  constructor(root, { stickEl, knobEl }) {
    this.root = root;
    this.stickEl = stickEl;
    this.knobEl = knobEl;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.run = false;
    this.enabled = false;
    this.keys = new Set();
    this.stickId = null;
    this.lookId = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.lookLast = { x: 0, y: 0 };
    this.stickRadius = 64;
    this.mouseDown = false;
    this.usedTouch = false;

    const opts = { passive: false };
    root.addEventListener('touchstart', (e) => this.onTouchStart(e), opts);
    root.addEventListener('touchmove', (e) => this.onTouchMove(e), opts);
    root.addEventListener('touchend', (e) => this.onTouchEnd(e), opts);
    root.addEventListener('touchcancel', (e) => this.onTouchEnd(e), opts);

    window.addEventListener('keydown', (e) => { this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.reset());

    root.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.usedTouch) return;
      this.mouseDown = true;
      this.lookLast.x = e.clientX; this.lookLast.y = e.clientY;
      if (root.requestPointerLock && !document.pointerLockElement) {
        try { const p = root.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* ignore */ }
      }
    });
    window.addEventListener('mouseup', () => { this.mouseDown = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.usedTouch) return;
      if (document.pointerLockElement === root) {
        this.look.x += e.movementX * 0.9;
        this.look.y += e.movementY * 0.9;
      } else if (this.mouseDown) {
        this.look.x += e.clientX - this.lookLast.x;
        this.look.y += e.clientY - this.lookLast.y;
        this.lookLast.x = e.clientX; this.lookLast.y = e.clientY;
      }
    });
  }

  reset() {
    this.keys.clear();
    this.move.x = this.move.y = 0;
    this.look.x = this.look.y = 0;
    this.stickId = this.lookId = null;
    this.mouseDown = false;
    this.hideStick();
  }

  isUiTarget(t) {
    return t && t.closest && t.closest('.ui-btn, button, input, .panel');
  }

  onTouchStart(e) {
    this.usedTouch = true;
    if (!this.enabled) return;
    for (const t of e.changedTouches) {
      if (this.isUiTarget(t.target)) continue;
      const left = t.clientX < window.innerWidth * 0.42;
      if (left && this.stickId === null) {
        this.stickId = t.identifier;
        this.stickOrigin.x = t.clientX;
        this.stickOrigin.y = t.clientY;
        this.showStick(t.clientX, t.clientY);
      } else if (!left && this.lookId === null) {
        this.lookId = t.identifier;
        this.lookLast.x = t.clientX;
        this.lookLast.y = t.clientY;
      }
    }
    e.preventDefault();
  }

  onTouchMove(e) {
    if (!this.enabled) return;
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        let dx = t.clientX - this.stickOrigin.x;
        let dy = t.clientY - this.stickOrigin.y;
        const len = Math.hypot(dx, dy);
        const R = this.stickRadius;
        if (len > R * 1.6) {
          // drag the stick origin along so it never feels stuck
          const k = (len - R * 1.6) / len;
          this.stickOrigin.x += dx * k;
          this.stickOrigin.y += dy * k;
          dx = t.clientX - this.stickOrigin.x;
          dy = t.clientY - this.stickOrigin.y;
          this.showStick(this.stickOrigin.x, this.stickOrigin.y);
        }
        const l2 = Math.hypot(dx, dy);
        const cl = Math.min(l2, R);
        const nx = l2 > 0 ? dx / l2 : 0, ny = l2 > 0 ? dy / l2 : 0;
        this.move.x = nx * cl / R;
        this.move.y = -ny * cl / R;
        this.run = l2 > R * 1.25;
        this.knobEl.style.transform = `translate(${nx * cl}px, ${ny * cl}px)`;
      } else if (t.identifier === this.lookId) {
        this.look.x += (t.clientX - this.lookLast.x) * 1.6;
        this.look.y += (t.clientY - this.lookLast.y) * 1.6;
        this.lookLast.x = t.clientX;
        this.lookLast.y = t.clientY;
      }
    }
    e.preventDefault();
  }

  onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.move.x = this.move.y = 0;
        this.run = false;
        this.hideStick();
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
      }
    }
  }

  showStick(x, y) {
    this.stickEl.style.display = 'block';
    this.stickEl.style.left = x + 'px';
    this.stickEl.style.top = y + 'px';
  }

  hideStick() {
    this.stickEl.style.display = 'none';
    this.knobEl.style.transform = 'translate(0px, 0px)';
  }

  // Combined movement including keyboard; returns {x, y, run}
  readMove() {
    let x = this.move.x, y = this.move.y;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    const run = this.run || k.has('ShiftLeft') || k.has('ShiftRight');
    return { x, y, run };
  }

  consumeLook() {
    const l = { x: this.look.x, y: this.look.y };
    this.look.x = this.look.y = 0;
    return l;
  }
}
