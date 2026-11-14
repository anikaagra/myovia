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
  private fails = new Map<CheckId, number>();
  private passes = new Map<CheckId, number>();
  private failing = new Map<CheckId, string>();
  constructor(private failAfter = 3, private passAfter = 2) {}

  update(raw: ReturnType<typeof evaluateFrame>) {
    // A check only counts as done after it has passed `passAfter` times in a row, so a slow phone that
    // analyses one frame a second can't start recording on a couple of lucky frames.
    const fixes = {} as Record<CheckId, string | null>;
    const pending = new Set<CheckId>();
    for (const c of raw.checks) {
      if (c.status !== 'ok') {
        this.passes.set(c.id, 0);
        const n = (this.fails.get(c.id) ?? 0) + 1; this.fails.set(c.id, n);
        if (n >= this.failAfter || this.failing.has(c.id)) this.failing.set(c.id, c.fix);
        else pending.add(c.id);
      } else {
        this.fails.set(c.id, 0);
        const n = (this.passes.get(c.id) ?? 0) + 1; this.passes.set(c.id, n);
        if (n >= this.passAfter) this.failing.delete(c.id); else pending.add(c.id);
      }
      fixes[c.id] = this.failing.get(c.id) ?? null;
    }
    const out = toChecks(fixes);
    const checks = out.checks.map((c) => (c.status === 'ok' && pending.has(c.id) ? { ...c, status: 'wait' as const } : c));
    return { checks, current: out.current, ready: out.ready && pending.size === 0 };
  }
}
