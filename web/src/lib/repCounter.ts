export type Point = { x: number; y: number; visibility?: number };
export type Phase = 'unknown' | 'seated' | 'standing';

/** Angle at b (degrees) formed by a-b-c. */
export function angleAt(a: Point, b: Point, c: Point): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m === 0) return NaN;
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI;
}

// MediaPipe pose landmark indexes.
export const LM = { nose: 0, lShoulder: 11, rShoulder: 12, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28 } as const;

/** Knee angle from whichever leg the camera sees best, or null if neither is visible. */
export function kneeAngle(lm: Point[], minVis = 0.5): { angle: number; hip: Point } | null {
  const sides = [
    [LM.lHip, LM.lKnee, LM.lAnkle],
    [LM.rHip, LM.rKnee, LM.rAnkle],
  ].map(([h, k, a]) => ({ h: lm[h], k: lm[k], a: lm[a] }))
    .filter((s) => s.h && s.k && s.a)
    .map((s) => ({ ...s, vis: Math.min(s.h.visibility ?? 1, s.k.visibility ?? 1, s.a.visibility ?? 1) }))
    .filter((s) => s.vis >= minVis)
    .sort((x, y) => y.vis - x.vis);
  if (!sides.length) return null;
  const s = sides[0];
  const angle = angleAt(s.h, s.k, s.a);
  return Number.isFinite(angle) ? { angle, hip: s.h } : null;
}

/**
 * Counts full sit-to-stand repetitions from knee angles, with hysteresis so jitter
 * near a threshold can't double count. A rep is counted on reaching full standing
 * after having been seated.
 */
export class RepCounter {
  reps = 0;
  phase: Phase = 'unknown';
  private lastRepAt = -Infinity;
  private seen = 0;
  private tracked = 0;

  constructor(private opts = { standAngle: 155, sitAngle: 115, minRepMs: 600 }) {}

  update(angle: number | null, tMs: number): boolean {
    this.seen++;
    if (angle == null || !Number.isFinite(angle)) return false;
    this.tracked++;
    if (angle <= this.opts.sitAngle) {
      this.phase = 'seated';
      return false;
    }
    if (angle >= this.opts.standAngle) {
      const wasSeated = this.phase === 'seated';
      this.phase = 'standing';
      if (wasSeated && tMs - this.lastRepAt >= this.opts.minRepMs) {
        this.reps++;
        this.lastRepAt = tMs;
        return true;
      }
    }
    return false;
  }

  /** Share of frames where the leg was tracked: the capture's confidence. */
  get confidence(): number {
    return this.seen ? this.tracked / this.seen : 0;
  }
}

export const LM2 = { ...LM, lWrist: 15, rWrist: 16 } as const;

const vis = (p: Point | undefined, min = 0.5) => !!p && (p.visibility ?? 1) >= min;
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) });

/** Hip point (average of visible hips) and thigh length (hip to knee), from whichever side is visible. */
export function hipAndThigh(lm: Point[], minVis = 0.5): { hip: Point; thigh: number } | null {
  const lh = lm[LM.lHip], rh = lm[LM.rHip], lk = lm[LM.lKnee], rk = lm[LM.rKnee];
  const hip = vis(lh, minVis) && vis(rh, minVis) ? mid(lh, rh) : vis(lh, minVis) ? lh : vis(rh, minVis) ? rh : null;
  if (!hip) return null;
  const thighs = [[lh, lk], [rh, rk]].filter(([h, k]) => vis(h, minVis) && vis(k, minVis)).map(([h, k]) => Math.hypot(h.x - k.x, h.y - k.y));
  return { hip, thigh: thighs.length ? Math.max(...thighs) : 0 };
}

/** True when either wrist is far from both shoulders, i.e. the arms are not crossed on the chest. */
export function armsUncrossed(lm: Point[]): boolean | null {
  const ls = lm[LM.lShoulder], rs = lm[LM.rShoulder], lw = lm[LM2.lWrist], rw = lm[LM2.rWrist], lh = lm[LM.lHip];
  if (!vis(ls) || !vis(rs) || !vis(lh)) return null;
  const torso = Math.hypot((ls.x + rs.x) / 2 - lh.x, (ls.y + rs.y) / 2 - lh.y);
  if (!torso) return null;
  const far = (w: Point | undefined) => vis(w, 0.6) && Math.min(Math.hypot(w!.x - ls.x, w!.y - ls.y), Math.hypot(w!.x - rs.x, w!.y - rs.y)) / torso > 0.75;
  if (!vis(lw, 0.6) && !vis(rw, 0.6)) return null;
  return far(lw) || far(rw);
}

export type StandFrame = { landmarks: Point[] | null; tMs: number };

/**
 * Counts 30-second chair stands from pose landmarks. Two signals, fused:
 * 1. Hip height: how far the hip has risen above its lowest (seated) point, in thigh lengths. Seated is about 0,
 *    standing about 0.8-1.1. This works from a side or a 45° view.
 * 2. Knee angle (when a leg is visible): standing is straight (>150°), seated bent (<115°).
 * A stand counts when the patient goes from seated to standing; hysteresis and a minimum time between stands stop
 * jitter double-counting. Follows the CDC STEADI rule: if the patient is more than halfway up at 30 seconds,
 * that stand counts.
 */
const pct = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))))]; };

export class StandCounter {
  reps = 0;
  phase: Phase = 'unknown';
  armsFlags = 0;
  lastHeight: number | null = null;
  private seen = 0;
  private tracked = 0;
  private lastRepAt = -Infinity;
  private lastTracked = -Infinity;
  private longestGapMs = 0;
  private armsThisRep = false;
  // Robust references: one bad landmark frame must not move them. Hip y passes through a median-of-3 filter,
  // the seated level is the 90th percentile of filtered hip y (image y grows downward), and thigh length is the
  // 75th percentile of measured thigh lengths.
  private recentY: number[] = [];
  private hipYs: number[] = [];
  private thighs: number[] = [];
  private smoothH: number | null = null;
  private rawTail: number[] = [];
  /** Time of each counted stand (ms, same clock as update), and a ~10 Hz trace of hip height for the review chart. */
  repTimes: number[] = [];
  series: [number, number][] = [];
  private lastSeriesAt = -Infinity;

  constructor(private opts = { up: 0.65, down: 0.25, standAngle: 150, sitAngle: 120, minRepMs: 700, alpha: 0.5 }) {}

  private observe(h: { hip: Point; thigh: number }) {
    this.recentY.push(h.hip.y); if (this.recentY.length > 3) this.recentY.shift();
    const y = this.recentY.length === 3 ? pct(this.recentY, 50) : h.hip.y;
    this.hipYs.push(y); if (this.hipYs.length > 900) this.hipYs.shift();
    if (h.thigh > 0.02) { this.thighs.push(h.thigh); if (this.thighs.length > 900) this.thighs.shift(); }
    return y;
  }
  private get seatedY() { return this.hipYs.length ? pct(this.hipYs, 90) : null; }
  private get thigh() { return this.thighs.length ? pct(this.thighs, 75) : 0; }

  /** Call while the patient sits during the countdown, so the seated hip height is known before the first stand. */
  calibrate(lm: Point[] | null) {
    const h = lm && hipAndThigh(lm);
    if (h) this.observe(h);
  }

  /** Returns true when a new stand is counted. */
  update(lm: Point[] | null, tMs: number): boolean {
    this.seen++;
    const h = lm && hipAndThigh(lm);
    if (!h || !lm) return false;
    if (Number.isFinite(this.lastTracked)) this.longestGapMs = Math.max(this.longestGapMs, tMs - this.lastTracked);
    this.lastTracked = tMs;
    this.tracked++;
    const y = this.observe(h);
    const seated = this.seatedY, thigh = this.thigh;
    if (seated == null || thigh <= 0.02) return false;
    const raw = (seated - y) / thigh;
    this.rawTail.push((seated - h.hip.y) / thigh); if (this.rawTail.length > 2) this.rawTail.shift();
    this.smoothH = this.smoothH == null ? raw : this.smoothH + this.opts.alpha * (raw - this.smoothH);
    const height = this.smoothH;
    this.lastHeight = height;
    if (tMs - this.lastSeriesAt >= 100) { this.series.push([tMs, Math.round(height * 100) / 100]); this.lastSeriesAt = tMs; }
    const knee = kneeAngle(lm)?.angle ?? null;
    if (armsUncrossed(lm) && this.phase === 'seated') this.armsThisRep = true;

    const isDown = height < this.opts.down || (knee != null && knee < this.opts.sitAngle && height < 0.45);
    const isUp = height > this.opts.up && (knee == null || knee > this.opts.standAngle);
    if (isDown) { this.phase = 'seated'; return false; }
    if (isUp) {
      const wasSeated = this.phase === 'seated';
      this.phase = 'standing';
      if (wasSeated && tMs - this.lastRepAt >= this.opts.minRepMs) {
        this.reps++;
        this.lastRepAt = tMs;
        this.repTimes.push(tMs);
        if (this.armsThisRep) this.armsFlags++;
        this.armsThisRep = false;
        return true;
      }
    }
    return false;
  }

  /** STEADI: a stand that is more than halfway up when time runs out counts. */
  finish(): number {
    // Uses the last two unfiltered frames (filters lag behind a rising patient), both of which must be past halfway.
    if (this.phase === 'seated' && this.rawTail.length === 2 && Math.min(...this.rawTail) > 0.5) {
      this.reps++;
      this.repTimes.push(this.series.length ? this.series[this.series.length - 1][0] : 0);
    }
    return this.reps;
  }

  /** Share of frames where the body was tracked. */
  get confidence(): number { return this.seen ? this.tracked / this.seen : 0; }
  /** Longest stretch without tracking, in ms. */
  get longestGap(): number { return this.longestGapMs; }
}
