// In-browser stand-in for the Myovia API, used by the shareable demo build (VITE_DEMO=1).
// It runs the same rules engine, plans and example data as the server and keeps data in this browser only.
// AI features use the Claude artifact runtime when the demo runs inside Claude, and fall back to templates elsewhere.
// @ts-expect-error plain JS module shared with the server
import { computeTier, evaluateCheck, STATE_RANK, TIERS, METHOD_LABEL } from '../../../server/src/rules.js';
// @ts-expect-error plain JS module shared with the server
import { weeklyPlan } from '../../../server/src/plan.js';
// @ts-expect-error plain JS module shared with the server
import { templateNote } from '../../../server/src/aiText.js';
// @ts-expect-error plain JS module shared with the server
import { DEMO_PEOPLE, DEMO_DATES, demoDaysAgo } from '../../../server/src/demoData.js';
import type {
  AuditRow, Check, CheckResult, ClinicList, ClinicPatient, ClinicSettings, Coach, FollowUp, FollowUpKind, Me, Note, Patient, Plan,
  Reading, Staff, StaffSession, SubmitResult,
} from './types';
import { session, staffSession } from './session';
import { demoCoach, demoNote, demoReadReport, demoAiAvailable, demoKey } from './demoAi';

type Row = Check & { patientId: string };
type Base = Omit<Patient, 'checks' | 'nextDue' | 'checkEveryDays'>;
type Store = { patients: Base[]; checks: Row[]; followUps: FollowUp[]; audit: AuditRow[]; nextId: number; coach: Record<string, Coach> };
const KEY = 'rise.demo.v5';
const CLINIC = { code: 'DEMO42', name: 'Bay Area Weight Care (demo)' };
export const DEMO_LOGIN = { email: 'nurse@demo.rise', password: 'rise-demo-2026' };
const STAFF: Staff = { id: 'staff-demo', name: 'Jordan Lee, RN', email: DEMO_LOGIN.email, role: 'admin' };

function toRow(id: number, patientId: string, c: Record<string, unknown>, r: CheckResult): Row {
  return {
    id, patientId, createdAt: r.createdAt, stands: c.stands as number, durationSec: 30, confidence: (c.confidence as number) ?? null,
    sleptPoorly: !!c.sleptPoorly, painOrIll: !!c.painOrIll, leanMassLb: (c.leanMassLb as number) ?? null, bodyFatPct: (c.bodyFatPct as number) ?? null,
    method: (c.method as string) ?? 'phone-video', state: r.state, flagged: r.flagged, providerFlag: r.providerFlag, verdict: r.verdict,
    action: r.action, reason: r.reason, retestDate: r.retestDate, belowNorm: r.belowNorm, normCutoff: r.normCutoff, normBand: r.normBand,
    weightLb: (c.weightLb as number) ?? null, bodyCompMethod: (c.bodyCompMethod as Check['bodyCompMethod']) ?? null, asmKg: (c.asmKg as number) ?? null,
    gripKg: (c.gripKg as number) ?? null, domains: r.domains, reasons: r.reasons, bodyCompDetail: (c.bodyCompDetail as Record<string, unknown>) ?? null,
    captureDetail: (c.captureDetail as Check['captureDetail']) ?? null,
  };
}

function seed(): Store {
  const s: Store = { patients: [], checks: [], followUps: [], audit: [], nextId: 1, coach: {} };
  for (const [firstName, age, sex, menopause, medication, dose, startDate, sw, cw, activity, falls, jointPain, goal, heightIn, checks] of DEMO_PEOPLE) {
    const base = { firstName, age, sex, menopause, medication, dose, startDate, startWeightLb: sw, currentWeightLb: cw, activity, falls, jointPain, goal, heightIn };
    const { tier, reasons } = computeTier(base);
    const id = `demo-${String(firstName).toLowerCase()}`;
    s.patients.push({ ...base, id, providerCode: CLINIC.code, tier, tierReasons: reasons, createdAt: DEMO_DATES[0] });
    const hist: Row[] = [];
    (checks as [number, number, number, number | null][]).forEach(([stands, weightLb, leanMassLb, gripKg], i) => {
      const c = { stands, weightLb, leanMassLb, bodyFatPct: Math.round((1 - leanMassLb / weightLb) * 1000) / 10, gripKg, bodyCompMethod: firstName === 'Linda' ? 'rise-scan' : 'smart-scale', confidence: 0.92, createdAt: DEMO_DATES[i], method: 'phone-video' };
      const row = toRow(s.nextId++, id, c, evaluateCheck({ ...base, tier }, hist, c));
      s.checks.push(row); hist.push(row);
    });
  }
  // One patient already reviewed, so the list shows both states.
  s.followUps.push({ id: s.nextId++, patientId: 'demo-dennis', checkId: null, staffId: STAFF.id, staffName: STAFF.name, kind: 'contacted',
    note: 'Called Dennis. Starting a PT strength program next week.', createdAt: demoDaysAgo(5) });
  // Linda's earlier message from her nurse, so the example patient's home screen shows the loop closing.
  s.followUps.push({ id: s.nextId++, patientId: 'demo-linda', checkId: null, staffId: STAFF.id, staffName: STAFF.name, kind: 'message',
    note: 'Hi Linda, thanks for doing your check. Let’s add a protein shake at breakfast and the chair routine 3 days a week. I’ll call you Thursday.', createdAt: demoDaysAgo(43) });
  return s;
}

let mem: Store | null = null;
function load(): Store {
  if (mem) return mem;
  try { const raw = localStorage.getItem(KEY); if (raw) return (mem = JSON.parse(raw)); } catch { /* storage unavailable */ }
  return (mem = seed());
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* keep in memory only */ } }
const fail = (m: string, status = 400) => Promise.reject(Object.assign(new Error(m), { status }));
const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
const now = () => new Date().toISOString();
const log = (actor: string | null, action: string, patientId: string | null = null) => { load().audit.unshift({ at: now(), actor, action, patientId }); save(); };

function full(id: string): Patient | null {
  const s = load();
  const p = s.patients.find((x) => x.id === id);
  if (!p) return null;
  const checks = s.checks.filter((c) => c.patientId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const last = checks[checks.length - 1];
  return { ...p, checks, nextDue: last ? last.retestDate : new Date().toISOString().slice(0, 10), checkEveryDays: TIERS[p.tier].checkEveryDays };
}
const planFor = (p: Patient): Plan | null => { const last = p.checks[p.checks.length - 1]; return last ? weeklyPlan(p, last, last.weightLb) : null; };
const followUpsFor = (id: string) => load().followUps.filter((f) => f.patientId === id);
function meView(p: Patient): Me {
  const messages = followUpsFor(p.id).filter((f) => f.kind === 'message').map((f) => ({ id: f.id, from: f.staffName, note: f.note ?? '', createdAt: f.createdAt }));
  return { ...p, messages, plan: planFor(p) };
}
function currentPatient(): Patient | null { const t = session.get(); return t ? full(t) : null; }
const needStaff = () => (staffSession.get() === 'demo-staff' ? null : fail('Please sign in again.', 401));

export const demoApi = {
  createPatient(b: Record<string, unknown>): Promise<Me> {
    const s = load();
    const code = String(b.providerCode ?? '').trim().toUpperCase();
    if (code !== CLINIC.code) return fail('That provider code was not found. In this demo, use DEMO42.');
    const firstName = String(b.firstName ?? '').trim().slice(0, 40);
    const age = Number(b.age);
    if (!firstName) return fail('Please enter your first name.');
    if (!Number.isInteger(age) || age < 18 || age > 110) return fail('Please enter an age between 18 and 110.');
    const base = {
      firstName, age, sex: b.sex as Patient['sex'], menopause: b.sex === 'female' ? (b.menopause as string) ?? null : null,
      medication: (b.medication as string) || null, dose: (b.dose as string) || null, startDate: (b.startDate as string) || null,
      startWeightLb: num(b.startWeightLb), currentWeightLb: num(b.currentWeightLb), heightIn: num(b.heightIn),
      activity: (b.activity as string) || null, falls: (b.falls as string) || null, jointPain: (b.jointPain as string) || null, goal: String(b.goal ?? '').trim() || null,
    };
    const { tier, reasons } = computeTier(base);
    const id = `p-${Date.now().toString(36)}`;
    s.patients.push({ ...base, id, providerCode: code, tier, tierReasons: reasons, createdAt: now() });
    save(); session.set(id); log('Patient', 'patient.enroll', id);
    return delay({ ...meView(full(id)!), token: id });
  },
  linkPhone(code: string): Promise<Me> {
    const s = load() as Store & { links?: Record<string, string> };
    const digits = code.replace(/\D/g, '');
    const [id, exp] = (s.links?.[digits] ?? '').split('|');
    if (!id || !full(id) || Number(exp) < Date.now()) return fail('That code didn’t work. Codes last 30 minutes; ask your care team for a new one.');
    delete s.links![digits]; save(); session.set(id);
    return delay(meView(full(id)!));
  },
  me(): Promise<Me> { const p = currentPatient(); return p ? delay(meView(p)) : fail('This phone is no longer linked to Myovia.', 401); },
  submitCheck(b: Record<string, unknown>): Promise<SubmitResult> {
    const s = load();
    const p = currentPatient();
    if (!p) return fail('This phone is no longer linked to Myovia.', 401);
    const c = { ...b, stands: Number(b.stands), weightLb: num(b.weightLb), leanMassLb: num(b.leanMassLb), bodyFatPct: num(b.bodyFatPct),
      asmKg: num(b.asmKg), gripKg: num(b.gripKg), bodyCompMethod: typeof b.bodyCompMethod === 'string' && b.bodyCompMethod in METHOD_LABEL ? b.bodyCompMethod : null };
    if (!Number.isInteger(c.stands) || c.stands < 0 || c.stands > 40) return fail('Stands must be a whole number from 0 to 40.');
    if (c.weightLb != null && (c.weightLb < 60 || c.weightLb > 800)) return fail('Weight must be between 60 and 800 lb.');
    if (c.bodyFatPct != null && (c.bodyFatPct < 3 || c.bodyFatPct > 75)) return fail('Body fat must be between 3% and 75%.');
    if (c.gripKg != null && (c.gripKg < 2 || c.gripKg > 90)) return fail('Grip must be between 2 and 90 kg.');
    if (c.leanMassLb != null && c.weightLb != null && c.leanMassLb >= c.weightLb) return fail('Lean mass must be less than your weight. Check the numbers from your scan.');
    if (c.leanMassLb != null && !c.bodyCompMethod) return fail('Please choose where your body composition numbers came from.');
    const r = evaluateCheck(p, p.checks, c) as CheckResult;
    const id = s.nextId++;
    s.checks.push(toRow(id, p.id, c, r));
    const rec = s.patients.find((x) => x.id === p.id)!;
    if (c.weightLb != null) rec.currentWeightLb = c.weightLb;
    save();
    const fresh = full(p.id)!;
    return delay({ ...r, id, plan: weeklyPlan(fresh, r, c.weightLb), patient: meView(fresh), aiAvailable: Boolean(demoKey.get()) });
  },
  async coach(checkId: number): Promise<Coach> {
    const p = currentPatient();
    const check = p?.checks.find((c) => c.id === checkId);
    if (!p || !check) return fail('Check not found', 404);
    const plan = weeklyPlan(p, check, check.weightLb);
    const s = load();
    if (s.coach[checkId]) return { ...s.coach[checkId], plan };
    const out = await demoCoach(p, check, plan);
    if (!out) return { ai: false, plan };
    s.coach[checkId] = { ai: true, plan, ...out }; save();
    return s.coach[checkId];
  },
  async readReport(file: { data: string; mediaType: string }): Promise<Reading> {
    if (!(await demoAiAvailable())) return fail('Reading printouts needs AI. In the demo, add an Anthropic key in the care-team settings, or type the numbers in.', 503);
    const bytes = Uint8Array.from(atob(file.data), (ch) => ch.charCodeAt(0));
    const out = await demoReadReport(new Blob([bytes], { type: file.mediaType }));
    return out ?? fail('We couldn’t read that printout. Try a clearer photo, or type the numbers in.', 502);
  },
  async reminderIcs(): Promise<string> {
    const p = currentPatient();
    if (!p) return fail('Not linked', 401);
    // @ts-expect-error plain JS module shared with the server
    const { reminderIcs } = await import('../../../server/src/ics.js');
    return reminderIcs({ due: p.nextDue, everyDays: p.checkEveryDays, uid: `${p.id}@rise`, base: '' });
  },
  async deleteMe(): Promise<void> {
    const s = load(); const p = currentPatient();
    if (p) { s.patients = s.patients.filter((x) => x.id !== p.id); s.checks = s.checks.filter((c) => c.patientId !== p.id); s.followUps = s.followUps.filter((f) => f.patientId !== p.id); save(); }
    session.clear();
  },

  async login(email: string, password: string): Promise<StaffSession> {
    if (email.trim().toLowerCase() !== DEMO_LOGIN.email || password !== DEMO_LOGIN.password) return fail('That email and password don’t match. In this demo, use the sign-in shown below.', 401);
    staffSession.set('demo-staff'); log(STAFF.name, 'staff.login');
    return delay({ token: 'demo-staff', staff: STAFF, clinic: { ...CLINIC, aiEnabled: true } });
  },
  createClinic: (): Promise<StaffSession> => fail('Creating a clinic isn’t available in the demo. Sign in with the demo nurse account.'),
  async logout() { staffSession.clear(); },
  staffMe: (): Promise<StaffSession> => needStaff() ?? delay({ staff: STAFF, clinic: { ...CLINIC, aiEnabled: true } }),
  clinicPatients(): Promise<ClinicList> {
    const denied = needStaff(); if (denied) return denied;
    const s = load();
    const today = new Date().toISOString().slice(0, 10);
    const rank = STATE_RANK as Record<string, number>;
    const patients = s.patients.filter((p) => p.providerCode === CLINIC.code).map((x) => full(x.id)!).map((p) => {
      const last = p.checks[p.checks.length - 1];
      const fus = followUpsFor(p.id);
      const lastFu = fus[fus.length - 1];
      const handled = last && fus.some((f) => ['reviewed', 'contacted', 'referred'].includes(f.kind) && f.createdAt >= last.createdAt);
      return { id: p.id, firstName: p.firstName, age: p.age, sex: p.sex, medication: p.medication, startDate: p.startDate, tier: p.tier,
        state: last?.state ?? null, flagged: last?.flagged ?? false, lastCheck: last?.createdAt ?? null, recent: p.checks.slice(-3).map((k) => k.stands),
        latest: last?.stands ?? null, belowNorm: last?.belowNorm ?? false, normCutoff: last?.normCutoff ?? null, normBand: last?.normBand ?? null,
        overdue: last ? last.retestDate < today : true, massState: last?.domains?.mass?.state ?? null, leanShare: last?.domains?.mass?.leanShare ?? null,
        gripState: last?.domains?.grip?.state ?? null, gripKg: last?.gripKg ?? null, reasons: last?.reasons ?? [],
        needsReview: Boolean(last && last.state !== 'steady' && !last.flagged && !handled),
        lastFollowUp: lastFu ? { kind: lastFu.kind, createdAt: lastFu.createdAt, by: lastFu.staffName } : null };
    });
    patients.sort((a, b) => Number(b.needsReview) - Number(a.needsReview) || (rank[a.state ?? ''] ?? 3) - (rank[b.state ?? ''] ?? 3)
      || (a.tier === 'higher' ? 0 : 1) - (b.tier === 'higher' ? 0 : 1) || String(b.lastCheck).localeCompare(String(a.lastCheck)));
    return delay({ ...CLINIC, patients, aiEnabled: true });
  },
  clinicPatient(id: string): Promise<ClinicPatient> {
    const denied = needStaff(); if (denied) return denied;
    const p = full(id);
    if (!p) return fail('Patient not found', 404);
    log(STAFF.name, 'patient.view', id);
    return delay({ ...p, followUps: followUpsFor(id), plan: planFor(p) });
  },
  async exportPatient(id: string) {
    { const denied = needStaff(); if (denied) return denied as never; }
    const p = full(id); if (!p) return fail('Patient not found', 404);
    // @ts-expect-error plain JS module shared with the server
    const { toExport } = await import('../../../server/src/exportShape.js');
    log(STAFF.name, 'patient.export', id);
    return toExport(p);
  },
  followUp(id: string, kind: FollowUpKind, note?: string, checkId?: number): Promise<FollowUp[]> {
    const denied = needStaff(); if (denied) return denied;
    const s = load();
    if (kind === 'message' && !note?.trim()) return fail('Write the message for the patient.');
    s.followUps.push({ id: s.nextId++, patientId: id, checkId: checkId ?? null, staffId: STAFF.id, staffName: STAFF.name, kind, note: note?.trim() || null, createdAt: now() });
    save(); log(STAFF.name, `followup.${kind}`, id);
    return delay(followUpsFor(id));
  },
  linkCode(id: string) {
    { const denied = needStaff(); if (denied) return denied as never; }
    const s = load() as Store & { links?: Record<string, string> };
    const code = String(100000 + Math.floor(Math.random() * 900000));
    s.links = { ...(s.links ?? {}), [code]: `${id}|${Date.now() + 30 * 60e3}` }; save(); log(STAFF.name, 'linkcode.create', id);
    return delay({ code, expiresAt: new Date(Date.now() + 30 * 60e3).toISOString() });
  },
  async note(id: string): Promise<Note> {
    { const denied = needStaff(); if (denied) return denied as never; }
    const p = full(id); if (!p) return fail('Patient not found', 404);
    log(STAFF.name, 'note.generate', id);
    return (p.checks.length ? await demoNote(p, followUpsFor(id)) : null) ?? templateNote(p);
  },
  async settings(): Promise<ClinicSettings> {
    const k = demoKey.get();
    return { aiEnabled: await demoAiAvailable(), aiKeySource: k ? 'clinic' : (await demoAiAvailable()) ? 'server' : null, aiKeyHint: k ? `…${k.slice(-4)}` : null };
  },
  async setAiKey(key: string): Promise<ClinicSettings> {
    if (key && !/^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(key.trim())) return fail('That doesn’t look like an Anthropic API key. It starts with sk-ant-.');
    demoKey.set(key.trim());
    return this.settings();
  },
  staffList: () => delay([{ ...STAFF, createdAt: DEMO_DATES[0] }]),
  addStaff: (): Promise<Staff> => fail('Adding staff isn’t available in the demo.'),
  audit: () => delay(load().audit.slice(0, 100)),
  changePassword: (): Promise<void> => fail('Changing the password isn’t available in the demo.'),
  removeStaff: (): Promise<void> => fail('Removing staff isn’t available in the demo.'),
};

/** Demo: open the patient app as an example patient with months of history. */
export function demoSignInAs(id = 'demo-linda') { load(); session.set(id); }

export function demoReset() { mem = seed(); save(); session.clear(); staffSession.clear(); }
