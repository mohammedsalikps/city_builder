import * as THREE from 'three';

/** The official Eavara wordmark, keyed against its own flat background so it drops onto any scene cleanly. */
export interface LogoTexture {
  texture: THREE.CanvasTexture;
  /** width / height, for sizing a plane that doesn't distort the mark. */
  aspect: number;
  /** `count` points across the mark's own silhouette, in -0.5..0.5 plane-local space (y up). */
  samplePoints(count: number): Array<{ x: number; y: number }>;
}

const MAX_WIDTH = 1024;
const ALPHA_THRESHOLD = 0.12;

/**
 * Loads the source logo image and keys out its flat background (sampled from
 * its own corner, not a hardcoded colour, so this survives a re-export at a
 * different shade) so the wordmark can sit on a transparent plane. The pixel
 * artwork itself is never redrawn or distorted - only its background alpha
 * changes.
 */
export function loadLogoTexture(url: string): Promise<LogoTexture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        resolve(processImage(img));
      } catch (error) {
        reject(error as Error);
      }
    };
    img.onerror = () => reject(new Error(`Could not load logo image at ${url}`));
    img.src = url;
  });
}

function processImage(img: HTMLImageElement): LogoTexture {
  const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const bg = sampleBackground(data, width, height);
  const alphaMask = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const dist = colorDistance(r, g, b, bg.r, bg.g, bg.b) / 255;
    // Distances near 0 (background) go transparent; a smoothstep keeps the mark's own anti-aliased edges soft.
    const alpha = THREE.MathUtils.smoothstep(dist, 0.05, 0.22);
    alphaMask[i] = alpha;
    data[i * 4 + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return {
    texture,
    aspect: width / height,
    samplePoints: (count: number) => samplePoints(alphaMask, width, height, count),
  };
}

/** The background is whatever flat colour sits in the four corners, averaged. */
function sampleBackground(data: Uint8ClampedArray, width: number, height: number): { r: number; g: number; b: number } {
  const corners = [0, width - 1, (height - 1) * width, (height - 1) * width + width - 1];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const i of corners) {
    r += data[i * 4];
    g += data[i * 4 + 1];
    b += data[i * 4 + 2];
  }
  return { r: r / corners.length, g: g / corners.length, b: b / corners.length };
}

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** Evenly-spaced (stratified) opaque pixels, converted to plane-local -0.5..0.5 space (y up). */
function samplePoints(alphaMask: Float32Array, width: number, height: number, count: number): Array<{ x: number; y: number }> {
  const opaque: number[] = [];
  for (let i = 0; i < alphaMask.length; i++) {
    if (alphaMask[i] > ALPHA_THRESHOLD) opaque.push(i);
  }
  if (opaque.length === 0) return [];

  const aspect = width / height;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    // Stratified: walk the opaque list evenly rather than pure random, so a
    // small `count` still reads as the mark's outline instead of clumping.
    const index = opaque[Math.floor((i / count) * opaque.length)];
    const px = index % width;
    const py = Math.floor(index / width);
    points.push({
      x: (px / width - 0.5) * aspect,
      y: -(py / height - 0.5),
    });
  }
  return points;
}
