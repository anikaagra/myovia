// Deterministic weekly plan. The rules engine decides the state; this turns it into concrete targets.
// AI (ai.js) may reword the plan for the patient, but every number here comes from code, not the model.

import { PROTEIN, EXERCISE } from './norms.js';

const LB_TO_KG = 0.45359237;
const r5 = (n) => Math.round(n / 5) * 5;

/**
 * Daily protein target (2025 GLP-1 nutrition advisory).
 * - With a lean mass reading: about 1.5 g per kg of lean mass.
 * - Otherwise 1.2–1.6 g/kg, applied to a reference weight (BMI 25 at the patient's height) when BMI is 30 or more,
 *   because g/kg of actual weight overshoots at high body weight.
 */
export function proteinTarget(p, weightLb, leanMassLb = null) {
  const actualKg = (weightLb ?? p.currentWeightLb ?? p.startWeightLb ?? 0) * LB_TO_KG;
  if (!actualKg) return null;
  let low, high, basis;
  if (leanMassLb) {
    const mid = leanMassLb * LB_TO_KG * PROTEIN.gPerKgLean;
    low = r5(mid * 0.9); high = r5(mid * 1.1); basis = 'your lean mass';
  } else {
    let refKg = actualKg; basis = 'your weight';
    if (p.heightIn) {
      const m = p.heightIn * 0.0254;
      if (actualKg / (m * m) >= 30) { refKg = PROTEIN.referenceBmi * m * m; basis = 'a healthy weight for your height'; }
    }
    low = r5(refKg * PROTEIN.gPerKg[0]); high = r5(refKg * PROTEIN.gPerKg[1]);
  }
  // Stay within a sensible absolute band so very small or very large bodies get practical numbers.
  low = Math.max(70, Math.min(low, 160)); high = Math.max(low + 10, Math.min(high, 180));
  return { low, high, perMeal: r5(((low + high) / 2) / 3), basis, source: PROTEIN.source };
}

const MOVES = {
  chairStand: { name: 'Sit-to-stand from a chair', dose: '2 sets of 8–10', note: 'Use the chair arms to help if your knees hurt.' },
  wallPush: { name: 'Wall push-ups', dose: '2 sets of 10' },
  heelRaise: { name: 'Heel raises holding a counter', dose: '2 sets of 12' },
  seatedKnee: { name: 'Seated knee extensions', dose: '2 sets of 10 each leg', note: 'Gentle on the knees.' },
  bandRow: { name: 'Band or towel rows', dose: '2 sets of 12' },
  bridge: { name: 'Glute bridges', dose: '2 sets of 10' },
  stepUp: { name: 'Step-ups on a stair', dose: '2 sets of 8 each leg', note: 'Hold the rail.' },
  squat: { name: 'Squats to a chair', dose: '3 sets of 10' },
  carry: { name: 'Carry two grocery bags', dose: '3 walks of 30 seconds', note: 'Builds grip and posture.' },
  squeeze: { name: 'Squeeze a rolled towel or soft ball', dose: '3 sets of 10 each hand' },
};

/** Strength routine matched to joint pain, activity level and which measure needs work. */
export function strengthRoutine(p, focus) {
  const knees = p.jointPain === 'yes';
  const beginner = p.activity === 'rarely' || p.activity === 'some' || !p.activity;
  let moves = knees
    ? [MOVES.chairStand, MOVES.seatedKnee, MOVES.wallPush, MOVES.bandRow, MOVES.heelRaise]
    : beginner ? [MOVES.chairStand, MOVES.wallPush, MOVES.bridge, MOVES.bandRow, MOVES.heelRaise]
    : [MOVES.squat, MOVES.stepUp, MOVES.wallPush, MOVES.bandRow, MOVES.bridge];
  if (focus === 'grip') moves = [...moves.slice(0, 3), MOVES.carry, MOVES.squeeze];
  return { sessionsPerWeek: EXERCISE.strengthDaysPerWeek, minutes: beginner || knees ? 15 : 25, moves,
    aerobicMinutesPerWeek: EXERCISE.aerobicMinutesPerWeek };
}

/** One-week plan for the patient, from the result of their check. */
export function weeklyPlan(p, result, weightLb) {
  const d = result.domains ?? {};
  const focus = result.flagged ? 'rest'
    : d.mass?.state && d.mass.state !== 'steady' ? 'mass'
    : d.grip?.state && d.grip.state !== 'steady' && d.function?.state === 'steady' ? 'grip'
    : d.function?.state && d.function.state !== 'steady' ? 'legs' : 'maintain';
  const protein = proteinTarget(p, weightLb, result.leanMassLb ?? d.mass?.leanMassLb ?? null);
  const routine = strengthRoutine(p, focus);
  const strengthDays = ['Mon', 'Wed', 'Fri'];
  const walk = p.jointPain === 'yes' ? 'Easy walk or stationary bike, 20–30 minutes' : 'Brisk walk, 30 minutes';
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({
    day,
    items: result.flagged
      ? [strengthDays.includes(day) ? 'Gentle strength routine, only if you feel well' : 'Rest and recover']
      : strengthDays.includes(day) ? [`Strength routine, about ${routine.minutes} minutes`]
      : day === 'Sun' ? ['Rest, or an easy walk'] : [walk],
  }));
  return { focus, protein, routine, days };
}
