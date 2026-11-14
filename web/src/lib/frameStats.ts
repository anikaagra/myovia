/** Grayscale from RGBA pixels (Rec. 601 luma). */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return g;
}

export function meanLuminance(gray: Float32Array): number {
  let s = 0;
  for (let i = 0; i < gray.length; i++) s += gray[i];
  return gray.length ? s / gray.length : 0;
}

/**
 * Variance of the Laplacian: a standard sharpness score. A smudged or fogged lens
 * spreads light and blurs edges, so the score drops.
 */
export function laplacianVariance(gray: Float32Array, w: number, h: number): number {
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += v; sumSq += v * v; n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Mean absolute change in the two top corners between frames. The patient moves in
 * the middle of the frame; the top corners are background, so change there means the
 * phone itself moved.
 */
export function cornerMotion(prev: Float32Array | null, gray: Float32Array, w: number, h: number): number {
  if (!prev || prev.length !== gray.length) return 0;
  const cw = Math.max(1, Math.floor(w * 0.18)), ch = Math.max(1, Math.floor(h * 0.18));
  let s = 0, n = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      for (const xx of [x, w - 1 - x]) { const i = y * w + xx; s += Math.abs(gray[i] - prev[i]); n++; }
    }
  }
  return n ? s / n : 0;
}

/** Luminance percentile (0-100) from a 256-bin histogram. */
export function percentile(gray: Float32Array, p: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.max(0, Math.min(255, gray[i] | 0))]++;
  const target = (p / 100) * gray.length;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
  return 255;
}

export function variance(gray: Float32Array): number {
  let s = 0, s2 = 0;
  for (let i = 0; i < gray.length; i++) { s += gray[i]; s2 += gray[i] * gray[i]; }
  const n = gray.length || 1, m = s / n;
  return s2 / n - m * m;
}

/** Share of pixels at or above `level` (blown-out highlights, e.g. a window behind the patient). */
export function clippedFraction(gray: Float32Array, level = 250): number {
  let n = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] >= level) n++;
  return gray.length ? n / gray.length : 0;
}

/** Mean luminance inside a normalized box (0-1 coordinates), e.g. around the patient. */
export function regionMean(gray: Float32Array, w: number, h: number, box: { x0: number; y0: number; x1: number; y1: number }): number {
  const x0 = Math.max(0, Math.floor(box.x0 * w)), x1 = Math.min(w, Math.ceil(box.x1 * w));
  const y0 = Math.max(0, Math.floor(box.y0 * h)), y1 = Math.min(h, Math.ceil(box.y1 * h));
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += gray[y * w + x]; n++; }
  return n ? s / n : 0;
}

export type LensStats = { sharpness: number; detail: number; p5: number; p95: number; luminance: number; clipped: number };

/**
 * Image statistics used to spot a smudged, fogged or covered lens:
 * - sharpness: variance of the Laplacian (falls when edges blur)
 * - detail: sharpness relative to overall contrast, so a plain wall isn't mistaken for a smudge
 * - p5 / p95: a smudge scatters light, lifting the darks (haze) and narrowing the range
 */
export function lensStats(gray: Float32Array, w: number, h: number): LensStats {
  const sharpness = laplacianVariance(gray, w, h);
  return { sharpness, detail: sharpness / (variance(gray) + 1), p5: percentile(gray, 5), p95: percentile(gray, 95), luminance: meanLuminance(gray), clipped: clippedFraction(gray) };
}
