// Persistent settings and graphics presets.

export const QUALITY_PRESETS = {
  low: {
    label: 'Низкая',
    pixelRatio: 0.8,
    shadows: false,
    shadowSize: 0,
    softShadows: false,
    msaa: 0,
    bloom: false,
    grass: 0.22,
    detail: 0.45,
    drawDistance: 0.7,
    envSize: 64,
    particles: 0.4,
  },
  medium: {
    label: 'Средняя',
    pixelRatio: 1.1,
    shadows: true,
    shadowSize: 1024,
    softShadows: false,
    msaa: 0,
    bloom: true,
    grass: 0.45,
    detail: 0.7,
    drawDistance: 0.85,
    envSize: 128,
    particles: 0.7,
  },
  high: {
    label: 'Высокая',
    pixelRatio: 1.5,
    shadows: true,
    shadowSize: 2048,
    softShadows: true,
    msaa: 4,
    bloom: true,
    grass: 1.0,
    detail: 1.0,
    drawDistance: 1.0,
    envSize: 256,
    particles: 1.0,
  },
  ultra: {
    label: 'Ультра',
    pixelRatio: 2.0,
    shadows: true,
    shadowSize: 4096,
    softShadows: true,
    msaa: 4,
    bloom: true,
    grass: 1.6,
    detail: 1.35,
    drawDistance: 1.2,
    envSize: 256,
    particles: 1.4,
  },
};

const KEY = 'dreamcore-vibe-settings-v1';
const PROGRESS_KEY = 'dreamcore-vibe-progress-v1';

const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

const DEFAULTS = {
  quality: isMobile ? 'medium' : 'high',
  music: 0.8,
  sfx: 0.9,
  sensitivity: 1.0,
  fov: 72,
  showFps: false,
  invertY: false,
  headBob: true,
};

function load(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch (e) { /* storage unavailable */ }
  return { ...defaults };
}

export const settings = load(KEY, DEFAULTS);
if (!QUALITY_PRESETS[settings.quality]) settings.quality = DEFAULTS.quality;

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

export function quality() {
  return QUALITY_PRESETS[settings.quality];
}

export const progress = load(PROGRESS_KEY, { unlocked: 1, current: 0, loops: 0 });

export function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ }
}

export { isMobile };
