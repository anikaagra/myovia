import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsafeText, contradictsState, inventedNumbers, cleanReading } from '../src/aiText.js';

test('medication and diagnosis wording is blocked', () => {
  for (const t of ['You have sarcopenia.', 'Reduce your shots.', 'Skip your Ozempic this week.', 'Your dose should be lower.', 'Ask to lower your semaglutide dose.']) assert.ok(unsafeText(t), t);
  for (const t of ['Keep taking your medication as prescribed.', 'Eat protein at every meal.']) assert.ok(!unsafeText(t), t);
});

test('patient text must match the rules result', () => {
  assert.ok(contradictsState('Ana, you are steady and doing great.', 'watch'));
  assert.ok(contradictsState('Your care team will reach out.', 'steady'));
  assert.ok(contradictsState('Nice work this month.', 'checkin'));
  assert.ok(!contradictsState('Your care team will reach out this week.', 'checkin'));
  assert.ok(!contradictsState('You are steady. Keep going.', 'steady'));
});

test('numbers must come from the facts', () => {
  assert.deepEqual(inventedNumbers('Aim for 80 to 105 g of protein, 3 times a week.', { protein: '80-105' }), []);
  assert.deepEqual(inventedNumbers('Aim for 150 g of protein.', { protein: '80-105' }), [150]);
});

test('printout readings are range-checked and lean mass is never skeletal muscle', () => {
  const r = cleanReading({ kind: 'clinic-bia', weightLb: 190, leanMassLb: 400, bodyFatPct: 41, skeletalMuscleKg: 28, confidence: 'high' });
  assert.equal(r.leanMassLb, 112.1, 'out-of-range lean mass is dropped and derived from weight and fat');
  assert.equal(r.skeletalMuscleKg, 28);
  assert.ok(r.warnings.length);
});
