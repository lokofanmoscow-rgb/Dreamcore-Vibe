import * as meadow from './meadow.js';
import * as sunflowers from './sunflowers.js';
import * as gym from './gym.js';
import * as suburb from './suburb.js';
import * as pool from './pool.js';
import * as clouds from './clouds.js';
import * as playground from './playground.js';
import * as bridge from './bridge.js';
import * as store from './store.js';
import * as courtyard from './courtyard.js';
import * as backrooms from './backrooms.js';
import * as hills from './hills.js';

// Level list. `card` is the gradient used in the level select screen.
export const LEVELS = [
  {
    id: 'meadow', title: 'Ты дома', music: 'comfort', ambience: 'meadow', build: meadow.build,
    card: 'linear-gradient(160deg, #3f93ee 0%, #9fd8ff 45%, #7ccf4a 100%)',
    grade: { saturation: 1.22, contrast: 1.05, tint: [1.02, 1.0, 0.97], vignette: 0.32, bloomStrength: 0.45, bloomThreshold: 0.85 },
  },
  {
    id: 'sunflowers', title: 'Три луны', music: 'numbers', ambience: 'field', build: sunflowers.build,
    card: 'linear-gradient(160deg, #5aa3dc 0%, #a9d3ec 40%, #ffc83a 70%, #c98a4a 100%)',
    grade: { saturation: 1.18, contrast: 1.04, tint: [1.03, 1.0, 0.94], vignette: 0.34, bloomStrength: 0.4, bloomThreshold: 0.86, lift: [0.01, 0.01, 0.02] },
  },
  {
    id: 'gym', title: 'Пустой спортзал', music: 'sixfortyseven', ambience: 'gym', build: gym.build,
    card: 'linear-gradient(160deg, #fff0d0 0%, #e8b878 45%, #b8622c 100%)',
    grade: { saturation: 1.15, contrast: 1.05, tint: [1.06, 1.0, 0.9], vignette: 0.42, bloomStrength: 0.6, bloomThreshold: 0.82, bloomRadius: 0.7 },
  },
  {
    id: 'suburb', title: 'Вечер, которого не было', music: 'drowsy', ambience: 'suburb', build: suburb.build,
    card: 'linear-gradient(160deg, #3a2a78 0%, #a560b4 45%, #ffb08a 100%)',
    grade: { saturation: 1.2, contrast: 1.06, tint: [1.04, 0.96, 1.0], vignette: 0.42, bloomStrength: 0.55, bloomThreshold: 0.86 },
  },
  {
    id: 'pool', title: 'Бассейны', music: 'aqua', ambience: 'pool', build: pool.build,
    card: 'linear-gradient(160deg, #f4fbfa 0%, #b9cfca 50%, #2c4a46 100%)',
    grade: { saturation: 0.95, contrast: 1.08, tint: [0.97, 1.02, 1.02], vignette: 0.42, bloomStrength: 0.6, bloomThreshold: 0.8, exposure: 1.0, distortion: 0.12, grain: 0.04 },
  },
  {
    id: 'clouds', title: 'Над облаками', music: 'heaven', ambience: 'clouds', build: clouds.build,
    card: 'linear-gradient(160deg, #7f9cff 0%, #f3b4dc 50%, #ffe2c6 100%)',
    grade: { saturation: 1.15, contrast: 1.04, tint: [1.03, 0.99, 1.02], vignette: 0.28, bloomStrength: 0.5, bloomThreshold: 0.88, exposure: 0.95 },
  },
  {
    id: 'playground', title: 'Площадка', music: 'pastel', ambience: 'playground', build: playground.build,
    card: 'linear-gradient(160deg, #3aa0f4 0%, #ff9cc4 50%, #ffd84a 100%)',
    grade: { saturation: 1.25, contrast: 1.05, tint: [1.02, 1.0, 0.98], vignette: 0.3, bloomStrength: 0.45, bloomThreshold: 0.85 },
  },
  {
    id: 'bridge', title: 'Мост в никуда', music: 'fogbridge', ambience: 'bridge', build: bridge.build,
    card: 'linear-gradient(160deg, #8fa2ae 0%, #b7c6cd 50%, #4a565e 100%)',
    grade: { saturation: 0.9, contrast: 1.05, tint: [0.97, 1.0, 1.03], vignette: 0.32, bloomStrength: 0.35, bloomThreshold: 0.9, distortion: 0.1 },
  },
  {
    id: 'store', title: 'Пустой магазин', music: 'mall', ambience: 'mall', build: store.build,
    card: 'repeating-conic-gradient(#b8263a 0 25%, #e6ceb0 0 50%) 0 0 / 40px 40px',
    grade: { saturation: 1.0, contrast: 1.06, tint: [0.98, 1.02, 0.98], vignette: 0.45, bloomStrength: 0.45, bloomThreshold: 0.85, grain: 0.05 },
  },
  {
    id: 'courtyard', title: 'Двор-колодец', music: 'courtyard', ambience: 'courtyard', build: courtyard.build,
    card: 'linear-gradient(160deg, #5d5a78 0%, #c4bccb 60%, #6a7a5a 100%)',
    grade: { saturation: 0.95, contrast: 1.05, tint: [1.0, 0.98, 1.03], vignette: 0.38, bloomStrength: 0.55, bloomThreshold: 0.82 },
  },
  {
    id: 'backrooms', title: 'Подвал', music: 'backrooms', ambience: 'backrooms', build: backrooms.build,
    card: 'linear-gradient(160deg, #e8d89a 0%, #b8a870 50%, #3a3422 100%)',
    grade: { saturation: 1.0, contrast: 1.08, tint: [1.04, 1.0, 0.9], vignette: 0.5, bloomStrength: 0.5, bloomThreshold: 0.82, grain: 0.06 },
  },
  {
    id: 'hills', title: 'Старые холмы', music: 'retro', ambience: 'meadow', build: hills.build,
    card: 'linear-gradient(160deg, #2f6ec0 0%, #c6dcef 45%, #a8ac62 100%)',
    grade: { saturation: 0.92, contrast: 0.96, tint: [1.02, 1.0, 0.96], vignette: 0.22, bloomStrength: 0.25, bloomThreshold: 0.92, distortion: 0.0, chroma: 0.0, grain: 0.02 },
  },
];
