import { describe, it, expect } from 'vitest';
import { RepCounter, StandCounter, angleAt, kneeAngle } from '../repCounter';
import { evaluateFrame, CheckSmoother } from '../cameraChecks';
import { laplacianVariance, meanLuminance, cornerMotion, lensStats } from '../frameStats';

const P = (x: number, y: number, visibility = 0.9) => ({ x, y, visibility });

describe('angleAt', () => {
  it('measures a straight leg as 180 and a right angle as 90', () => {
    expect(angleAt(P(0, 0), P(0, 1), P(0, 2))).toBeCloseTo(180);
    expect(angleAt(P(0, 0), P(0, 1), P(1, 1))).toBeCloseTo(90);
  });
});

describe('RepCounter', () => {
  it('counts one rep per full sit-to-stand', () => {
    const c = new RepCounter();
    const seq = [90, 100, 140, 170, 175, 130, 95, 90, 150, 172, 100, 168];
    seq.forEach((a, i) => c.update(a, i * 400));
    expect(c.reps).toBe(3);
  });
  it('does not count a half stand or jitter near the threshold', () => {
    const c = new RepCounter();
    [95, 140, 150, 140, 152, 100].forEach((a, i) => c.update(a, i * 400));
    expect(c.reps).toBe(0);
  });
  it('does not count starting while already standing', () => {
    const c = new RepCounter();
    [175, 170, 176].forEach((a, i) => c.update(a, i * 400));
    expect(c.reps).toBe(0);
  });
  it('reports tracking confidence', () => {
    const c = new RepCounter();
    c.update(90, 0); c.update(null, 100); c.update(170, 900); c.update(null, 1000);
    expect(c.confidence).toBe(0.5);
    expect(c.reps).toBe(1);
  });
  it('picks the more visible leg', () => {
    const lm: { x: number; y: number; visibility: number }[] = Array.from({ length: 33 }, () => P(0.5, 0.5, 0.1));
    lm[23] = P(0.5, 0.4); lm[25] = P(0.5, 0.6); lm[27] = P(0.5, 0.8);
    expect(kneeAngle(lm)?.angle).toBeCloseTo(180);
  });
});

const body = (span = 0.7, shoulderWidth = 0.05) => {
  const lm = Array.from({ length: 33 }, () => P(0.5, 0.5));
  lm[0] = P(0.5, 0.15); lm[11] = P(0.5 - shoulderWidth / 2, 0.25); lm[12] = P(0.5 + shoulderWidth / 2, 0.25);
  lm[23] = P(0.5, 0.5); lm[24] = P(0.5, 0.5); lm[27] = P(0.5, 0.15 + span); lm[28] = P(0.5, 0.15 + span);
  return lm;
};
const good = { sharpness: 120, luminance: 120, motion: 1, landmarks: body() };

describe('evaluateFrame', () => {
  it('is ready when everything passes', () => {
    expect(evaluateFrame(good).ready).toBe(true);
  });
  it('asks to wipe the lens first when the image is blurry', () => {
    const r = evaluateFrame({ ...good, sharpness: 5 });
    expect(r.current?.id).toBe('lens');
    expect(r.current?.fix).toMatch(/Wipe your camera lens/);
  });
  it('asks to move back when the feet are cut off', () => {
    const lm = body(); lm[27] = P(0.5, 0.99); lm[28] = P(0.5, 0.99);
    expect(evaluateFrame({ ...good, landmarks: lm }).current?.fix).toBe('Move the phone back one step.');
  });
  it('asks to move closer when the body is small', () => {
    expect(evaluateFrame({ ...good, landmarks: body(0.3) }).current?.fix).toBe('Move the phone one step closer.');
  });
  it('asks for a side view when facing the camera', () => {
    expect(evaluateFrame({ ...good, landmarks: body(0.7, 0.2) }).current?.id).toBe('side');
  });
  it('shows only one fix at a time', () => {
    const r = evaluateFrame({ sharpness: 5, luminance: 10, motion: 40, landmarks: null });
    expect(r.checks.filter((c) => c.status === 'fix')).toHaveLength(1);
    expect(r.checks.filter((c) => c.status === 'wait').length).toBeGreaterThan(1);
  });
  it('flags dark rooms and a moving phone', () => {
    expect(evaluateFrame({ ...good, luminance: 20 }).current?.id).toBe('light');
    expect(evaluateFrame({ ...good, motion: 30 }).current?.id).toBe('steady');
  });
});

describe('frame stats', () => {
  it('scores a sharp checkerboard far above a flat image', () => {
    const w = 20, h = 20;
    const flat = new Float32Array(w * h).fill(128);
    const checker = Float32Array.from({ length: w * h }, (_, i) => (((i % w) + Math.floor(i / w)) % 2 ? 255 : 0));
    expect(laplacianVariance(checker, w, h)).toBeGreaterThan(1000);
    expect(laplacianVariance(flat, w, h)).toBe(0);
    expect(meanLuminance(flat)).toBe(128);
  });
  it('detects corner motion', () => {
    const w = 20, h = 20;
    const a = new Float32Array(w * h).fill(100);
    const b = new Float32Array(w * h).fill(140);
    expect(cornerMotion(a, b, w, h)).toBe(40);
    expect(cornerMotion(null, b, w, h)).toBe(0);
  });
});


// Side-view skeleton: seated has hip at knee height (thigh horizontal); standing has the hip one thigh above.
function sidePose(h: number, opts: { armsOut?: boolean } = {}) {
  const lm = Array.from({ length: 33 }, () => P(0.5, 0.5, 0.1));
  const knee = { x: 0.55, y: 0.62 }, ankle = { x: 0.55, y: 0.85 }, thigh = 0.18;
  // h = 0 seated (hip level with knee, behind it), h = 1 standing (hip straight above knee)
  const hip = { x: knee.x - thigh * Math.cos((h * Math.PI) / 2), y: knee.y - thigh * Math.sin((h * Math.PI) / 2) };
  for (const i of [23, 24]) lm[i] = P(hip.x, hip.y);
  for (const i of [25, 26]) lm[i] = P(knee.x, knee.y);
  for (const i of [27, 28]) lm[i] = P(ankle.x, ankle.y);
  lm[11] = P(hip.x + 0.02, hip.y - 0.22); lm[12] = P(hip.x + 0.02, hip.y - 0.22); lm[0] = P(hip.x + 0.04, hip.y - 0.3);
  const w = opts.armsOut ? P(hip.x + 0.02, hip.y + 0.05) : P(hip.x + 0.03, hip.y - 0.2);
  lm[15] = w; lm[16] = w;
  return lm;
}

describe('StandCounter', () => {
  const run = (heights: number[], stepMs = 100, opts = {}) => {
    const c = new StandCounter();
    c.calibrate(sidePose(0));
    heights.forEach((h, i) => c.update(sidePose(h, opts), i * stepMs));
    return c;
  };
  const stand = (n: number) => Array.from({ length: n }, () => [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1, 1, 0.8, 0.5, 0.3, 0.1, 0]).flat();

  it('counts full stands from hip height', () => {
    expect(run(stand(5)).reps).toBe(5);
  });
  it('ignores half stands and jitter', () => {
    expect(run([0, 0.2, 0.4, 0.5, 0.4, 0.2, 0, 0.1, 0.05, 0.3, 0.1]).reps).toBe(0);
  });
  it('counts a stand that is more than halfway up when time runs out (STEADI)', () => {
    const c = run([...stand(3), 0, 0.2, 0.4, 0.6, 0.65]);
    expect(c.reps).toBe(3);
    expect(c.finish()).toBe(4);
  });
  it('does not count one that is less than halfway up', () => {
    const c = run([...stand(2), 0, 0.2, 0.35]);
    expect(c.finish()).toBe(2);
  });
  it('does not double count fast bounces under the minimum time', () => {
    expect(run([0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1], 60).reps).toBe(1);
  });
  it('flags stands made with the arms uncrossed', () => {
    const c = run(stand(3), 100, { armsOut: true });
    expect(c.reps).toBe(3);
    expect(c.armsFlags).toBe(3);
    expect(run(stand(3)).armsFlags).toBe(0);
  });
  it('is not thrown off by a single bad landmark frame', () => {
    const c = new StandCounter();
    for (let i = 0; i < 20; i++) c.calibrate(sidePose(0));
    const heights = stand(10);
    heights.forEach((h, i) => {
      const lm = sidePose(h);
      if (i === 5) { lm[23] = { ...lm[23], y: lm[23].y + 0.08 }; lm[24] = { ...lm[24], y: lm[24].y + 0.08 }; } // hip glitches low
      if (i === 40) { lm[25] = { ...lm[25], y: lm[25].y + 0.18 }; lm[26] = { ...lm[26], y: lm[26].y + 0.18 }; } // knee glitches low
      c.update(lm, i * 100);
    });
    expect(c.reps).toBe(10);
  });
  it('reports tracking confidence when the body is lost', () => {
    const c = new StandCounter();
    c.update(sidePose(0), 0); c.update(null, 100); c.update(sidePose(1), 200); c.update(null, 300);
    expect(c.confidence).toBe(0.5);
  });
});

// Synthetic camera frames: a sharp checkerboard scene, the same scene blurred, and the same scene hazed.
function scene(w = 160, h = 120) {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = ((x >> 3) + (y >> 3)) % 2 ? 200 : 40;
  return g;
}
function blur(g: Float32Array, w: number, h: number, r: number) {
  let out = g;
  for (let pass = 0; pass < 3; pass++) {
    const n = new Float32Array(out.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h) { s += out[yy * w + xx]; c++; }
      }
      n[y * w + x] = s / c;
    }
    out = n;
  }
  return out;
}
const haze = (g: Float32Array, k: number) => g.map((v) => v * (1 - k) + 230 * k);
const frame = (g: Float32Array) => { const s = lensStats(g, 160, 120); return { ...s, motion: 0, landmarks: body() }; };

describe('lens checks', () => {
  it('passes a sharp image', () => {
    expect(evaluateFrame(frame(scene())).checks.find((c) => c.id === 'lens')!.status).toBe('ok');
  });
  it('asks to wipe the lens when the image is blurred', () => {
    expect(evaluateFrame(frame(blur(scene(), 160, 120, 3))).current?.fix).toMatch(/Wipe your camera lens/);
  });
  it('asks to wipe the lens when a smudge makes the image milky', () => {
    expect(evaluateFrame(frame(haze(blur(scene(), 160, 120, 1), 0.6))).current?.fix).toMatch(/Wipe your camera lens/);
  });
  it('spots a covered lens', () => {
    expect(evaluateFrame(frame(new Float32Array(160 * 120).fill(5))).current?.fix).toMatch(/covering the camera/);
  });
});

describe('light, framing and phone checks', () => {
  it('spots a bright window behind the patient', () => {
    expect(evaluateFrame({ ...good, personLuminance: 40 }).current?.fix).toMatch(/window is behind you/);
  });
  it('asks others to step out of view', () => {
    expect(evaluateFrame({ ...good, people: 2 }).current?.id).toBe('alone');
  });
  it('asks to stand the phone up when it leans back', () => {
    expect(evaluateFrame({ ...good, tilt: { beta: 60, gamma: 0 } }).current?.fix).toMatch(/leaning back/);
    expect(evaluateFrame({ ...good, tilt: { beta: 88, gamma: 2 } }).ready).toBe(true);
  });
  it('asks to step back when the body fills the frame', () => {
    expect(evaluateFrame({ ...good, landmarks: body(0.95) }).current?.fix).toMatch(/back one step/);
  });
});

describe('CheckSmoother', () => {
  it('waits for a check to fail several times before asking for a fix, then clears after passes', () => {
    const s = new CheckSmoother(3, 2);
    const bad = evaluateFrame({ ...good, sharpness: 5, detail: 0.01 });
    const ok = evaluateFrame(good);
    let r = s.update(bad);
    expect(r.ready).toBe(false);
    expect(r.current).toBe(null);
    expect(s.update(bad).current).toBe(null);
    expect(s.update(bad).current?.id).toBe('lens');
    expect(s.update(ok).current?.id).toBe('lens');
    expect(s.update(ok).ready).toBe(true);
  });
  it('is not ready until every check has passed twice in a row', () => {
    const s = new CheckSmoother(3, 2);
    expect(s.update(evaluateFrame(good)).ready).toBe(false);
    expect(s.update(evaluateFrame(good)).ready).toBe(true);
  });
});
