import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

// Final "dream lens" pass: barrel distortion, chromatic fringe, grading, vignette, grain.
const DreamShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    distortion: { value: 0.12 },
    chroma: { value: 0.006 },
    vignette: { value: 0.35 },
    grain: { value: 0.035 },
    saturation: { value: 1.15 },
    contrast: { value: 1.04 },
    tint: { value: new THREE.Vector3(1, 1, 1) },
    lift: { value: new THREE.Vector3(0, 0, 0) },
    softGlow: { value: 0.0 },
    vhs: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time, distortion, chroma, vignette, grain, saturation, contrast, softGlow, vhs;
    uniform vec3 tint, lift;
    varying vec2 vUv;

    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float k = distortion;
      vec2 duv = 0.5 + c * (1.0 + k * r2) / (1.0 + k * 0.5);
      vec2 dir = c * chroma * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, duv + dir).r;
      col.g = texture2D(tDiffuse, duv).g;
      col.b = texture2D(tDiffuse, duv - dir).b;

      if (vhs > 0.0) {
        // A clean camcorder recording: full-res luma with a gentle tape
        // softness, chroma at a fraction of the bandwidth that bleeds to the
        // right, a faint line wobble, a rare thin tracking line and the
        // head-switching ragged edge at the very bottom of the frame.
        vec2 px = 1.0 / resolution;
        float scan = vUv.y * resolution.y;
        float line = floor(scan / 2.0);
        float wob = sin(vUv.y * 9.0 + time * 1.3) * 0.35 + (hash(vec2(line, floor(time * 15.0))) - 0.5) * 0.7;
        float bandPos = fract(time * 0.021 + 0.3);
        float band = (1.0 - smoothstep(0.0, 0.006, abs(vUv.y - bandPos))) * step(0.55, fract(time * 0.021 * 3.0));
        float head = 1.0 - smoothstep(0.0, 0.018, vUv.y);
        float off = wob * px.x + band * (hash(vec2(line, time)) - 0.5) * 8.0 * px.x
                  + head * 12.0 * px.x * (hash(vec2(line * 1.7, floor(time * 30.0))) - 0.2);
        vec2 vu = duv + vec2(off, 0.0);
        vec3 a = texture2D(tDiffuse, vu).rgb;
        vec3 b1 = texture2D(tDiffuse, vu + vec2(px.x, 0.0)).rgb;
        vec3 b2 = texture2D(tDiffuse, vu - vec2(px.x, 0.0)).rgb;
        vec3 lumaSrc = a * 0.6 + (b1 + b2) * 0.2;
        float Y = dot(lumaSrc, vec3(0.299, 0.587, 0.114));
        // light sharpening ring, the way camcorder enhancers draw edges
        float Yb = dot((b1 + b2) * 0.5, vec3(0.299, 0.587, 0.114));
        Y += (Y - Yb) * 0.35;
        vec3 cs = vec3(0.0);
        for (int k = 0; k < 6; k++) cs += texture2D(tDiffuse, vu - vec2(float(k) * 1.6 * px.x, 0.0)).rgb;
        cs /= 6.0;
        float I = dot(cs, vec3(0.596, -0.274, -0.322));
        float Q = dot(cs, vec3(0.211, -0.523, 0.312));
        float cn = (hash(vec2(line, floor(time * 30.0) + 3.0)) - 0.5) * 0.012;
        vec3 v = vec3(Y + 0.956 * (I + cn) + 0.621 * Q, Y - 0.272 * (I + cn) - 0.647 * Q, Y - 1.106 * (I + cn) + 1.703 * Q);
        v += (hash(gl_FragCoord.xy * 0.5 + fract(time) * 91.0) - 0.5) * 0.018;
        v += band * 0.08 + head * (hash(gl_FragCoord.xy + time * 3.0) - 0.4) * 0.18;
        v = v * 0.955 + 0.018;                    // slightly lifted blacks, soft whites
        v *= 1.0 - 0.018 * (0.5 + 0.5 * sin(scan * 3.14159));
        col = mix(col, v, vhs);
      }

      if (softGlow > 0.0) {
        // cheap dreamy halation: widen highlights a little
        vec2 px = 2.5 / resolution;
        vec3 g = texture2D(tDiffuse, duv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, duv - vec2(px.x, 0.0)).rgb
               + texture2D(tDiffuse, duv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, duv - vec2(0.0, px.y)).rgb;
        g *= 0.25;
        col += max(g - 0.6, 0.0) * softGlow;
      }

      col = col * tint + lift;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;

      vec2 vc = c * vec2(1.0, 0.85);
      float v = smoothstep(0.95, 0.15, length(vc) * 1.25);
      col *= mix(1.0, v, vignette);

      float n = hash(gl_FragCoord.xy + fract(time * 7.13) * 917.0) - 0.5;
      col += n * grain;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export const DEFAULT_GRADE = {
  exposure: 1.0,
  saturation: 1.15,
  contrast: 1.04,
  tint: [1, 1, 1],
  lift: [0, 0, 0],
  vignette: 0.35,
  distortion: 0.12,
  chroma: 0.0035,
  grain: 0.035,
  bloomStrength: 0.55,
  bloomRadius: 0.6,
  bloomThreshold: 0.82,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.quality = null;
    this.composer = null;
    this.grade = { ...DEFAULT_GRADE };
    this.width = 1;
    this.height = 1;
    this.time = 0;
  }

  configure(q) {
    this.quality = q;
    const r = this.renderer;
    r.shadowMap.enabled = q.shadows;
    r.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    r.shadowMap.needsUpdate = true;
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    const q = this.quality;
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      this.composer.passes.forEach((p) => p.dispose && p.dispose());
    }
    const ext = this.renderer.extensions;
    const halfOk = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    this.halfFloat = halfOk;
    const rt = new THREE.WebGLRenderTarget(4, 4, {
      type: halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: q.msaa,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    const composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(null, null);
    composer.addPass(this.renderPass);
    this.bloomPass = null;
    if (q.bloom && halfOk) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.6, 0.82);
      composer.addPass(this.bloomPass);
    }
    composer.addPass(new OutputPass());
    // Without hardware MSAA, smooth the edges in display space (cheap FXAA).
    if (!q.msaa) composer.addPass(new FXAAPass());
    this.dreamPass = new ShaderPass(DreamShader);
    composer.addPass(this.dreamPass);
    this.composer = composer;
    this.applyGrade(this.grade);
  }

  applyGrade(g) {
    this.grade = { ...DEFAULT_GRADE, ...g };
    const gr = this.grade;
    this.renderer.toneMappingExposure = gr.exposure;
    if (!this.dreamPass) return;
    const u = this.dreamPass.uniforms;
    u.saturation.value = gr.saturation;
    u.contrast.value = gr.contrast;
    u.tint.value.set(...gr.tint);
    u.lift.value.set(...gr.lift);
    u.vignette.value = gr.vignette;
    u.distortion.value = gr.distortion;
    u.chroma.value = gr.chroma;
    u.grain.value = gr.grain;
    u.vhs.value = gr.vhs || 0;
    // Without bloom, emulate a little halation so bright things still glow.
    u.softGlow.value = this.bloomPass ? 0.0 : 0.6;
    if (this.bloomPass) {
      this.bloomPass.strength = gr.bloomStrength;
      this.bloomPass.radius = gr.bloomRadius;
      this.bloomPass.threshold = gr.bloomThreshold;
    }
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality ? this.quality.pixelRatio : 1) * (this.levelScale || 1);
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      this.dreamPass.uniforms.resolution.value.set(w * pr, h * pr);
      if (this.bloomPass) {
        // Bloom at reduced resolution is plenty and much cheaper on phones.
        const s = this.quality.pixelRatio > 1.4 ? 0.5 : 0.6;
        this.bloomPass.setSize(Math.round(w * pr * s), Math.round(h * pr * s));
      }
    }
  }

  render(scene, camera, dt) {
    this.time += dt;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.dreamPass.uniforms.time.value = this.time;
    this.composer.render(dt);
  }
}
