// Sanity checks on a camera count before it's saved, and a simulated recording for the demo.

export type CountCheck = { level: 'ok' | 'check'; message: string | null };

/**
 * Flags counts that are probably wrong, so the patient can confirm or redo before the number reaches the nurse:
 * - a big jump from their last normal check (a real change of 5+ stands in a month is rare)
 * - stands closer together than a person can do them (double counting)
 * - long stretches with no stands in the middle of the test (missed stands)
 * - counts outside what adults typically do in 30 seconds
 */
export function reviewCount({ stands, repTimes = [], confidence = 1, lastStands = null }: {
  stands: number; repTimes?: number[]; confidence?: number; lastStands?: number | null;
}): CountCheck {
  const gaps = repTimes.slice(1).map((t, i) => t - repTimes[i]);
  const tooFast = gaps.filter((g) => g < 0.9).length;
  const median = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;
  const longGap = median != null && gaps.some((g) => g > Math.max(4, median * 2.5));
  if (tooFast >= 2) return { level: 'check', message: 'Some stands were counted very close together, so the count may be too high.' };
  if (lastStands != null && Math.abs(stands - lastStands) >= 5) {
    return { level: 'check', message: `That's ${Math.abs(stands - lastStands)} ${stands > lastStands ? 'more' : 'fewer'} than last time (${lastStands}). A change that big is unusual in a few weeks.` };
  }
  if (longGap) return { level: 'check', message: 'There was a long pause in the middle. If you kept going, the camera may have missed some stands.' };
  if (stands > 28) return { level: 'check', message: 'That is more than most adults manage in 30 seconds.' };
  if (confidence < 0.85) return { level: 'check', message: 'The camera lost sight of you for part of the test.' };
  return { level: 'ok', message: null };
}

/** Deterministic pseudo-random numbers, so a simulated recording looks the same each time for a given count. */
function rng(seed: number) { let s = seed || 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }

/**
 * A realistic 30-second recording for the demo: stands get a little slower as the legs tire, each with a
 * smooth rise and a slightly slower sit, plus small tracking jitter.
 */
export function simulateStands(n: number, seed = n + 7): { repTimes: number[]; series: [number, number][] } {
  const rand = rng(seed);
  if (n <= 0) return { repTimes: [], series: Array.from({ length: 300 }, (_, i) => [i / 10, Math.round(rand() * 4) / 100]) };
  // Cycle lengths that slow down ~25% from first to last, scaled to fit inside 29 seconds.
  const raw = Array.from({ length: n }, (_, i) => 1 + (0.25 * i) / Math.max(1, n - 1) + (rand() - 0.5) * 0.12);
  const scale = (28.6 - 0.8) / raw.reduce((a, b) => a + b, 0);
  const cycles = raw.map((c) => Math.min(c * scale, 4));
  const repTimes: number[] = [];
  const pts: [number, number][] = [];
  let t = 0.8; // reaction time after "Go"
  for (let i = 0; i < 300; i++) pts.push([i / 10, 0]);
  for (const c of cycles) {
    const up = c * 0.45;
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i][0];
      if (x >= t && x < t + c) {
        const u = (x - t) / c;
        const h = u < 0.45 ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.45) : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.45)) / 0.55);
        pts[i][1] = h * (0.95 + rand() * 0.1);
      }
    }
    repTimes.push(Math.round((t + up * 0.8) * 10) / 10);
    t += c;
  }
  return { repTimes, series: pts.map(([x, h]) => [x, Math.round((h + (rand() - 0.5) * 0.04) * 100) / 100]) };
}
