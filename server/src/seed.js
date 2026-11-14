import { openDb, newId, insertCheck } from './db.js';
import { computeTier, evaluateCheck } from './rules.js';
import { hashPassword, newToken } from './auth.js';

export const DEMO_STAFF = { email: 'nurse@demo.rise', password: 'rise-demo-2026', name: 'Jordan Lee, RN' };
export const DEMO_ADMIN_EMAIL = 'admin@demo.rise';

import { DEMO_PEOPLE, DEMO_DATES } from './demoData.js';
export { DEMO_PEOPLE, DEMO_DATES };

export function seed(db) {
  if (db.prepare('SELECT 1 FROM providers WHERE code = ?').get('DEMO42')) return false;
  db.prepare('INSERT INTO providers (code, name, created_at) VALUES (?, ?, ?)').run('DEMO42', 'Bay Area Weight Care (demo)', new Date().toISOString());
  const addStaff = db.prepare('INSERT INTO staff (id, provider_code, email, name, role, password_hash, created_at) VALUES (?,?,?,?,?,?,?)');
  // The published demo sign-in is a nurse, so it can't change settings, add staff or set the AI key.
  addStaff.run(newId(), 'DEMO42', DEMO_STAFF.email, DEMO_STAFF.name, 'nurse', hashPassword(DEMO_STAFF.password), new Date().toISOString());
  // The demo clinic's admin password comes from RISE_DEMO_ADMIN_PASSWORD, or is generated and printed once.
  const adminPw = process.env.RISE_DEMO_ADMIN_PASSWORD || newToken().slice(0, 16);
  addStaff.run(newId(), 'DEMO42', DEMO_ADMIN_EMAIL, 'Demo admin', 'admin', hashPassword(adminPw), new Date().toISOString());
  if (!process.env.RISE_DEMO_ADMIN_PASSWORD && process.env.NODE_ENV !== 'test') console.log(`Demo clinic admin: ${DEMO_ADMIN_EMAIL} / ${adminPw} (set RISE_DEMO_ADMIN_PASSWORD to choose it)`);
  const ins = db.prepare(`INSERT INTO patients (id, provider_code, first_name, age, sex, menopause, medication, dose, start_date,
    start_weight_lb, current_weight_lb, activity, falls, joint_pain, goal, height_in, tier, tier_reasons, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [firstName, age, sex, menopause, medication, dose, startDate, sw, cw, activity, falls, jointPain, goal, heightIn, checks] of DEMO_PEOPLE) {
    const p = { firstName, age, sex, menopause, medication, dose, startDate, startWeightLb: sw, currentWeightLb: cw, activity, falls, jointPain, goal, heightIn };
    const { tier, reasons } = computeTier(p);
    const id = newId();
    ins.run(id, 'DEMO42', firstName, age, sex, menopause, medication, dose, startDate, sw, cw, activity, falls, jointPain, goal, heightIn, tier, JSON.stringify(reasons), DEMO_DATES[0]);
    const history = [];
    checks.forEach(([stands, weightLb, leanMassLb, gripKg], i) => {
      const c = { stands, weightLb, leanMassLb, gripKg, bodyCompMethod: 'smart-scale', confidence: 0.92, createdAt: DEMO_DATES[i], method: 'phone-video' };
      const r = evaluateCheck({ ...p, tier }, history, c);
      insertCheck(db, id, c, r);
      history.push({ ...c, ...r });
    });
  }
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  console.log(seed(db) ? 'Seeded demo provider DEMO42 with 6 example patients.' : 'Demo data already present.');
}
