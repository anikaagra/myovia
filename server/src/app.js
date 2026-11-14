import express from 'express';
import { computeTier, evaluateCheck, STATE_RANK, TIERS, METHOD_LABEL } from './rules.js';
import { newId, patientFromRow, checkFromRow, insertCheck, followUpFromRow } from './db.js';
import { toExport } from './exportShape.js';
import { hashPassword, verifyPassword, newToken, hashToken, newLinkCode, bearer, limiter } from './auth.js';
import { createAi, templateNote } from './ai.js';
import { weeklyPlan } from './plan.js';
import { reminderIcs } from './ics.js';

const SEX = ['female', 'male', 'other'];
const YES_NO = ['yes', 'no', 'unsure', 'skip'];
const ACTIVITY = ['rarely', 'some', 'regular', 'very'];
const FALLS = ['none', 'once', 'more', 'skip'];
const METHODS = Object.keys(METHOD_LABEL);
const FOLLOW_UP_KINDS = ['reviewed', 'contacted', 'message', 'note', 'referred'];
const STAFF_SESSION_HOURS = 12;
const LINK_CODE_MINUTES = 30;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

class HttpError extends Error { constructor(status, m) { super(m); this.status = status; } }
const need = (cond, msg) => { if (!cond) throw new HttpError(400, msg); };
const num = (v) => (v === '' || v == null ? null : Number(v));
const now = () => new Date().toISOString();

// Where body composition numbers came from (photo scan measurements, import file info). Small, flat, scalar-only.
function cleanDetail(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const out = {};
  for (const [k, v] of Object.entries(d).slice(0, 12)) {
    if (/^[A-Za-z]{1,24}$/.test(k) && (typeof v === 'number' || (typeof v === 'string' && v.length <= 120) || v === null)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Wraps async handlers so thrown errors reach the error middleware (Express 4). */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp(db, opts = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()' });
    next();
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/me/read-report', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '64kb' }));

  const q = {
    provider: db.prepare('SELECT * FROM providers WHERE code = ?'),
    insertProvider: db.prepare('INSERT INTO providers (code, name, created_at) VALUES (?,?,?)'),
    patient: db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL'),
    checks: db.prepare('SELECT * FROM checks WHERE patient_id = ? ORDER BY created_at ASC, id ASC'),
    check: db.prepare('SELECT * FROM checks WHERE id = ? AND patient_id = ?'),
    patientsFor: db.prepare('SELECT * FROM patients WHERE provider_code = ? AND deleted_at IS NULL'),
    insertPatient: db.prepare(`INSERT INTO patients (id, provider_code, first_name, age, sex, menopause, medication, dose,
      start_date, start_weight_lb, current_weight_lb, activity, falls, joint_pain, goal, height_in, tier, tier_reasons, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    updateWeight: db.prepare('UPDATE patients SET current_weight_lb = ? WHERE id = ?'),
    staffByEmail: db.prepare('SELECT * FROM staff WHERE email = ?'),
    staffById: db.prepare('SELECT * FROM staff WHERE id = ?'),
    staffFor: db.prepare('SELECT id, name, email, role, created_at FROM staff WHERE provider_code = ? ORDER BY created_at'),
    insertStaff: db.prepare('INSERT INTO staff (id, provider_code, email, name, role, password_hash, created_at) VALUES (?,?,?,?,?,?,?)'),
    insertToken: db.prepare('INSERT INTO tokens (token_hash, kind, subject_id, created_at, expires_at) VALUES (?,?,?,?,?)'),
    token: db.prepare('SELECT * FROM tokens WHERE token_hash = ?'),
    touchToken: db.prepare('UPDATE tokens SET last_used_at = ? WHERE token_hash = ?'),
    deleteToken: db.prepare('DELETE FROM tokens WHERE token_hash = ?'),
    deleteTokensFor: db.prepare('DELETE FROM tokens WHERE kind = ? AND subject_id = ?'),
    insertLink: db.prepare('INSERT INTO link_codes (code_hash, patient_id, expires_at, created_by) VALUES (?,?,?,?)'),
    link: db.prepare('SELECT * FROM link_codes WHERE code_hash = ?'),
    deleteLink: db.prepare('DELETE FROM link_codes WHERE code_hash = ?'),
    deleteLinksFor: db.prepare('DELETE FROM link_codes WHERE patient_id = ?'),
    followUps: db.prepare(`SELECT f.*, s.name AS staff_name FROM follow_ups f LEFT JOIN staff s ON s.id = f.staff_id
      WHERE f.patient_id = ? ORDER BY f.created_at ASC, f.id ASC`),
    insertFollowUp: db.prepare('INSERT INTO follow_ups (patient_id, check_id, staff_id, kind, note, created_at) VALUES (?,?,?,?,?,?)'),
    audit: db.prepare('INSERT INTO audit (at, actor_kind, actor_id, action, patient_id, provider_code, detail) VALUES (?,?,?,?,?,?,?)'),
    auditFor: db.prepare('SELECT a.*, s.name AS staff_name FROM audit a LEFT JOIN staff s ON s.id = a.actor_id WHERE a.provider_code = ? ORDER BY a.id DESC LIMIT 200'),
    setting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    putSetting: db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'),
    deleteSetting: db.prepare('DELETE FROM settings WHERE key = ?'),
    softDelete: db.prepare(`UPDATE patients SET deleted_at = ?, first_name = 'Deleted', goal = NULL, dose = NULL, medication = NULL WHERE id = ?`),
    deleteChecks: db.prepare('DELETE FROM checks WHERE patient_id = ?'),
    deleteFollowUps: db.prepare('DELETE FROM follow_ups WHERE patient_id = ?'),
  };

  const audit = (actorKind, actorId, action, { patientId = null, providerCode = null, detail = null } = {}) =>
    q.audit.run(now(), actorKind, actorId, action, patientId, providerCode, detail ? JSON.stringify(detail) : null);

  // AI key: a clinic's own key (set in clinic settings) or the server's ANTHROPIC_API_KEY.
  const aiKey = (code) => (code && q.setting.get(`ai_key:${code}`)?.value) || opts.anthropicKey || process.env.ANTHROPIC_API_KEY || null;
  const ai = opts.ai ?? createAi(db, { getKey: aiKey, ...(opts.aiClient ? { clientFor: opts.aiClient } : {}) });

  const signInLimit = limiter({ max: 8 });
  const linkLimit = limiter({ max: 6 });

  // ---------- loading helpers ----------
  const loadPatient = (id) => {
    const p = patientFromRow(q.patient.get(id));
    if (!p) throw new HttpError(404, 'Patient not found');
    return p;
  };
  const withChecks = (p) => {
    const checks = q.checks.all(p.id).map(checkFromRow);
    const last = checks[checks.length - 1];
    return { ...p, checks, nextDue: last ? last.retestDate : new Date().toISOString().slice(0, 10), checkEveryDays: TIERS[p.tier].checkEveryDays };
  };
  const followUpsFor = (id) => q.followUps.all(id).map(followUpFromRow);
  const issueToken = (kind, subjectId, hours = null) => {
    const t = newToken();
    q.insertToken.run(hashToken(t), kind, subjectId, now(), hours ? new Date(Date.now() + hours * 3600e3).toISOString() : null);
    return t;
  };

  // ---------- auth middleware ----------
  const auth = (kind) => (req, _res, next) => {
    const t = bearer(req);
    const row = t && q.token.get(hashToken(t));
    if (!row || row.kind !== kind || (row.expires_at && row.expires_at < now())) {
      return next(new HttpError(401, kind === 'staff' ? 'Please sign in again.' : 'This phone is no longer linked to Rise. Ask your care team for a new link code.'));
    }
    q.touchToken.run(now(), row.token_hash);
    req.tokenHash = row.token_hash;
    if (kind === 'patient') {
      const p = patientFromRow(q.patient.get(row.subject_id));
      if (!p) return next(new HttpError(401, 'This account was deleted.'));
      req.patient = p;
    } else {
      const s = q.staffById.get(row.subject_id);
      if (!s) return next(new HttpError(401, 'Please sign in again.'));
      req.staff = s;
    }
    next();
  };
  const patientAuth = auth('patient');
  const staffAuth = auth('staff');
  const adminOnly = (req, _res, next) => next(req.staff.role === 'admin' ? undefined : new HttpError(403, 'Only clinic admins can do that.'));
  const clinicPatient = (req) => {
    const p = loadPatient(req.params.id);
    if (p.providerCode !== req.staff.provider_code) throw new HttpError(404, 'Patient not found');
    return p;
  };
  const staffOut = (s) => ({ id: s.id, name: s.name, email: s.email, role: s.role });
  const clinicOut = (code) => { const pr = q.provider.get(code); return { code: pr.code, name: pr.name, aiEnabled: ai.enabled(code) }; };

  // ---------- public ----------
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/patients', (req, res) => {
    const b = req.body ?? {};
    const code = String(b.providerCode ?? '').trim().toUpperCase();
    need(q.provider.get(code), 'That provider code was not found. Check the code your care team gave you.');
    const firstName = String(b.firstName ?? '').trim().slice(0, 40);
    need(firstName, 'Please enter your first name.');
    const age = num(b.age);
    need(Number.isInteger(age) && age >= 18 && age <= 110, 'Please enter an age between 18 and 110.');
    need(SEX.includes(b.sex), 'Please choose an answer for sex.');
    const p = {
      firstName, age, sex: b.sex,
      menopause: b.sex === 'female' && YES_NO.includes(b.menopause) ? b.menopause : null,
      medication: String(b.medication ?? '').slice(0, 60) || null,
      dose: String(b.dose ?? '').slice(0, 30) || null,
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(b.startDate ?? '') ? b.startDate : null,
      startWeightLb: num(b.startWeightLb), currentWeightLb: num(b.currentWeightLb),
      activity: ACTIVITY.includes(b.activity) ? b.activity : null,
      falls: FALLS.includes(b.falls) ? b.falls : null,
      jointPain: YES_NO.includes(b.jointPain) ? b.jointPain : null,
      goal: String(b.goal ?? '').trim().slice(0, 120) || null,
      heightIn: num(b.heightIn),
    };
    need(p.heightIn == null || (p.heightIn >= 48 && p.heightIn <= 90), 'Please enter a height between 4 and 7.5 feet.');
    for (const w of [p.startWeightLb, p.currentWeightLb]) need(w == null || (w >= 60 && w <= 800), 'Please enter a weight between 60 and 800 lb.');
    need(!p.startDate || p.startDate <= now().slice(0, 10), 'The start date can’t be in the future.');
    const { tier, reasons } = computeTier(p);
    const id = newId();
    q.insertPatient.run(id, code, p.firstName, p.age, p.sex, p.menopause, p.medication, p.dose, p.startDate,
      p.startWeightLb, p.currentWeightLb, p.activity, p.falls, p.jointPain, p.goal, p.heightIn, tier, JSON.stringify(reasons), now());
    audit('patient', id, 'patient.enroll', { patientId: id, providerCode: code });
    res.status(201).json({ ...withChecks(loadPatient(id)), token: issueToken('patient', id), messages: [] });
  });

  // Move a patient to a new phone with a one-time code from their care team.
  app.post('/api/patients/link', (req, res) => {
    const code = String(req.body?.code ?? '').replace(/\D/g, '');
    need(linkLimit.hit(req.ip), 'Too many tries. Please wait 15 minutes and try again.');
    const row = code.length === 6 && q.link.get(hashToken(code));
    if (!row || row.expires_at < now()) throw new HttpError(400, 'That code didn’t work. Codes last 30 minutes; ask your care team for a new one.');
    q.deleteLink.run(row.code_hash);
    const p = loadPatient(row.patient_id);
    audit('patient', p.id, 'patient.link', { patientId: p.id, providerCode: p.providerCode });
    res.json({ ...patientView(p), token: issueToken('patient', p.id) });
  });

  // ---------- patient ----------
  const patientView = (p) => {
    const full = withChecks(p);
    const last = full.checks[full.checks.length - 1];
    const messages = followUpsFor(p.id).filter((f) => f.kind === 'message').map((f) => ({ id: f.id, from: f.staffName, note: f.note, createdAt: f.createdAt }));
    return { ...full, messages, plan: last ? weeklyPlan(p, last, last.weightLb) : null };
  };

  app.get('/api/me', patientAuth, (req, res) => res.json(patientView(req.patient)));

  app.post('/api/me/checks', patientAuth, (req, res) => {
    const p = req.patient;
    const b = req.body ?? {};
    const stands = num(b.stands);
    need(Number.isInteger(stands) && stands >= 0 && stands <= 40, 'Stands must be a whole number from 0 to 40.');
    const confidence = num(b.confidence);
    need(confidence == null || (confidence >= 0 && confidence <= 1), 'Confidence must be between 0 and 1.');
    const c = {
      stands, confidence, durationSec: num(b.durationSec) ?? 30, sleptPoorly: !!b.sleptPoorly, painOrIll: !!b.painOrIll,
      method: ['demo', 'manual'].includes(b.method) ? b.method : 'phone-video',
      weightLb: num(b.weightLb), leanMassLb: num(b.leanMassLb), bodyFatPct: num(b.bodyFatPct), asmKg: num(b.asmKg),
      bodyCompMethod: METHODS.includes(b.bodyCompMethod) ? b.bodyCompMethod : null, gripKg: num(b.gripKg),
      bodyCompDetail: cleanDetail(b.bodyCompDetail),
    };
    need(c.durationSec >= 25 && c.durationSec <= 35, 'The chair check must last 30 seconds.');
    need(c.weightLb == null || (c.weightLb >= 60 && c.weightLb <= 800), 'Weight must be between 60 and 800 lb.');
    need(c.leanMassLb == null || (c.leanMassLb >= 30 && c.leanMassLb <= 300), 'Lean mass must be between 30 and 300 lb.');
    need(c.leanMassLb == null || c.weightLb != null, 'Please enter today’s weight with your lean mass.');
    need(c.leanMassLb == null || c.leanMassLb < c.weightLb, 'Lean mass must be less than your weight. Check the numbers from your scan.');
    need(c.leanMassLb == null || c.bodyCompMethod, 'Please choose where your body composition numbers came from.');
    need(c.bodyFatPct == null || (c.bodyFatPct >= 3 && c.bodyFatPct <= 75), 'Body fat must be between 3% and 75%.');
    need(c.leanMassLb == null || c.bodyFatPct == null || Math.abs((1 - c.leanMassLb / c.weightLb) * 100 - c.bodyFatPct) <= 6,
      'Lean mass and body fat don’t add up. Check both numbers against your scan.');
    need(c.gripKg == null || (c.gripKg >= 2 && c.gripKg <= 90), 'Grip must be between 2 and 90 kg.');
    need(c.asmKg == null || (c.asmKg >= 5 && c.asmKg <= 60), 'Appendicular lean mass must be between 5 and 60 kg.');
    const history = q.checks.all(p.id).map(checkFromRow);
    const r = evaluateCheck(p, history, c);
    const { lastInsertRowid } = insertCheck(db, p.id, c, r);
    if (c.weightLb != null) q.updateWeight.run(c.weightLb, p.id);
    const fresh = loadPatient(p.id);
    const view = patientView(fresh);
    res.status(201).json({ ...r, id: Number(lastInsertRowid), plan: weeklyPlan(fresh, r, c.weightLb), patient: view, aiAvailable: ai.enabled(p.providerCode) });
  });

  // Personalized message for one check. Falls back to the rules' own wording when AI is off or fails.
  app.get('/api/me/checks/:checkId/coach', patientAuth, h(async (req, res) => {
    const p = req.patient;
    const row = q.check.get(Number(req.params.checkId), p.id);
    if (!row) throw new HttpError(404, 'Check not found');
    const check = checkFromRow(row);
    const plan = weeklyPlan(p, check, check.weightLb);
    if (!ai.enabled(p.providerCode)) return res.json({ ai: false, plan });
    try {
      res.json({ ...(await ai.coach(p, check, plan)), plan });
    } catch (e) {
      console.warn('coach fallback:', e.code ?? e.message);
      res.json({ ai: false, plan, error: e.code ?? 'ai_error' });
    }
  }));

  // Read a photo or PDF of a body composition printout. The file is not stored.
  app.post('/api/me/read-report', patientAuth, h(async (req, res) => {
    const { data, mediaType } = req.body ?? {};
    need(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mediaType), 'Please use a photo (JPEG or PNG) or a PDF.');
    need(typeof data === 'string' && data.length > 100 && data.length < 11_500_000 && /^[A-Za-z0-9+/=]+$/.test(data.slice(0, 2000)), 'That file could not be read.');
    if (!ai.enabled(req.patient.providerCode)) throw new HttpError(503, 'Reading printouts needs AI, which your clinic hasn’t turned on yet. Type the numbers in instead.');
    const out = await ai.readReport(req.patient.providerCode, { data, mediaType });
    audit('patient', req.patient.id, 'report.read', { patientId: req.patient.id, providerCode: req.patient.providerCode });
    res.json(out);
  }));

  app.get('/api/me/reminder.ics', patientAuth, (req, res) => {
    const p = withChecks(req.patient);
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="rise-check.ics"' });
    res.send(reminderIcs({ due: p.nextDue, everyDays: p.checkEveryDays, uid: `${p.id}@rise` }));
  });

  // Patient deletes their data. Checks and notes are removed; an anonymous stub keeps the audit trail intact.
  app.delete('/api/me', patientAuth, (req, res) => {
    const id = req.patient.id;
    q.deleteChecks.run(id); q.deleteFollowUps.run(id); q.deleteLinksFor.run(id);
    q.softDelete.run(now(), id);
    q.deleteTokensFor.run('patient', id);
    audit('patient', id, 'patient.delete', { patientId: id, providerCode: req.patient.providerCode });
    res.status(204).end();
  });

  // ---------- care team ----------
  app.post('/api/clinics', (req, res) => {
    const b = req.body ?? {};
    const clinicName = String(b.clinicName ?? '').trim().slice(0, 80);
    const name = String(b.name ?? '').trim().slice(0, 60);
    const email = String(b.email ?? '').trim().toLowerCase();
    need(clinicName, 'Please enter your clinic’s name.');
    need(name, 'Please enter your name.');
    need(EMAIL.test(email), 'Please enter a valid email.');
    need(String(b.password ?? '').length >= 10, 'Use a password of at least 10 characters.');
    need(!q.staffByEmail.get(email), 'An account with that email already exists. Sign in instead.');
    let code;
    do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''); } while (q.provider.get(code));
    const id = newId();
    db.exec('BEGIN');
    try {
      q.insertProvider.run(code, clinicName, now());
      q.insertStaff.run(id, code, email, name, 'admin', hashPassword(b.password), now());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit('staff', id, 'clinic.create', { providerCode: code });
    res.status(201).json({ token: issueToken('staff', id, STAFF_SESSION_HOURS), staff: staffOut(q.staffById.get(id)), clinic: clinicOut(code) });
  });

  app.post('/api/staff/login', (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    need(signInLimit.hit(`${req.ip}|${email}`), 'Too many sign-in attempts. Please wait 15 minutes.');
    const s = q.staffByEmail.get(email);
    if (!s || !verifyPassword(password, s.password_hash)) throw new HttpError(401, 'That email and password don’t match.');
    signInLimit.reset(`${req.ip}|${email}`);
    audit('staff', s.id, 'staff.login', { providerCode: s.provider_code });
    res.json({ token: issueToken('staff', s.id, STAFF_SESSION_HOURS), staff: staffOut(s), clinic: clinicOut(s.provider_code) });
  });

  app.post('/api/staff/logout', staffAuth, (req, res) => { q.deleteToken.run(req.tokenHash); res.status(204).end(); });

  app.get('/api/staff/me', staffAuth, (req, res) => res.json({ staff: staffOut(req.staff), clinic: clinicOut(req.staff.provider_code) }));

  app.get('/api/clinic/patients', staffAuth, (req, res) => {
    const code = req.staff.provider_code;
    const today = new Date().toISOString().slice(0, 10);
    const patients = q.patientsFor.all(code).map((r) => withChecks(patientFromRow(r))).map((p) => {
      const last = p.checks[p.checks.length - 1];
      const fus = followUpsFor(p.id);
      const lastFu = fus.filter((f) => f.kind !== 'message' || true).slice(-1)[0] ?? null;
      const handled = last && fus.some((f) => ['reviewed', 'contacted', 'referred'].includes(f.kind) && f.createdAt >= last.createdAt);
      return {
        id: p.id, firstName: p.firstName, age: p.age, sex: p.sex, medication: p.medication, startDate: p.startDate,
        tier: p.tier, state: last?.state ?? null, flagged: last?.flagged ?? false, lastCheck: last?.createdAt ?? null,
        recent: p.checks.slice(-3).map((c) => c.stands), latest: last?.stands ?? null,
        belowNorm: last?.belowNorm ?? false, normCutoff: last?.normCutoff ?? null, normBand: last?.normBand ?? null,
        overdue: last ? last.retestDate < today : true,
        massState: last?.domains?.mass?.state ?? null, leanShare: last?.domains?.mass?.leanShare ?? null,
        gripState: last?.domains?.grip?.state ?? null, gripKg: last?.gripKg ?? null, reasons: last?.reasons ?? [],
        needsReview: Boolean(last && last.state !== 'steady' && !last.flagged && !handled),
        lastFollowUp: lastFu ? { kind: lastFu.kind, createdAt: lastFu.createdAt, by: lastFu.staffName } : null,
      };
    });
    patients.sort((a, b) =>
      Number(b.needsReview) - Number(a.needsReview) ||
      (STATE_RANK[a.state] ?? 3) - (STATE_RANK[b.state] ?? 3) ||
      (a.tier === 'higher' ? 0 : 1) - (b.tier === 'higher' ? 0 : 1) ||
      String(b.lastCheck).localeCompare(String(a.lastCheck)));
    const pr = q.provider.get(code);
    res.json({ code: pr.code, name: pr.name, patients, aiEnabled: ai.enabled(code) });
  });

  app.get('/api/clinic/patients/:id', staffAuth, (req, res) => {
    const p = clinicPatient(req);
    audit('staff', req.staff.id, 'patient.view', { patientId: p.id, providerCode: p.providerCode });
    const full = withChecks(p);
    const last = full.checks[full.checks.length - 1];
    res.json({ ...full, followUps: followUpsFor(p.id), plan: last ? weeklyPlan(p, last, last.weightLb) : null });
  });

  app.get('/api/clinic/patients/:id/export', staffAuth, (req, res) => {
    const p = withChecks(clinicPatient(req));
    audit('staff', req.staff.id, 'patient.export', { patientId: p.id, providerCode: p.providerCode });
    res.json(toExport(p));
  });

  app.post('/api/clinic/patients/:id/follow-ups', staffAuth, (req, res) => {
    const p = clinicPatient(req);
    const kind = req.body?.kind;
    need(FOLLOW_UP_KINDS.includes(kind), 'Choose what you did: reviewed, contacted, message, note or referred.');
    const note = String(req.body?.note ?? '').trim().slice(0, 1000) || null;
    need(kind !== 'message' || note, 'Write the message for the patient.');
    const checkId = num(req.body?.checkId);
    need(checkId == null || q.check.get(checkId, p.id), 'That check was not found.');
    q.insertFollowUp.run(p.id, checkId, req.staff.id, kind, note, now());
    audit('staff', req.staff.id, `followup.${kind}`, { patientId: p.id, providerCode: p.providerCode });
    res.status(201).json(followUpsFor(p.id));
  });

  app.post('/api/clinic/patients/:id/link-code', staffAuth, (req, res) => {
    const p = clinicPatient(req);
    q.deleteLinksFor.run(p.id);
    let code;
    do { code = newLinkCode(); } while (q.link.get(hashToken(code)));
    const expiresAt = new Date(Date.now() + LINK_CODE_MINUTES * 60e3).toISOString();
    q.insertLink.run(hashToken(code), p.id, expiresAt, req.staff.id);
    audit('staff', req.staff.id, 'linkcode.create', { patientId: p.id, providerCode: p.providerCode });
    res.status(201).json({ code, expiresAt });
  });

  // Draft clinical note: AI when available, otherwise a structured template.
  app.get('/api/clinic/patients/:id/note', staffAuth, h(async (req, res) => {
    const p = withChecks(clinicPatient(req));
    audit('staff', req.staff.id, 'note.generate', { patientId: p.id, providerCode: p.providerCode });
    if (!p.checks.length || !ai.enabled(p.providerCode)) return res.json(templateNote(p));
    try {
      res.json(await ai.providerNote(p, followUpsFor(p.id)));
    } catch (e) {
      console.warn('note fallback:', e.code ?? e.message);
      res.json({ ...templateNote(p), error: e.code ?? 'ai_error' });
    }
  }));

  app.get('/api/clinic/staff', staffAuth, (req, res) => res.json(q.staffFor.all(req.staff.provider_code).map((s) => ({ ...s, createdAt: s.created_at, created_at: undefined }))));

  app.post('/api/clinic/staff', staffAuth, adminOnly, (req, res) => {
    const b = req.body ?? {};
    const email = String(b.email ?? '').trim().toLowerCase();
    const name = String(b.name ?? '').trim().slice(0, 60);
    need(name, 'Please enter their name.');
    need(EMAIL.test(email), 'Please enter a valid email.');
    need(String(b.password ?? '').length >= 10, 'Use a temporary password of at least 10 characters.');
    need(!q.staffByEmail.get(email), 'Someone already uses that email.');
    const role = b.role === 'admin' ? 'admin' : 'nurse';
    const id = newId();
    q.insertStaff.run(id, req.staff.provider_code, email, name, role, hashPassword(b.password), now());
    audit('staff', req.staff.id, 'staff.add', { providerCode: req.staff.provider_code, detail: { email, role } });
    res.status(201).json({ id, name, email, role });
  });

  app.get('/api/clinic/settings', staffAuth, (req, res) => {
    const own = q.setting.get(`ai_key:${req.staff.provider_code}`)?.value;
    res.json({ aiEnabled: ai.enabled(req.staff.provider_code), aiKeySource: own ? 'clinic' : aiKey(null) ? 'server' : null,
      aiKeyHint: own ? `…${own.slice(-4)}` : null });
  });

  app.put('/api/clinic/settings/ai-key', staffAuth, adminOnly, h(async (req, res) => {
    const key = String(req.body?.key ?? '').trim();
    if (!key) {
      q.deleteSetting.run(`ai_key:${req.staff.provider_code}`);
    } else {
      need(/^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(key), 'That doesn’t look like an Anthropic API key. It starts with sk-ant-.');
      q.putSetting.run(`ai_key:${req.staff.provider_code}`, key, now());
    }
    audit('staff', req.staff.id, key ? 'settings.ai_key_set' : 'settings.ai_key_removed', { providerCode: req.staff.provider_code });
    res.json({ aiEnabled: ai.enabled(req.staff.provider_code), aiKeyHint: key ? `…${key.slice(-4)}` : null });
  }));

  app.get('/api/clinic/audit', staffAuth, adminOnly, (req, res) => {
    res.json(q.auditFor.all(req.staff.provider_code).map((a) => ({ at: a.at, actor: a.actor_kind === 'staff' ? a.staff_name : 'Patient', action: a.action, patientId: a.patient_id })));
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? (err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500);
    if (status === 500) console.error(err);
    const msg = status === 500 ? 'Something went wrong on our side. Please try again.'
      : status === 413 ? 'That file is too large. Try a smaller photo.' : err.message;
    res.status(status).json({ error: msg, ...(err.code ? { code: err.code } : {}) });
  });
  return app;
}
