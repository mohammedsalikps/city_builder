import * as THREE from 'three';
import { hash2, seededRandom, tileFbm } from '../noise';

/**
 * Procedural, tileable surface textures painted once on a canvas.
 *
 * They are luminance detail maps (near-neutral grey): the hue comes from
 * the material colour or the vertex colours, the texture adds the brick
 * courses, tile rows, planks, grain and grit that make a surface read as a
 * material. Small (256 px) and generated at boot, so nothing is downloaded.
 */
export type TextureId =
  | 'plaster'
  | 'concrete'
  | 'stone'
  | 'brick'
  | 'clay'
  | 'roof'
  | 'wood'
  | 'trim'
  | 'asphalt'
  | 'grass'
  | 'soil'
  | 'bark'
  | 'foliage'
  | 'fabric';

type Painter = (x: number, y: number, size: number, rand: () => number) => number;

const clamp = (v: number) => Math.max(0, Math.min(255, v));

const PAINTERS: Record<TextureId, Painter> = {
  plaster: (x, y, s, r) => 232 + 18 * tileFbm(x, y, s, 4, 1) + 6 * (r() - 0.5),
  concrete: (x, y, s, r) => 214 + 22 * tileFbm(x, y, s, 4, 2) + 10 * tileFbm(x, y, s, 32, 3) + (r() < 0.02 ? -28 : 0),
  clay: (x, y, s) => 205 + 25 * tileFbm(x, y, s, 8, 4),
  trim: (x, y, s) => 240 + 8 * tileFbm(x, y, s, 8, 5),
  asphalt: (x, y, s, r) => 150 + 26 * tileFbm(x, y, s, 16, 6) + 16 * (r() - 0.5) + (r() < 0.03 ? 34 : 0),
  soil: (x, y, s, r) => 168 + 36 * tileFbm(x, y, s, 8, 7) + (r() < 0.012 ? 48 : 0),
  foliage: (x, y, s) => {
    const n = tileFbm(x, y, s, 8, 8);
    return 168 + 80 * n * Math.abs(n) + 18 * tileFbm(x, y, s, 32, 9);
  },
  fabric: (x, y, s) => 200 + (((x >> 1) + (y >> 1)) % 2) * 12 + 10 * tileFbm(x, y, s, 16, 10),
  grass: (x, y, s, r) => {
    const clumps = tileFbm(x, y, s, 6, 11);
    const blades = tileFbm(x * 0.25, y * 4, s, 16, 12);
    return 198 + 24 * clumps + 10 * blades + 6 * (r() - 0.5);
  },
  bark: (x, y, s) => 150 + 40 * Math.sin((x / s) * Math.PI * 2 * 10 + tileFbm(x, y, s, 4, 13) * 5) + 18 * tileFbm(x, y, s, 16, 14),
  wood: (x, y, s) => {
    const planks = 5;
    const w = s / planks;
    const plank = Math.floor(x / w);
    if (x % w < 2) return 95;
    const grain = Math.sin((y / s) * Math.PI * 2 * 3 + tileFbm(x, y, s, 4, 15) * 6 + hash2(plank, 0, 16) * 10);
    return 178 + 26 * grain + 22 * (hash2(plank, 1, 17) - 0.5) + 10 * tileFbm(x, y, s, 32, 18);
  },
  brick: (x, y, s) => {
    const rows = 12;
    const cols = 4;
    const rowH = s / rows;
    const colW = s / cols;
    const row = Math.floor(y / rowH);
    const offset = (row % 2) * (colW / 2);
    const cx = (x + offset) % s;
    const col = Math.floor(cx / colW);
    const u = cx - col * colW;
    const v = y - row * rowH;
    if (u < 2 || v < 2) return 222;
    return 150 + hash2(row, col, 19) * 56 + 12 * tileFbm(x, y, s, 32, 20);
  },
  roof: (x, y, s) => {
    const rows = 8;
    const perRow = 6;
    const rowH = s / rows;
    const row = Math.floor(y / rowH);
    const v = (y - row * rowH) / rowH;
    const colW = s / perRow;
    const cx = (x + (row % 2) * (colW / 2)) % s;
    const col = Math.floor(cx / colW);
    const u = cx - col * colW;
    if (u < 1.5) return 110;
    return 128 + 100 * Math.pow(v, 0.7) + 24 * (hash2(row, col, 21) - 0.5) + 8 * tileFbm(x, y, s, 16, 22);
  },
  stone: (x, y, s) => stoneValue(x, y, s),
};

/** Irregular cobbles: distance to the nearest two jittered cell points (wrapped). */
function stoneValue(x: number, y: number, s: number): number {
  const cells = 5;
  const cell = s / cells;
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  let d1 = Infinity;
  let d2 = Infinity;
  let nearest = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = gx + ox;
      const cy = gy + oy;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const px = (cx + 0.2 + hash2(wx, wy, 23) * 0.6) * cell;
      const py = (cy + 0.2 + hash2(wx, wy, 24) * 0.6) * cell;
      const d = Math.hypot(x - px, y - py);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        nearest = wx * 31 + wy;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  if (d2 - d1 < s * 0.018) return 120 + 20 * tileFbm(x, y, s, 32, 25);
  return 172 + hash2(nearest, 0, 26) * 58 + 12 * tileFbm(x, y, s, 16, 27);
}

export function createTexture(id: TextureId, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for texture painting');
  const image = ctx.createImageData(size, size);
  const rand = seededRandom(id.length * 977 + id.charCodeAt(0));
  const painter = PAINTERS[id];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = clamp(painter(x, y, size, rand));
      const i = (y * size + x) * 4;
      image.data[i] = l;
      image.data[i + 1] = l;
      image.data[i + 2] = l;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `tex:${id}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Tileable ripple normal map for water. */
export function createWaterNormal(size = 256): THREE.CanvasTexture {
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      heights[y * size + x] = tileFbm(x, y, size, 6, 41, 4) + 0.5 * tileFbm(x, y, size, 20, 42, 2);
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for texture painting');
  const image = ctx.createImageData(size, size);
  const at = (x: number, y: number) => heights[((y + size) % size) * size + ((x + size) % size)];
  const strength = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      image.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      image.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'tex:water-normal';
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
