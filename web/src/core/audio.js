// Music (streamed <audio> with crossfades) + synthesized SFX and ambience (WebAudio).

export const TRACKS = {
  drowsy: 'audio/drowsy.mp3',
  comfort: 'audio/comfort.mp3',
  sixfortyseven: 'audio/sixfortyseven.mp3',
  numbers: 'audio/numbers.mp3',
  pastel: 'audio/pastel_lullaby.mp3',
  aqua: 'audio/aqua_halls.mp3',
  heaven: 'audio/cloud_choir.mp3',
};

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.8;
    this.sfxVol = 0.9;
    this.current = null; // {name, el, vol, target}
    this.fading = [];
    this.ambient = null;
    this.humGain = null;
    this.paused = false;
    this.duck = 1;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.sfxVol;
      this.master.connect(ctx.destination);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(3.2, 2.6);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.6;
      this.reverbSend.connect(this.reverb);
      this.reverb.connect(this.master);
      this.noiseBuf = this.makeNoise(2.0);
      this.startHum();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (this.current && this.current.el.paused && !this.paused) this.current.el.play().catch(() => {});
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      // soft pink-ish noise
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return buf;
  }

  setVolumes(music, sfx) {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (this.master) this.master.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- music
  playMusic(name, fade = 2.5) {
    if (this.current && this.current.name === name) return;
    if (this.current) {
      this.current.fadeOut = fade;
      this.fading.push(this.current);
      this.current = null;
    }
    const src = TRACKS[name];
    if (!src) return;
    const el = new Audio(src);
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    const entry = { name, el, vol: 0, fadeIn: fade };
    this.current = entry;
    if (!this.paused) el.play().catch(() => { /* will retry on unlock */ });
  }

  update(dt) {
    const target = this.musicVol * this.duck;
    if (this.current) {
      const c = this.current;
      c.vol = Math.min(target, c.vol + dt / Math.max(0.1, c.fadeIn) * Math.max(0.01, target));
      if (c.vol > target) c.vol = target;
      c.el.volume = Math.max(0, Math.min(1, c.vol));
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      f.vol -= dt / Math.max(0.1, f.fadeOut) * Math.max(0.05, this.musicVol);
      if (f.vol <= 0) {
        f.el.pause();
        f.el.removeAttribute('src');
        f.el.load();
        this.fading.splice(i, 1);
      } else f.el.volume = Math.max(0, Math.min(1, f.vol));
    }
  }

  pauseAll() {
    this.paused = true;
    if (this.current) this.current.el.pause();
    for (const f of this.fading) f.el.pause();
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resumeAll() {
    this.paused = false;
    if (this.current) this.current.el.play().catch(() => {});
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  // ---------------------------------------------------------------- sfx helpers
  noiseSource(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    if (!loop) s.loopStart = 0;
    return s;
  }

  env(gainNode, t, a, peak, d) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  footstep(surface = 'grass', speed = 3) {
    if (!this.ctx || this.paused) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const cfg = {
      grass: { f: 2600, q: 0.6, type: 'bandpass', g: 0.16, d: 0.16, thump: 0.0, verb: 0.02 },
      dirt: { f: 1300, q: 0.9, type: 'bandpass', g: 0.2, d: 0.12, thump: 0.08, verb: 0.03 },
      wood: { f: 900, q: 1.2, type: 'bandpass', g: 0.14, d: 0.07, thump: 0.35, verb: 0.35 },
      concrete: { f: 2000, q: 1.0, type: 'bandpass', g: 0.16, d: 0.06, thump: 0.12, verb: 0.08 },
      tile: { f: 3200, q: 1.4, type: 'bandpass', g: 0.14, d: 0.05, thump: 0.18, verb: 0.55 },
      water: { f: 900, q: 0.7, type: 'bandpass', g: 0.35, d: 0.28, thump: 0.05, verb: 0.4 },
      cloud: { f: 500, q: 0.5, type: 'lowpass', g: 0.15, d: 0.22, thump: 0.0, verb: 0.3 },
      rubber: { f: 600, q: 0.8, type: 'lowpass', g: 0.2, d: 0.08, thump: 0.25, verb: 0.05 },
    }[surface] || { f: 2000, q: 1, type: 'bandpass', g: 0.15, d: 0.1, thump: 0.1, verb: 0.1 };
    const vary = 0.85 + Math.random() * 0.3;
    const src = this.noiseSource();
    const filt = ctx.createBiquadFilter();
    filt.type = cfg.type;
    filt.frequency.value = cfg.f * vary;
    filt.Q.value = cfg.q;
    const g = ctx.createGain();
    const loud = cfg.g * (0.7 + Math.min(1, speed / 5) * 0.5);
    this.env(g, t, 0.008, loud, cfg.d * vary);
    src.connect(filt).connect(g);
    g.connect(this.master);
    if (cfg.verb) {
      const s = ctx.createGain(); s.gain.value = cfg.verb; g.connect(s).connect(this.reverbSend);
    }
    src.start(t, Math.random() * 1.5, cfg.d + 0.1);
    if (surface === 'water') {
      // splashy second burst
      const s2 = this.noiseSource();
      const f2 = ctx.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = 2500;
      const g2 = ctx.createGain(); this.env(g2, t + 0.05, 0.02, 0.12, 0.25);
      s2.connect(f2).connect(g2).connect(this.master);
      s2.start(t + 0.05, Math.random(), 0.4);
    }
    if (cfg.thump) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140 * vary, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
      const og = ctx.createGain();
      this.env(og, t, 0.005, cfg.thump * loud * 2, 0.1);
      o.connect(og).connect(this.master);
      if (cfg.verb) { const s = ctx.createGain(); s.gain.value = cfg.verb; og.connect(s).connect(this.reverbSend); }
      o.start(t); o.stop(t + 0.2);
    }
  }

  chime(baseFreq = 660, vol = 0.18) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const partials = [1, 2.0, 2.76, 4.07, 5.4];
    partials.forEach((p, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = baseFreq * p * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      this.env(g, t + i * 0.015, 0.01, vol / (i + 1), 2.5 - i * 0.3);
      o.connect(g);
      g.connect(this.master);
      const s = ctx.createGain(); s.gain.value = 0.8; g.connect(s).connect(this.reverbSend);
      o.start(t); o.stop(t + 3.2);
    });
  }

  doorCreak() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    for (let i = 1; i < 14; i++) o.frequency.linearRampToValueAtTime(60 + Math.random() * 90, t + i * 0.1);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.2);
    g.gain.linearRampToValueAtTime(0.03, t + 1.0);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.5);
    o.connect(bp).connect(g).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s).connect(this.reverbSend);
    o.start(t); o.stop(t + 1.6);
    // latch click
    const c = this.noiseSource();
    const cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 3000;
    const cg = ctx.createGain(); this.env(cg, t, 0.002, 0.3, 0.04);
    c.connect(cf).connect(cg).connect(this.master);
    c.start(t, 0, 0.08);
    this.chime(523.25, 0.12);
    setTimeout(() => this.chime(783.99, 0.08), 380);
  }

  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.noiseSource(true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.exponentialRampToValueAtTime(5000, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    src.connect(bp).connect(g).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.7; g.connect(s).connect(this.reverbSend);
    src.start(t); src.stop(t + 2.3);
    // bright swell chord
    [261.63, 329.63, 392.0, 523.25, 659.25].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.05, t + 1.0 + i * 0.05);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
      o.connect(og); og.connect(this.reverbSend); og.connect(this.master);
      o.start(t); o.stop(t + 3.1);
    });
  }

  click() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1320, t + 0.05);
    const g = ctx.createGain(); this.env(g, t, 0.005, 0.08, 0.15);
    o.connect(g).connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.4; g.connect(s).connect(this.reverbSend);
    o.start(t); o.stop(t + 0.25);
  }

  locked() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const c = this.noiseSource();
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 3;
      const g = ctx.createGain(); this.env(g, t + i * 0.09, 0.003, 0.25, 0.06);
      c.connect(f).connect(g).connect(this.master);
      c.start(t + i * 0.09, Math.random(), 0.1);
    }
  }

  // door proximity hum: two detuned sines
  startHum() {
    const ctx = this.ctx;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    [220, 330.6, 440.8].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = i === 2 ? 0.15 : 0.3;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.2 + i * 0.13;
      const lg = ctx.createGain(); lg.gain.value = 0.12;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(lp);
      o.start(); lfo.start();
    });
    lp.connect(this.humGain);
    this.humGain.connect(this.master);
    const s = ctx.createGain(); s.gain.value = 0.6; this.humGain.connect(s).connect(this.reverbSend);
  }

  setHum(level) {
    if (!this.humGain) return;
    this.humGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.07, this.ctx.currentTime, 0.3);
  }

  // ---------------------------------------------------------------- ambience
  setAmbience(type) {
    if (!this.ctx) { this.pendingAmbience = type; return; }
    const ctx = this.ctx, t = ctx.currentTime;
    if (this.ambient) {
      const old = this.ambient;
      old.gain.gain.setTargetAtTime(0.0001, t, 0.6);
      setTimeout(() => { old.stop(); }, 3000);
      this.ambient = null;
    }
    if (!type) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.master);
    const nodes = [];
    const timers = [];
    const noise = (ftype, freq, q, vol, lfoRate = 0.07) => {
      const s = this.noiseSource(true);
      const f = ctx.createBiquadFilter(); f.type = ftype; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = vol;
      const lfo = ctx.createOscillator(); lfo.frequency.value = lfoRate;
      const lg = ctx.createGain(); lg.gain.value = vol * 0.6;
      lfo.connect(lg).connect(g.gain);
      s.connect(f).connect(g).connect(gain);
      s.start(); lfo.start();
      nodes.push(s, lfo);
    };
    const every = (minS, maxS, fn) => {
      const h = { id: 0 };
      timers.push(h);
      const loop = () => {
        h.id = setTimeout(() => { if (!this.paused) fn(); loop(); }, (minS + Math.random() * (maxS - minS)) * 1000);
      };
      loop();
    };
    const bird = () => {
      const t0 = ctx.currentTime;
      const n = 2 + Math.floor(Math.random() * 4);
      const base = 2500 + Math.random() * 1800;
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator(); o.type = 'sine';
        const st = t0 + i * (0.09 + Math.random() * 0.05);
        o.frequency.setValueAtTime(base, st);
        o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), st + 0.06);
        const g = ctx.createGain(); this.env(g, st, 0.01, 0.025, 0.07);
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (pan) { pan.pan.value = Math.random() * 2 - 1; o.connect(g).connect(pan).connect(gain); } else o.connect(g).connect(gain);
        const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s).connect(this.reverbSend);
        o.start(st); o.stop(st + 0.15);
      }
    };
    const drip = () => {
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      const f = 1200 + Math.random() * 1800;
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * 1.8, t0 + 0.04);
      const g = ctx.createGain(); this.env(g, t0, 0.003, 0.05, 0.12);
      o.connect(g); g.connect(gain);
      const s = ctx.createGain(); s.gain.value = 1.2; g.connect(s).connect(this.reverbSend);
      o.start(t0); o.stop(t0 + 0.2);
    };
    const cricket = () => {
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4200 + Math.random() * 600;
      const g = ctx.createGain(); g.gain.value = 0;
      for (let i = 0; i < 6; i++) {
        g.gain.setValueAtTime(0, t0 + i * 0.05);
        g.gain.linearRampToValueAtTime(0.012, t0 + i * 0.05 + 0.01);
        g.gain.linearRampToValueAtTime(0, t0 + i * 0.05 + 0.035);
      }
      o.connect(g).connect(gain);
      o.start(t0); o.stop(t0 + 0.4);
    };
    const hum = (f, vol) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = vol;
      o.connect(g).connect(gain); o.start(); nodes.push(o);
    };

    let level = 0.8;
    switch (type) {
      case 'meadow':
        noise('lowpass', 420, 0.5, 0.25, 0.05);
        noise('bandpass', 1800, 0.4, 0.03, 0.09);
        every(2.5, 7, bird);
        break;
      case 'field':
        noise('lowpass', 600, 0.5, 0.3, 0.06);
        noise('bandpass', 3000, 0.5, 0.025, 0.11);
        every(4, 10, bird);
        break;
      case 'gym':
        noise('lowpass', 180, 0.7, 0.35, 0.02);
        hum(60, 0.012); hum(120, 0.006);
        level = 0.7;
        break;
      case 'suburb':
        noise('lowpass', 300, 0.5, 0.22, 0.04);
        every(0.6, 2.2, cricket);
        break;
      case 'pool':
        noise('bandpass', 380, 0.8, 0.35, 0.08);
        noise('highpass', 5000, 0.3, 0.01, 0.2);
        every(0.8, 3.0, drip);
        hum(48, 0.008);
        break;
      case 'clouds':
        noise('bandpass', 900, 0.4, 0.12, 0.03);
        noise('lowpass', 200, 0.5, 0.25, 0.02);
        break;
      case 'playground':
        noise('lowpass', 500, 0.5, 0.2, 0.05);
        every(3, 8, bird);
        break;
      default:
        noise('lowpass', 400, 0.5, 0.2);
    }
    gain.gain.setTargetAtTime(level, t, 1.5);
    this.ambient = {
      gain,
      stop: () => {
        timers.forEach((h) => clearTimeout(h.id));
        timers.length = 0;
        nodes.forEach((n) => { try { n.stop(); } catch (e) { /* ignore */ } });
        gain.disconnect();
      },
      timers,
    };
  }
}
