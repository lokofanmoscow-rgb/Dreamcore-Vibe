import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from '../core/textures.js';

const portalVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const portalFrag = /* glsl */`
  uniform float uOpen, uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 c = (vUv - 0.5) * vec2(1.0, 2.1);
    float r = length(c);
    float a = atan(c.y, c.x);
    float swirl = sin(a * 3.0 + uTime * 0.9 - r * 9.0) * 0.5 + 0.5;
    float core = smoothstep(1.2, 0.0, r);
    vec3 col = mix(uColor, vec3(1.0), core * 0.8) * (1.1 + core * 1.8 + swirl * 0.5);
    gl_FragColor = vec4(col * uOpen, 1.0);
  }`;

const beamFrag = /* glsl */`
  uniform float uOpen, uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float along = vUv.y;              // 0 at door, 1 far
    float across = abs(vUv.x - 0.5) * 2.0;
    float a = (1.0 - along) * (1.0 - along) * (1.0 - smoothstep(0.6, 1.0, across));
    a *= 0.85 + 0.15 * sin(uTime * 2.0 + vUv.x * 20.0);
    gl_FragColor = vec4(uColor * a * uOpen * 0.3, 1.0);
  }`;

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export class Door {
  constructor({
    color = '#ffffff',
    frameColor = null,
    glow = '#fff3d6',
    width = 1.0,
    height = 2.15,
    knob = '#d9b25a',
    style = 'panel',
    frame = true,
    sparkles = true,
    openAngle = 1.85,
    roughness = 0.55,
    locked = false,
    beacon = false,
  } = {}) {
    this.locked = locked;
    this.shake = 0;
    this.width = width;
    this.height = height;
    this.openAngle = openAngle;
    this.open = 0;
    this.target = 0;
    this.time = 0;
    this.entered = false;
    this.glowColor = new THREE.Color(glow);
    const group = new THREE.Group();
    group.name = 'door';
    group.userData.dynamic = true;
    this.group = group;

    const doorMat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.0 });
    const frameMat = new THREE.MeshStandardMaterial({ color: frameColor || color, roughness: 0.6 });
    const knobMat = new THREE.MeshStandardMaterial({ color: knob, roughness: 0.25, metalness: 1.0 });

    // frame
    if (frame) {
      const fw = 0.11, fd = 0.2;
      const fg = mergeGeometries([
        box(fw, height + fw, fd, -width / 2 - fw / 2, (height + fw) / 2, 0),
        box(fw, height + fw, fd, width / 2 + fw / 2, (height + fw) / 2, 0),
        box(width + fw * 2, fw, fd, 0, height + fw / 2, 0),
        box(width + fw * 2 + 0.06, 0.03, fd + 0.06, 0, 0.015, 0),
        // trim
        box(0.035, height + fw + 0.04, 0.03, -width / 2 - fw - 0.0175, (height + fw) / 2, fd / 2),
        box(0.035, height + fw + 0.04, 0.03, width / 2 + fw + 0.0175, (height + fw) / 2, fd / 2),
        box(width + fw * 2 + 0.07, 0.035, 0.03, 0, height + fw + 0.0175, fd / 2),
      ]);
      const fm = new THREE.Mesh(fg, frameMat);
      fm.castShadow = true;
      fm.receiveShadow = true;
      group.add(fm);
    }

    // door leaf (pivot at hinge on the left)
    const pivot = new THREE.Group();
    pivot.position.set(-width / 2, 0, 0);
    group.add(pivot);
    this.pivot = pivot;
    const t = 0.05;
    const parts = [box(width - 0.01, height - 0.01, t, width / 2, height / 2, 0)];
    if (style === 'panel') {
      // raised moldings on both faces
      const mw = 0.025, md = 0.018;
      const panels = [
        [0.12, 1.15, width - 0.24, 0.85],
        [0.12, 0.12, width - 0.24, 0.9],
      ];
      for (const side of [1, -1]) {
        for (const [px, py, pw, ph] of panels) {
          const z = side * (t / 2 + md / 2);
          parts.push(box(pw, mw, md, px + pw / 2, py, z));
          parts.push(box(pw, mw, md, px + pw / 2, py + ph, z));
          parts.push(box(mw, ph, md, px, py + ph / 2, z));
          parts.push(box(mw, ph, md, px + pw, py + ph / 2, z));
        }
      }
    } else if (style === 'glass') {
      // small window
      for (const side of [1, -1]) {
        const z = side * (t / 2 + 0.01);
        parts.push(box(width * 0.6, 0.03, 0.02, width / 2, 1.95, z));
        parts.push(box(width * 0.6, 0.03, 0.02, width / 2, 1.45, z));
        parts.push(box(0.03, 0.5, 0.02, width * 0.2, 1.7, z));
        parts.push(box(0.03, 0.5, 0.02, width * 0.8, 1.7, z));
      }
    }
    const leaf = new THREE.Mesh(mergeGeometries(parts), doorMat);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    pivot.add(leaf);
    if (style === 'glass') {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.58, 0.48),
        new THREE.MeshStandardMaterial({ color: '#cfe8ff', roughness: 0.05, metalness: 0.3, emissive: this.glowColor, emissiveIntensity: 0.6 }));
      glass.position.set(width / 2, 1.7, t / 2 + 0.002);
      pivot.add(glass);
    }
    const knobGeo = mergeGeometries([
      new THREE.SphereGeometry(0.038, 16, 12).translate(width - 0.09, 1.02, t / 2 + 0.055),
      new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8).rotateX(Math.PI / 2).translate(width - 0.09, 1.02, t / 2 + 0.025),
      new THREE.SphereGeometry(0.038, 16, 12).translate(width - 0.09, 1.02, -t / 2 - 0.055),
      new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8).rotateX(Math.PI / 2).translate(width - 0.09, 1.02, -t / 2 - 0.025),
      new THREE.CylinderGeometry(0.03, 0.03, 0.006, 16).rotateX(Math.PI / 2).translate(width - 0.09, 1.02, t / 2 + 0.003),
    ]);
    const knobMesh = new THREE.Mesh(knobGeo, knobMat);
    knobMesh.castShadow = true;
    pivot.add(knobMesh);

    // the bright other-world behind the leaf
    this.uniforms = {
      uOpen: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: this.glowColor.clone() },
    };
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: portalVert, fragmentShader: portalFrag, fog: false }),
    );
    portal.position.set(0, height / 2, -0.035);
    portal.visible = false;
    group.add(portal);
    this.portal = portal;

    // light under the door: a hint even when closed
    const slit = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.95, 0.025),
      new THREE.MeshBasicMaterial({ color: this.glowColor.clone().multiplyScalar(4), fog: false, toneMapped: true }),
    );
    slit.position.set(0, 0.0125, t / 2 + 0.002);
    slit.visible = !locked;
    group.add(slit);
    this.slit = slit;

    // volumetric beam spilling out once open
    const beamGeo = new THREE.BufferGeometry();
    const L = 4.2, spread = 1.8;
    const w2 = width / 2;
    const verts = new Float32Array([
      // floor sheet
      -w2, 0.02, 0.05, w2, 0.02, 0.05, w2 * spread, 0.02, L, -w2 * spread, 0.02, L,
      // left wall
      -w2, 0.0, 0.05, -w2, height, 0.05, -w2 * spread, height * 1.15, L, -w2 * spread, 0.0, L,
      // right wall
      w2, 0.0, 0.05, w2, height, 0.05, w2 * spread, height * 1.15, L, w2 * spread, 0.0, L,
      // top
      -w2, height, 0.05, w2, height, 0.05, w2 * spread, height * 1.15, L, -w2 * spread, height * 1.15, L,
    ]);
    const uvs = new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
    ]);
    const bIdx = [];
    for (let q = 0; q < 4; q++) { const o = q * 4; bIdx.push(o, o + 1, o + 2, o, o + 2, o + 3); }
    beamGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    beamGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    beamGeo.setIndex(bIdx);
    const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: portalVert,
      fragmentShader: beamFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    }));
    beam.visible = false;
    beam.renderOrder = 10;
    group.add(beam);
    this.beam = beam;

    // ground glow decal
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 3.2, 3.2),
      new THREE.MeshBasicMaterial({
        map: glowTexture(), color: this.glowColor.clone(), transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(0, 0.03, 1.1);
    decal.renderOrder = 9;
    group.add(decal);
    this.decal = decal;

    // sparkles that slowly rise around the frame
    this.sparkles = null;
    if (sparkles) {
      const n = 26;
      const p = new Float32Array(n * 3);
      this.sparkSeeds = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        this.sparkSeeds[i * 3] = (Math.random() - 0.5) * (width + 0.8);
        this.sparkSeeds[i * 3 + 1] = Math.random();
        this.sparkSeeds[i * 3 + 2] = (Math.random() - 0.2) * 0.8;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.PointsMaterial({
        size: 0.07, map: glowTexture(), color: this.glowColor.clone().multiplyScalar(2.5),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
      });
      this.sparkles = new THREE.Points(g, m);
      this.sparkles.frustumCulled = false;
      group.add(this.sparkles);
    }

    // a faint pillar of light, so the door can be found in very large levels
    if (beacon) {
      const bm = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: this.glowColor.clone() }, uTime: this.uniforms.uTime },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
          void main(){
            float a = (1.0 - vUv.y) * (1.0 - vUv.y) * smoothstep(0.0, 0.05, vUv.y);
            a *= 0.75 + 0.25 * sin(vUv.y * 30.0 - uTime * 1.5);
            gl_FragColor = vec4(uColor * a * 0.32, 1.0);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.45, 80, 16, 1, true).translate(0, 40 + height, 0), bm);
      beam.renderOrder = 11;
      group.add(beam);
    }

    this._local = new THREE.Vector3();
    this._prevLocalZ = null;
    this.colliders = [];
    this.leafColliders = [];
  }

  place(x, y, z, rotY = 0) {
    this.group.position.set(x, y, z);
    this.group.rotation.y = rotY;
    this.group.updateMatrixWorld(true);
    this.inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    // jambs and closed leaf as small circle colliders
    const pts = [[-this.width / 2 - 0.06, 0, 0.14], [this.width / 2 + 0.06, 0, 0.14]];
    const leaf = [];
    for (let i = 0; i < 4; i++) leaf.push([-this.width / 2 + this.width * (i + 0.5) / 4, 0, 0.16]);
    const toWorld = ([lx, , r]) => {
      const v = new THREE.Vector3(lx, 0, 0).applyMatrix4(this.group.matrixWorld);
      return { type: 'circle', x: v.x, z: v.z, r, enabled: true };
    };
    this.colliders = pts.map(toWorld);
    this.leafColliders = leaf.map(toWorld);
    return this;
  }

  allColliders() { return [...this.colliders, ...this.leafColliders]; }

  // returns true when the player walks through the open doorway
  update(dt, playerPos) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    const l = this._local.copy(playerPos).applyMatrix4(this.inv);
    const dist = Math.hypot(l.x, l.z);
    this.distance = dist;
    if (!this.target && l.z > 0.2 && dist < (this.locked ? 1.8 : 3.4)) {
      if (this.locked) {
        if (!this._rattled) { this._rattled = true; this.shake = 0.5; if (this.onLocked) this.onLocked(); }
      } else this.target = 1;
    }
    if (this._rattled && dist > 5) this._rattled = false;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.pivot.rotation.y = Math.sin(this.shake * 60) * 0.02 * (this.shake / 0.5);
      return false;
    }
    if (this.locked) return false;
    const speed = this.target ? 0.55 : 0;
    const prevOpen = this.open;
    this.open = Math.min(1, this.open + dt * speed);
    if (prevOpen === 0 && this.open > 0 && this.onOpen) this.onOpen();
    const e = 1 - Math.pow(1 - this.open, 3);
    this.pivot.rotation.y = e * this.openAngle;
    const glowA = Math.min(1, this.open * 2.5);
    this.uniforms.uOpen.value = glowA;
    this.portal.visible = this.open > 0.001;
    this.beam.visible = this.open > 0.001;
    this.decal.material.opacity = 0.15 + glowA * 0.75;
    for (const c of this.leafColliders) c.enabled = this.open < 0.25;

    if (this.sparkles) {
      const pos = this.sparkles.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const s = this.sparkSeeds;
        const yy = ((s[i * 3 + 1] + this.time * 0.08) % 1);
        pos.setXYZ(i,
          s[i * 3] + Math.sin(this.time * 0.7 + i) * 0.08,
          yy * (this.height + 0.9),
          s[i * 3 + 2] + Math.cos(this.time * 0.5 + i * 1.7) * 0.08);
      }
      pos.needsUpdate = true;
      this.sparkles.material.opacity = 0.9;
    }

    // entering = stepping into the open doorway from the front
    let entered = false;
    if (this.open > 0.35 && l.z < 0.45 && l.z > -0.6 && Math.abs(l.x) < this.width / 2 + 0.05
      && this._prevLocalZ !== null && this._prevLocalZ > -0.6) {
      entered = true;
    }
    this._prevLocalZ = l.z;
    return entered;
  }
}
