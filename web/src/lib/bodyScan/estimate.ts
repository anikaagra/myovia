// Keeps a phone-scan estimate realistic. A single photo-based estimate can be several points off, so Rise:
// 1. measures a burst of photos and takes the median (done in BodyScanCapture),
// 2. blends it with CUN-BAE, a validated formula from age, sex and BMI (Gómez-Ambrosi et al., Diabetes Care 2012),
//    which keeps a bad photo from producing an impossible number,
// 3. asks for a retake when the photo and the formula disagree a lot, or the change since the last scan is faster
//    than bodies change,
// 4. shows a likely range, not just one number.

export type ScanSex = 'female' | 'male' | 'other';

/** CUN-BAE body fat % (age in years, BMI in kg/m², sex 1 for women, 0 for men). */
export function cunBae(age: number, sex: ScanSex, bmi: number): number {
  const f = (s: number) => -44.988 + 0.503 * age + 10.689 * s + 3.172 * bmi - 0.026 * bmi ** 2 + 0.181 * bmi * s
    - 0.02 * bmi * age - 0.005 * bmi ** 2 * s + 0.00021 * bmi ** 2 * age;
  return sex === 'female' ? f(1) : sex === 'male' ? f(0) : (f(0) + f(1)) / 2;
}

export const SCAN_WEIGHT = 0.55; // share given to the photo measurement vs the formula
export const RANGE_PTS = 4; // ± body-fat points shown as the likely range
export const DISAGREE_PTS = 10; // photo and formula this far apart → retake
export const MAX_CHANGE_PER_30D = 3; // body-fat points; faster than this between scans → retake suggested

export type Estimate = {
  bodyFatPct: number; low: number; high: number; leanMassLb: number; leanLow: number; leanHigh: number;
  photoPct: number; formulaPct: number; warning: string | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function combineEstimate({ photoPct, age, sex, heightIn, weightLb, previous }: {
  photoPct: number; age: number; sex: ScanSex; heightIn: number; weightLb: number;
  previous?: { bodyFatPct: number; daysAgo: number } | null;
}): Estimate {
  const bmi = (weightLb * 0.45359237) / (heightIn * 0.0254) ** 2;
  const formulaPct = Math.max(5, Math.min(60, cunBae(age, sex, bmi)));
  const bf = Math.max(5, Math.min(60, SCAN_WEIGHT * photoPct + (1 - SCAN_WEIGHT) * formulaPct));
  let warning: string | null = null;
  if (Math.abs(photoPct - formulaPct) > DISAGREE_PTS) warning = 'This scan looks different from what we expect for your height and weight. Fitted clothes, good light and standing still help. Try the photos again if you can.';
  else if (previous && previous.daysAgo > 0) {
    const allowed = Math.max(2, (MAX_CHANGE_PER_30D * previous.daysAgo) / 30);
    if (Math.abs(bf - previous.bodyFatPct) > allowed) warning = `That's a bigger change since your last scan (${r1(previous.bodyFatPct)}%) than bodies usually make in ${Math.round(previous.daysAgo)} days. Try the photos again in the same clothes and spot.`;
  }
  const lean = (p: number) => r1(weightLb * (1 - p / 100));
  return { bodyFatPct: r1(bf), low: r1(bf - RANGE_PTS), high: r1(bf + RANGE_PTS), leanMassLb: lean(bf), leanLow: lean(bf + RANGE_PTS), leanHigh: lean(bf - RANGE_PTS),
    photoPct: r1(photoPct), formulaPct: r1(formulaPct), warning };
}

/** Median of a list (used to combine a burst of photo measurements). */
export const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
