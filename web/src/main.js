import * as THREE from 'three';
import { Renderer } from './core/renderer.js';
import { settings, saveSettings, quality, QUALITY_PRESETS, progress, saveProgress, isMobile } from './core/settings.js';
import { Input } from './core/input.js';
import { Player } from './core/player.js';
import { AudioSystem } from './core/audio.js';
import { setMaxAnisotropy } from './core/textures.js';
import { LEVELS } from './levels/index.js';

const $ = (id) => document.getElementById(id);
const bridge = window.AndroidBridge || null;

const QUALITY_DESC = {
  low: 'Без теней и свечения, мало травы. Для слабых телефонов.',
  medium: 'Тени, свечение, умеренная трава. Баланс для большинства телефонов.',
  high: 'Мягкие тени, сглаживание, густая трава. Для мощных телефонов.',
  ultra: 'Максимум: тени 4K, очень густая трава, полное разрешение.',
};

class Game {
  constructor() {
    this.canvas = $('view');
    this.renderer = new Renderer(this.canvas);
    this.renderer.configure(quality());
    setMaxAnisotropy(Math.min(8, this.renderer.renderer.capabilities.getMaxAnisotropy()));
    this.camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.audio = new AudioSystem();
    this.audio.setVolumes(settings.music, settings.sfx);
    this.input = new Input($('touch-layer'), { stickEl: $('stick'), knobEl: $('stick-knob') });
    this.player = new Player(this.camera);
    this.player.onStep = (pos, speed) => {
      if (!this.level) return;
      this.audio.footstep(this.level.surface(pos.x, pos.z), speed);
    };
    this.state = 'boot';
    this.level = null;
    this.levelIndex = -1;
    this.clock = new THREE.Clock();
    this.fps = { frames: 0, time: 0, value: 60, low: 0, high: 0 };
    this.dynScale = 1;
    this.menuTime = 0;
    this.transitioning = false;

    window.addEventListener('resize', () => this.onResize());
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.applyQuality();
    });
    this.bindUi();
    window.__appPause = () => this.onAppPause();
    window.__appResume = () => this.onAppResume();
    window.__appBack = () => this.onBack();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.onAppPause(); else this.onAppResume();
    });
    // unlock audio on first interaction anywhere
    const unlock = () => this.audio.unlock();
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('mousedown', unlock);
    window.addEventListener('keydown', unlock);
  }

  // ------------------------------------------------------------------ levels
  ctx() {
    return { q: quality(), renderer: this.renderer, camera: this.camera };
  }

  loadLevel(index) {
    if (this.level) {
      this.level.dispose();
      this.level = null;
    }
    this.levelIndex = index;
    const def = LEVELS[index];
    const level = def.build(this.ctx(), def);
    this.level = level;
    this.renderer.applyGrade(level.grade);
    this.camera.far = level.far || 1000;
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.player.spawn(level);
    if (level.door) {
      level.door.onOpen = () => {
        this.audio.doorCreak();
        this.vibrate(30);
      };
    }
    for (const d of level.decoys) d.onLocked = () => this.audio.locked();
    // warm up shaders so the first frames don't hitch
    try { this.renderer.renderer.compile(level.scene, this.camera); } catch (e) { /* ignore */ }
    return level;
  }

  // ------------------------------------------------------------------ flow
  async boot() {
    const start = Math.min(progress.current || 0, LEVELS.length - 1);
    await nextFrame();
    this.loadLevel(start);
    this.state = 'menu';
    this.showMenu();
    this.audio.playMusic('drowsy');
    this.loop();
    await nextFrame();
    $('loading').classList.add('gone');
  }

  showMenu() {
    this.state = 'menu';
    this.input.enabled = false;
    this.input.reset();
    $('hud').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('menu').classList.remove('hidden');
    const has = (progress.current || 0) > 0 || progress.loops > 0;
    $('btn-continue').classList.toggle('hidden', !has);
    $('btn-start').textContent = has ? 'Начать заново' : 'Начать сон';
    $('btn-exit').classList.toggle('hidden', !bridge);
    this.menuTime = 0;
    this.audio.setHum(0);
    this.audio.setAmbience(null);
  }

  startGame(index) {
    this.audio.unlock();
    this.audio.click();
    $('menu').classList.add('hidden');
    $('levels').classList.add('hidden');
    this.fadeTo(true, () => {
      if (index !== this.levelIndex) this.loadLevel(index);
      else this.player.spawn(this.level);
      progress.current = index;
      saveProgress();
      this.beginPlay();
    });
  }

  beginPlay() {
    this.state = 'playing';
    this.input.enabled = true;
    $('hud').classList.remove('hidden');
    this.audio.playMusic(this.level.music);
    this.audio.setAmbience(this.level.ambience);
    this.fadeTo(false);
    this.showTitle();
    if (!progress.hinted) {
      progress.hinted = true;
      saveProgress();
      this.showHint(isMobile || this.input.usedTouch
        ? 'левый палец — идти   ·   правый — смотреть'
        : 'WASD — идти   ·   мышь — смотреть   ·   Shift — бежать');
    }
  }

  showTitle() {
    const def = LEVELS[this.levelIndex];
    const el = $('level-title');
    el.querySelector('.lt-num').textContent = roman(this.levelIndex + 1);
    el.querySelector('.lt-name').textContent = def.title;
    el.classList.add('show');
    clearTimeout(this.titleTimer);
    this.titleTimer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  showHint(text) {
    const el = $('hint');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => el.classList.remove('show'), 7000);
  }

  onDoorEnter() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.state = 'transition';
    this.input.enabled = false;
    this.input.reset();
    this.audio.whoosh();
    this.vibrate(60);
    let next = this.levelIndex + 1;
    if (next >= LEVELS.length) { next = 0; progress.loops = (progress.loops || 0) + 1; }
    progress.unlocked = Math.max(progress.unlocked || 1, Math.min(LEVELS.length, next + 1));
    if (progress.loops > 0) progress.unlocked = LEVELS.length;
    progress.current = next;
    saveProgress();
    this.fadeTo(true, () => {
      this.loadLevel(next);
      this.transitioning = false;
      this.beginPlay();
    }, 1400);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.reset();
    $('pause').classList.remove('hidden');
    this.audio.duck = 0.45;
    this.audio.setHum(0);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resume() {
    $('pause').classList.add('hidden');
    $('settings').classList.add('hidden');
    this.state = 'playing';
    this.input.enabled = true;
    this.audio.duck = 1;
    this.clock.getDelta();
  }

  toMenu() {
    this.audio.duck = 1;
    $('pause').classList.add('hidden');
    this.fadeTo(true, () => {
      this.showMenu();
      this.audio.playMusic('drowsy');
      this.fadeTo(false);
    }, 700);
  }

  fadeTo(on, then, delay = 1250) {
    const f = $('fade');
    f.classList.toggle('on', on);
    if (then) setTimeout(then, delay);
  }

  onAppPause() {
    if (this.state === 'playing') this.pause();
    this.audio.pauseAll();
  }

  onAppResume() {
    this.audio.resumeAll();
    this.clock.getDelta();
  }

  onBack() {
    if (!$('settings').classList.contains('hidden')) { this.closeSettings(); return true; }
    if (!$('levels').classList.contains('hidden')) { $('levels').classList.add('hidden'); $('menu').classList.remove('hidden'); return true; }
    if (this.state === 'playing') { this.pause(); return true; }
    if (this.state === 'paused') { this.resume(); return true; }
    return false;
  }

  vibrate(ms) {
    try { if (bridge) bridge.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ ui
  bindUi() {
    const tap = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); this.audio.unlock(); fn(); });
    tap('btn-start', () => {
      progress.current = 0;
      saveProgress();
      this.startGame(0);
    });
    tap('btn-continue', () => this.startGame(Math.min(progress.current || 0, LEVELS.length - 1)));
    tap('btn-levels', () => { this.audio.click(); this.openLevels(); });
    tap('btn-settings', () => { this.audio.click(); this.openSettings('menu'); });
    tap('btn-exit', () => { if (bridge) bridge.exitApp(); });
    tap('btn-pause', () => { this.audio.click(); this.pause(); });
    tap('btn-resume', () => { this.audio.click(); this.resume(); });
    tap('btn-pause-settings', () => { this.audio.click(); this.openSettings('pause'); });
    tap('btn-to-menu', () => { this.audio.click(); this.toMenu(); });
    tap('btn-settings-back', () => { this.audio.click(); this.closeSettings(); });
    tap('btn-levels-back', () => { this.audio.click(); $('levels').classList.add('hidden'); $('menu').classList.remove('hidden'); });

    document.querySelectorAll('#quality-seg .seg-btn').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio.click();
        if (settings.quality === b.dataset.q) return;
        settings.quality = b.dataset.q;
        saveSettings();
        this.refreshSettings();
        this.applyQuality();
      });
    });
    const slider = (id, key, fn) => {
      const el = $(id);
      el.addEventListener('input', () => { settings[key] = parseFloat(el.value); saveSettings(); if (fn) fn(); });
    };
    slider('set-music', 'music', () => this.audio.setVolumes(settings.music, settings.sfx));
    slider('set-sfx', 'sfx', () => this.audio.setVolumes(settings.music, settings.sfx));
    slider('set-sens', 'sensitivity');
    slider('set-fov', 'fov', () => {
      this.camera.fov = settings.fov; this.camera.updateProjectionMatrix(); $('fov-val').textContent = settings.fov + '°';
    });
    const toggle = (id, key, fn) => tap(id, () => {
      settings[key] = !settings[key]; saveSettings(); this.audio.click(); this.refreshSettings(); if (fn) fn();
    });
    toggle('set-bob', 'headBob');
    toggle('set-invert', 'invertY');
    toggle('set-fps', 'showFps', () => { if (!settings.showFps) $('fps').textContent = ''; });
    // keyboard shortcuts on desktop
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused' && $('settings').classList.contains('hidden')) this.resume();
      }
    });
  }

  openSettings(from) {
    this.settingsFrom = from;
    $('menu').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('settings').classList.remove('hidden');
    this.refreshSettings();
  }

  closeSettings() {
    $('settings').classList.add('hidden');
    if (this.settingsFrom === 'pause') $('pause').classList.remove('hidden');
    else $('menu').classList.remove('hidden');
  }

  refreshSettings() {
    document.querySelectorAll('#quality-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.q === settings.quality));
    $('quality-desc').textContent = QUALITY_DESC[settings.quality];
    $('set-music').value = settings.music;
    $('set-sfx').value = settings.sfx;
    $('set-sens').value = settings.sensitivity;
    $('set-fov').value = settings.fov;
    $('fov-val').textContent = settings.fov + '°';
    $('set-bob').classList.toggle('on', settings.headBob);
    $('set-invert').classList.toggle('on', settings.invertY);
    $('set-fps').classList.toggle('on', settings.showFps);
  }

  applyQuality() {
    this.dynScale = 1;
    this.renderer.configure(QUALITY_PRESETS[settings.quality]);
    if (this.level) {
      const p = this.player.pos.clone();
      const yaw = this.player.yaw, pitch = this.player.pitch;
      this.loadLevel(this.levelIndex);
      if (this.state !== 'menu') {
        this.player.pos.copy(p);
        this.player.groundY = this.level.groundHeight(p.x, p.z);
        this.player.yaw = yaw; this.player.pitch = pitch;
      }
    }
  }

  openLevels() {
    $('menu').classList.add('hidden');
    $('levels').classList.remove('hidden');
    const grid = $('level-grid');
    grid.innerHTML = '';
    LEVELS.forEach((def, i) => {
      const unlocked = i < (progress.unlocked || 1);
      const b = document.createElement('button');
      b.className = 'level-card' + (unlocked ? '' : ' locked');
      b.style.background = def.card;
      b.innerHTML = `<div class="n">${roman(i + 1)}</div><div class="t">${unlocked ? def.title : '? ? ?'}</div>`;
      if (unlocked) b.addEventListener('click', (e) => { e.stopPropagation(); this.startGame(i); });
      grid.appendChild(b);
    });
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.resize();
  }

  // ------------------------------------------------------------------ loop
  loop() {
    if (this.manual) return;
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    this.frame(dt);
  }

  // debug/testing helper: advance the simulation without requestAnimationFrame
  stepFrames(n, dt = 1 / 30) {
    this.manual = true;
    for (let i = 0; i < n; i++) this.frame(dt, i < n - 1);
  }

  frame(dt, skipRender = false) {
    if (!this.level || this.contextLost) return;
    const lv = this.level;

    if (this.state === 'playing') {
      this.player.update(dt, this.input, settings);
      const d = lv.door;
      if (d) {
        if (d.update(dt, this.player.pos)) this.onDoorEnter();
        this.audio.setHum(1 - Math.min(1, d.distance / 22));
      }
      for (const x of lv.decoys) x.update(dt, this.player.pos);
    } else if (this.state === 'menu') {
      this.menuTime += dt;
      const m = lv.menuCam || { x: lv.spawn.x, z: lv.spawn.z, yaw: lv.spawn.yaw, y: 1.7, pitch: 0.05 };
      const t = this.menuTime;
      this.player.pos.set(m.x, lv.groundHeight(m.x, m.z), m.z);
      this.camera.position.set(m.x + Math.sin(t * 0.05) * 1.5, this.player.pos.y + (m.y || 1.7) + Math.sin(t * 0.3) * 0.05, m.z + Math.cos(t * 0.04) * 1.0);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = m.yaw + Math.sin(t * 0.07) * 0.35;
      this.camera.rotation.x = (m.pitch || 0.05) + Math.sin(t * 0.11) * 0.03;
      this.camera.rotation.z = 0;
      if (lv.door) lv.door.update(dt, new THREE.Vector3(1e4, 0, 1e4));
    } else if (this.state === 'transition') {
      // keep drifting forward into the light
      this.player.pos.x += -Math.sin(this.player.yaw) * dt * 1.2;
      this.player.pos.z += -Math.cos(this.player.yaw) * dt * 1.2;
      this.player.updateCamera(dt, 0);
      if (lv.door) lv.door.update(dt, this.player.pos);
    }
    if (this.state !== 'paused') lv.update(dt, this.player);
    this.audio.update(dt);
    if (skipRender) return;
    this.renderer.render(lv.scene, this.camera, dt);
    this.trackFps(dt);
  }

  trackFps(dt) {
    const f = this.fps;
    f.frames++;
    f.time += dt;
    if (f.time >= 1) {
      f.value = f.frames / f.time;
      f.frames = 0; f.time = 0;
      if (settings.showFps) $('fps').textContent = Math.round(f.value) + ' fps';
      // adaptive resolution: keep things smooth on slower phones
      if (this.state === 'playing' || this.state === 'menu') {
        if (f.value < 26) f.low++; else f.low = 0;
        if (f.value > 50) f.high++; else f.high = 0;
        if (f.low >= 3 && this.dynScale > 0.6) {
          this.dynScale = Math.max(0.6, this.dynScale - 0.1);
          f.low = 0;
          this.applyDynScale();
        } else if (f.high >= 8 && this.dynScale < 1) {
          this.dynScale = Math.min(1, this.dynScale + 0.1);
          f.high = 0;
          this.applyDynScale();
        }
      }
    }
  }

  applyDynScale() {
    const base = QUALITY_PRESETS[settings.quality];
    this.renderer.quality = { ...base, pixelRatio: base.pixelRatio * this.dynScale };
    this.renderer.resize();
  }
}

function roman(n) {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] || String(n);
}

function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }

let game;
try {
  game = new Game();
} catch (e) {
  console.error(e);
  const l = document.querySelector('.loading-text');
  if (l) l.textContent = 'WebGL недоступен на этом устройстве';
  throw e;
}
window.__game = game;
game.boot().catch((e) => {
  console.error(e);
  const l = document.querySelector('.loading-text');
  if (l) l.textContent = 'ошибка: ' + e.message;
});
