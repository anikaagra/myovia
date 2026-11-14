import { LM, type Point } from './repCounter';
import type { LensStats } from './frameStats';

export type CheckId = 'lens' | 'light' | 'distance' | 'side' | 'alone' | 'steady';
export type CheckStatus = 'ok' | 'fix' | 'wait';
export type Check = { id: CheckId; label: string; fix: string; status: CheckStatus };

export type FrameInput = Partial<LensStats> & {
  sharpness: number; // laplacian variance (higher = sharper)
  luminance: number; // 0-255
  motion: number; // background change between frames, 0-255
  landmarks: Point[] | null;
  people?: number; // poses detected
  personLuminance?: number | null; // mean brightness around the person
  tilt?: { beta: number; gamma: number } | null; // device orientation in degrees, if the phone reports it
  shaking?: number | null; // device rotation rate, degrees/second
};

// Thresholds are set conservatively and each check must fail for about a second (see CheckSmoother) before
// Rise asks for a fix, so one odd frame never interrupts. Tune on real phones before launch.
export const THRESHOLDS = {
  minSharpness: 25, // below this the frame is blurry
  minDetail: 0.06, // blur relative to contrast; a plain wall has low sharpness but normal detail ratio
  hazeP5: 75, // darkest 5% of pixels this bright = milky, smudged lens
  hazeRange: 120, // and the brightness range this narrow
  covered: 18, // mean brightness this low with no detail = something over the lens
  minLuminance: 45,
  maxLuminance: 225,
  maxClipped: 0.18, // share of blown-out pixels (window behind the patient)
  backlitRatio: 0.55, // person this much darker than the whole frame = light behind them
  maxMotion: 10,
  maxShake: 12, // deg/s from the gyroscope
  minBodySpan: 0.42, // nose-to-ankle height as share of frame height
  maxBodySpan: 0.92,
  edge: 0.02,
  minVisibility: 0.5,
  maxShoulderRatio: 0.55, // shoulder width / torso length; above this the patient faces the phone (a 45° angle is fine)
  maxTiltFromUpright: 15, // degrees from vertical (beta 90)
  maxRoll: 12, // degrees of sideways lean (gamma)
};

const LABELS: Record<CheckId, string> = {
  lens: 'Lens is clean',
  light: 'Good light',
  distance: 'Whole body in view',
  side: 'Side view',
  alone: 'Only you in view',
  steady: 'Phone is upright and steady',
};

const visible = (p: Point | undefined, t = THRESHOLDS) =>
  !!p && (p.visibility ?? 1) >= t.minVisibility && p.x > t.edge && p.x < 1 - t.edge && p.y > t.edge && p.y < 1 - t.edge;

export function lensFix(f: FrameInput, t = THRESHOLDS): string | null {
  if (f.luminance < t.covered && f.sharpness < t.minSharpness) return 'Something is covering the camera. Check the lens.';
  const blurry = f.sharpness < t.minSharpness && (f.detail == null || f.detail < t.minDetail);
  const hazy = f.p5 != null && f.p95 != null && f.p5 > t.hazeP5 && f.p95 - f.p5 < t.hazeRange && f.sharpness < t.minSharpness * 3;
  return blurry || hazy ? 'Wipe your camera lens with a soft cloth.' : null;
}

export function lightFix(f: FrameInput, t = THRESHOLDS): string | null {
  if (f.luminance < t.minLuminance) return 'Turn on a light so the camera can see you.';
  if (f.luminance > t.maxLuminance) return 'It’s too bright. Move out of direct sunlight.';
  if ((f.clipped ?? 0) > t.maxClipped || (f.personLuminance != null && f.personLuminance < f.luminance * t.backlitRatio)) {
    return 'A bright window is behind you. Turn so the light is in front of you.';
  }
  return null;
}

export function distanceFix(lm: Point[] | null, t = THRESHOLDS): string | null {
  if (!lm || !lm.length) return 'Step into view so the camera can see your whole body.';
  const ankle = [lm[LM.lAnkle], lm[LM.rAnkle]].find((p) => visible(p, t));
  const head = visible(lm[LM.nose], t) ? lm[LM.nose] : undefined;
  if (!ankle || !head) return 'Move the phone back one step.';
  const span = Math.abs(ankle.y - head.y);
  if (span > t.maxBodySpan) return 'Move the phone back one step.';
  if (span < t.minBodySpan) return 'Move the phone one step closer.';
  return null;
}

export function sideFix(lm: Point[] | null, t = THRESHOLDS): string | null {
  if (!lm) return null;
  const ls = lm[LM.lShoulder], rs = lm[LM.rShoulder], lh = lm[LM.lHip], rh = lm[LM.rHip];
  if (!ls || !rs || !lh || !rh) return null;
  const torso = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  if (torso === 0) return null;
  return Math.abs(ls.x - rs.x) / torso > t.maxShoulderRatio ? 'Turn your chair so your side faces the phone.' : null;
}

export function steadyFix(f: FrameInput, t = THRESHOLDS): string | null {
  if (f.tilt) {
    if (Math.abs(f.tilt.beta - 90) > t.maxTiltFromUpright) return f.tilt.beta < 90 ? 'Stand the phone up straighter. It’s leaning back.' : 'Stand the phone up straighter. It’s leaning forward.';
    if (Math.abs(f.tilt.gamma) > t.maxRoll) return 'Straighten the phone so it isn’t tipped to one side.';
  }
  if ((f.shaking ?? 0) > t.maxShake || f.motion > t.maxMotion) return 'Prop your phone against something steady.';
  return null;
}

/** Runs the pre-recording checks in order and marks only the first failing one as the fix to show. */
export function evaluateFrame(f: FrameInput, t = THRESHOLDS): { checks: Check[]; ready: boolean; current: Check | null } {
  const fixes: Record<CheckId, string | null> = {
    lens: lensFix(f, t),
    light: lightFix(f, t),
    distance: distanceFix(f.landmarks, t),
    side: null,
    alone: (f.people ?? 1) > 1 ? 'Only you should be in view. Ask others to step out of the picture.' : null,
    steady: steadyFix(f, t),
  };
  fixes.side = fixes.distance ? 'Turn your chair so your side faces the phone.' : sideFix(f.landmarks, t);
  return toChecks(fixes);
}

function toChecks(fixes: Record<CheckId, string | null>) {
  let shown = false;
  const checks: Check[] = (Object.keys(LABELS) as CheckId[]).map((id) => {
    const fix = fixes[id];
    let status: CheckStatus = 'ok';
    if (fix) { status = shown ? 'wait' : 'fix'; shown = true; }
    return { id, label: LABELS[id], fix: fix ?? '', status };
  });
  const current = checks.find((c) => c.status === 'fix') ?? null;
  return { checks, ready: !current, current };
}

/**
 * Debounces checks: a check must fail `failAfter` evaluations in a row to show as a fix, and pass `passAfter`
 * in a row to clear. Stops the list flickering when one frame is dark or blurry.
 */
export class CheckSmoother {
  private fails = new Map<string, number>();
  private passes = new Map<string, number>();
  private failing = new Map<string, string>();
  constructor(private failAfter = 3, private passAfter = 2) {}

  /** Works for any list of checks (sit-to-stand or body scan); keeps their ids, labels and order. */
  update(raw: { checks: Check[] }) {
    // A check only counts as done after it has passed `passAfter` times in a row, so a slow phone that
    // analyses one frame a second can't start recording on a couple of lucky frames.
    const pending = new Set<string>();
    for (const c of raw.checks) {
      if (c.status !== 'ok') {
        this.passes.set(c.id, 0);
        const n = (this.fails.get(c.id) ?? 0) + 1; this.fails.set(c.id, n);
        if (n >= this.failAfter || this.failing.has(c.id)) this.failing.set(c.id, c.fix || this.failing.get(c.id) || '');
        else pending.add(c.id);
      } else {
        this.fails.set(c.id, 0);
        const n = (this.passes.get(c.id) ?? 0) + 1; this.passes.set(c.id, n);
        if (n >= this.passAfter) this.failing.delete(c.id); else pending.add(c.id);
      }
    }
    let shown = false;
    const checks: Check[] = raw.checks.map((c) => {
      const fix = this.failing.get(c.id);
      if (fix != null) { const status: CheckStatus = shown ? 'wait' : 'fix'; shown = true; return { ...c, fix, status }; }
      return { ...c, fix: '', status: pending.has(c.id) ? 'wait' : 'ok' };
    });
    const current = checks.find((c) => c.status === 'fix') ?? null;
    return { checks, current, ready: !current && pending.size === 0 };
  }
}

// ---------- Body scan photos ----------
export type ScanCheckId = 'lens' | 'light' | 'frame' | 'pose' | 'alone' | 'steady';
const SCAN_LABELS: Record<ScanCheckId, string> = {
  lens: 'Lens is clean', light: 'Even light from the front', frame: 'Head to feet in view', pose: 'Pose', alone: 'Only you in view', steady: 'Phone is upright and steady',
};

const deg = (a: Point, b: Point, c: Point) => {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  return m ? (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / m))) * 180) / Math.PI : NaN;
};

/** Front photo: A-pose (arms 15-50° from the body, like Bodygram's 25-35° guide). Side photo: side-on to the phone. */
export function scanPoseFix(lm: Point[] | null, shot: 'front' | 'side'): string | null {
  if (!lm) return null;
  const ls = lm[LM.lShoulder], rs = lm[LM.rShoulder], lh = lm[LM.lHip], rh = lm[LM.rHip], lw = lm[15], rw = lm[16];
  if (!ls || !rs || !lh || !rh) return null;
  const torso = Math.hypot((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2);
  const ratio = torso ? Math.abs(ls.x - rs.x) / torso : 0;
  if (shot === 'side') return ratio > 0.35 ? 'Turn so your side faces the phone.' : null;
  if (ratio < 0.35) return 'Face the phone.';
  if (!lw || !rw || (lw.visibility ?? 1) < 0.5 || (rw.visibility ?? 1) < 0.5) return null;
  const a = [deg(lw, ls, lh), deg(rw, rs, rh)].filter(Number.isFinite);
  if (!a.length) return null;
  if (Math.min(...a) < 15) return 'Move your arms a little away from your sides.';
  if (Math.max(...a) > 55) return 'Lower your arms a little, to about the height of a small A.';
  return null;
}

export function scanFrameFix(lm: Point[] | null, t = THRESHOLDS): string | null {
  if (!lm || !lm.length) return 'Step into view, about 6 to 8 feet from the phone.';
  const head = lm[LM.nose], feet = [lm[LM.lAnkle], lm[LM.rAnkle]];
  const vis = (p: Point | undefined) => !!p && (p.visibility ?? 1) >= t.minVisibility;
  if (!vis(head) || !feet.some(vis)) return 'Move back until your head and feet are both in view.';
  // Leave room above the head (the top of the head sits about a face-height above the nose) and below the feet.
  if (head.y < 0.1) return 'Move back a step. Your head is too close to the top.';
  if (feet.filter(vis).some((f) => f.y > 0.97)) return 'Move back a step. Your feet are at the bottom edge.';
  const span = Math.max(...feet.filter(vis).map((f) => f.y)) - head.y;
  if (span < 0.5) return 'Move one step closer.';
  return null;
}

export function evaluateScanFrame(f: FrameInput, shot: 'front' | 'side', t = THRESHOLDS) {
  const fixes: Record<ScanCheckId, string | null> = {
    lens: lensFix(f, t), light: lightFix(f, t), frame: scanFrameFix(f.landmarks, t), pose: null,
    alone: (f.people ?? 1) > 1 ? 'Only you should be in view. Ask others to step out of the picture.' : null,
    steady: steadyFix(f, t),
  };
  fixes.pose = fixes.frame ? (shot === 'front' ? 'Face the phone with your arms a little away from your sides.' : 'Turn so your side faces the phone.') : scanPoseFix(f.landmarks, shot);
  let shown = false;
  const checks = (Object.keys(SCAN_LABELS) as ScanCheckId[]).map((id) => {
    const fix = fixes[id];
    let status: CheckStatus = 'ok';
    if (fix) { status = shown ? 'wait' : 'fix'; shown = true; }
    const label = id === 'pose' ? (shot === 'front' ? 'Facing the phone, arms slightly out' : 'Side to the phone') : SCAN_LABELS[id];
    return { id: id as unknown as CheckId, label, fix: fix ?? '', status };
  });
  const current = checks.find((c) => c.status === 'fix') ?? null;
  return { checks, ready: !current, current };
}
