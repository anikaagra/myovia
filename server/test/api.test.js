import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed, DEMO_STAFF, DEMO_ADMIN_EMAIL } from '../src/seed.js';

process.env.NODE_ENV = 'test';
process.env.RISE_DEMO_ADMIN_PASSWORD = 'admin-password-for-tests';

// Fake Claude client: records calls and returns a tool_use block shaped like the real API.
const calls = [];
let nextAnswer = null;
const fakeClient = () => ({
  messages: {
    create: async (req) => {
      calls.push(req);
      const name = req.tools[0].name;
      const input = nextAnswer ?? {
        result_message: { summary: 'Ana, your legs are as strong as last month.', why: 'Strong legs help you walk your dog.', tips: ['Add eggs at breakfast.'] },
        clinical_note: { summary: 'S', measures: 'M', assessment: 'A', plan: 'P', patientMessage: 'Hi Ana, nice work.' },
        body_composition: { kind: 'clinic-bia', device: 'InBody 570', measuredOn: '2026-10-01', weightLb: 189.6, leanMassLb: 111.3, bodyFatPct: 41.3, confidence: 'high' },
      }[name];
      nextAnswer = null;
      return { model: req.model, content: [{ type: 'tool_use', name, input }] };
    },
  },
});

let base; let server; let db;
before(async () => {
  db = openDb(':memory:');
  seed(db);
  server = createApp(db, { aiClient: fakeClient }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (method, p, { body, token } = {}) => fetch(base + p, {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const post = (p, body, token) => call('POST', p, { body, token });
const get = (p, token) => call('GET', p, { token });
const staffLogin = async () => (await (await post('/api/staff/login', { email: DEMO_STAFF.email, password: DEMO_STAFF.password })).json()).token;
const adminLogin = async () => (await (await post('/api/staff/login', { email: DEMO_ADMIN_EMAIL, password: 'admin-password-for-tests' })).json()).token;
const enroll = async (extra = {}) => (await post('/api/patients', { providerCode: 'DEMO42', firstName: 'Ana', age: 66, sex: 'female', menopause: 'yes',
  medication: 'semaglutide', startDate: '2026-08-01', startWeightLb: 200, currentWeightLb: 190, heightIn: 64, activity: 'some', falls: 'none',
  jointPain: 'no', goal: 'walk my dog', ...extra })).json();

test('intake rejects an unknown provider code with a clear message', async () => {
  const r = await post('/api/patients', { providerCode: 'NOPE', firstName: 'A', age: 60, sex: 'female' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /provider code/);
});

test('patient endpoints need the patient token', async () => {
  const p = await enroll();
  assert.ok(p.token && p.token.length > 30);
  assert.equal((await get('/api/me')).status, 401);
  assert.equal((await get('/api/me', 'x'.repeat(43))).status, 401);
  const me = await (await get('/api/me', p.token)).json();
  assert.equal(me.id, p.id);
  assert.equal(me.token, undefined, 'token is only returned once');
  const staff = await staffLogin();
  assert.equal((await get('/api/me', staff)).status, 401, 'a staff token is not a patient token');
});

test('full flow: intake, two checks, care team list, review, message, export', async () => {
  const p = await enroll();
  assert.equal(p.tier, 'higher');
  const c1 = await (await post('/api/me/checks', { stands: 13, confidence: 0.9 }, p.token)).json();
  assert.equal(c1.state, 'steady');
  assert.ok(c1.id > 0);
  assert.equal(c1.plan.routine.sessionsPerWeek, 3);
  const c2 = await (await post('/api/me/checks', { stands: 12, confidence: 0.9 }, p.token)).json();
  assert.equal(c2.state, 'steady', 'a 1-stand drop is within test noise');
  const c3 = await (await post('/api/me/checks', { stands: 11, confidence: 0.9 }, p.token)).json();
  assert.equal(c3.state, 'watch');
  assert.equal(c3.patient.checks.length, 3);

  const staff = await staffLogin();
  assert.equal((await get('/api/clinic/patients')).status, 401);
  const list = await (await get('/api/clinic/patients', staff)).json();
  assert.equal(list.code, 'DEMO42');
  const row = list.patients.find((x) => x.id === p.id);
  assert.equal(row.state, 'watch');
  assert.equal(row.needsReview, true);
  assert.equal(list.patients[0].needsReview, true, 'patients needing review sort first');

  const fu = await post(`/api/clinic/patients/${p.id}/follow-ups`, { kind: 'reviewed' }, staff);
  assert.equal(fu.status, 201);
  await post(`/api/clinic/patients/${p.id}/follow-ups`, { kind: 'message', note: 'Nice work, Ana. Call us if your knees hurt.' }, staff);
  const list2 = await (await get('/api/clinic/patients', staff)).json();
  assert.equal(list2.patients.find((x) => x.id === p.id).needsReview, false);
  const me = await (await get('/api/me', p.token)).json();
  assert.equal(me.messages.length, 1);
  assert.match(me.messages[0].from, /Jordan/);

  const exp = await (await get(`/api/clinic/patients/${p.id}/export`, staff)).json();
  assert.equal(exp.checks.length, 3);
  assert.equal(exp.checks[1].observations[0].measure, '30-second chair stand');
});

test('check validation', async () => {
  const p = await enroll({ firstName: 'B', sex: 'male', menopause: undefined });
  assert.equal((await post('/api/me/checks', { stands: 2.5 }, p.token)).status, 400);
  assert.equal((await post('/api/me/checks', { stands: 10, durationSec: 12 }, p.token)).status, 400);
  const r = await post('/api/me/checks', { stands: 12, weightLb: 200, leanMassLb: 130, bodyFatPct: 10, bodyCompMethod: 'smart-scale' }, p.token);
  assert.equal(r.status, 400, 'lean mass and body fat must agree');
});

test('staff can only see their own clinic', async () => {
  const p = await enroll();
  const other = await (await post('/api/clinics', { clinicName: 'Other Clinic', name: 'Sam', email: 'sam@other.test', password: 'long-enough-pw' })).json();
  assert.ok(other.token);
  assert.notEqual(other.clinic.code, 'DEMO42');
  assert.equal((await get(`/api/clinic/patients/${p.id}`, other.token)).status, 404);
  const list = await (await get('/api/clinic/patients', other.token)).json();
  assert.equal(list.patients.length, 0);
});

test('sign-in rejects a wrong password and limits attempts', async () => {
  const bad = await post('/api/staff/login', { email: 'nobody@x.test', password: 'nope' });
  assert.equal(bad.status, 401);
  let last;
  for (let i = 0; i < 9; i++) last = await post('/api/staff/login', { email: 'limit@x.test', password: 'nope' });
  assert.equal(last.status, 429);
  assert.match((await last.json()).error, /Too many/);
});

test('link code moves a patient to a new phone, once', async () => {
  const p = await enroll();
  const staff = await staffLogin();
  const { code } = await (await post(`/api/clinic/patients/${p.id}/link-code`, {}, staff)).json();
  assert.match(code, /^\d{6}$/);
  const linked = await (await post('/api/patients/link', { code })).json();
  assert.equal(linked.id, p.id);
  assert.ok(linked.token);
  assert.equal((await post('/api/patients/link', { code })).status, 400, 'codes work once');
});

test('patient can delete their data', async () => {
  const p = await enroll();
  await post('/api/me/checks', { stands: 12 }, p.token);
  assert.equal((await call('DELETE', '/api/me', { token: p.token })).status, 204);
  assert.equal((await get('/api/me', p.token)).status, 401);
  const staff = await staffLogin();
  const list = await (await get('/api/clinic/patients', staff)).json();
  assert.ok(!list.patients.some((x) => x.id === p.id));
});

test('body composition and grip are stored, validated and combined', async () => {
  const p = await enroll({ firstName: 'Cy', age: 70, sex: 'male', heightIn: 70 });
  const bad = await post('/api/me/checks', { stands: 12, weightLb: 200, leanMassLb: 130 }, p.token);
  assert.equal(bad.status, 400, 'lean mass needs a method');
  const c1 = await (await post('/api/me/checks', { stands: 12, weightLb: 220, leanMassLb: 140, bodyCompMethod: 'smart-scale', gripKg: 34 }, p.token)).json();
  assert.equal(c1.domains.mass.measured, true);
  assert.equal(c1.domains.grip.value, 34);
  const c2 = await (await post('/api/me/checks', { stands: 12, weightLb: 210, leanMassLb: 134, bodyCompMethod: 'smart-scale', gripKg: 33 }, p.token)).json();
  assert.equal(c2.domains.mass.leanShare, 0.6);
  assert.equal(c2.state, 'checkin');
  assert.equal(c2.patient.currentWeightLb, 210, 'current weight follows the latest check');
});

test('records where body composition came from', async () => {
  const p = await enroll({ firstName: 'Di', age: 58, menopause: 'no' });
  await post('/api/me/checks', { stands: 13, weightLb: 180, leanMassLb: 104, bodyFatPct: 42.2, bodyCompMethod: 'rise-scan',
    bodyCompDetail: { source: 'rise-scan', neckIn: 13.4, waistIn: 36.2, hipIn: 43.1, nested: { no: 1 }, ['x'.repeat(40)]: 1 } }, p.token);
  const staff = await staffLogin();
  const d = await (await get(`/api/clinic/patients/${p.id}`, staff)).json();
  assert.deepEqual(d.checks[0].bodyCompDetail, { source: 'rise-scan', neckIn: 13.4, waistIn: 36.2, hipIn: 43.1 });
  assert.equal(d.checks[0].domains.mass.methodLabel, 'Myovia phone scan');
  assert.equal(d.checks[0].domains.mass.estimate, true);
});

test('AI is off without a key and every feature falls back', async () => {
  const p = await enroll();
  const c = await (await post('/api/me/checks', { stands: 12 }, p.token)).json();
  assert.equal(c.aiAvailable, false);
  const coach = await (await get(`/api/me/checks/${c.id}/coach`, p.token)).json();
  assert.equal(coach.ai, false);
  assert.ok(coach.plan.protein.low >= 70);
  const staff = await staffLogin();
  const note = await (await get(`/api/clinic/patients/${p.id}/note`, staff)).json();
  assert.equal(note.ai, false);
  assert.match(note.summary, /Ana, 66/);
  const read = await post('/api/me/read-report', { mediaType: 'image/jpeg', data: 'A'.repeat(200) }, p.token);
  assert.equal(read.status, 503);
});

test('AI features work once a clinic admin adds a key, with safety checks', async () => {
  const staff = await adminLogin();
  const badKey = await call('PUT', '/api/clinic/settings/ai-key', { token: staff, body: { key: 'hello' } });
  assert.equal(badKey.status, 400);
  const ok = await (await call('PUT', '/api/clinic/settings/ai-key', { token: staff, body: { key: 'sk-ant-api03-' + 'a'.repeat(40) } })).json();
  assert.equal(ok.aiEnabled, true);
  assert.equal(ok.aiKeyHint, '…aaaa');
  const settings = await (await get('/api/clinic/settings', staff)).json();
  assert.equal(settings.aiKeySource, 'clinic');
  assert.ok(!JSON.stringify(settings).includes('a'.repeat(20)), 'key is never sent back');

  const p = await enroll();
  const c = await (await post('/api/me/checks', { stands: 12 }, p.token)).json();
  assert.equal(c.aiAvailable, true);
  calls.length = 0;
  const coach = await (await get(`/api/me/checks/${c.id}/coach`, p.token)).json();
  assert.equal(coach.ai, true);
  assert.match(coach.summary, /Ana/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[0].content, /walk my dog/);
  await get(`/api/me/checks/${c.id}/coach`, p.token);
  assert.equal(calls.length, 1, 'second request is served from cache');

  // Unsafe wording is rejected and the rules' wording is used instead.
  await post('/api/me/checks', { stands: 12 }, p.token);
  const c3 = (await (await get('/api/me', p.token)).json()).checks.at(-1);
  nextAnswer = { summary: 'You have sarcopenia.', why: 'Stop taking your medication.', tips: [] };
  const unsafe = await (await get(`/api/me/checks/${c3.id}/coach`, p.token)).json();
  assert.equal(unsafe.ai, false);

  const note = await (await get(`/api/clinic/patients/${p.id}/note`, staff)).json();
  assert.equal(note.ai, true);
  assert.equal(note.patientMessage, 'Hi Ana, nice work.');

  const read = await (await post('/api/me/read-report', { mediaType: 'image/jpeg', data: 'A'.repeat(400) }, p.token)).json();
  assert.equal(read.weightLb, 189.6);
  assert.equal(read.leanMassLb, 111.3);
  assert.equal(read.kind, 'clinic-bia');
  assert.equal(calls.at(-1).messages[0].content[0].type, 'image');

  const auditRows = await (await get('/api/clinic/audit', staff)).json();
  assert.ok(auditRows.some((a) => a.action === 'settings.ai_key_set'));
  await call('PUT', '/api/clinic/settings/ai-key', { token: staff, body: { key: '' } });
});

test('nurses cannot change admin settings', async () => {
  assert.equal((await call('PUT', '/api/clinic/settings/ai-key', { token: await staffLogin(), body: { key: '' } })).status, 403, 'the public demo login is a nurse');
  const admin = await adminLogin();
  const r = await post('/api/clinic/staff', { name: 'Nia', email: 'nia@demo.rise', password: 'temporary-pass' }, admin);
  assert.equal(r.status, 201);
  const nurse = (await (await post('/api/staff/login', { email: 'nia@demo.rise', password: 'temporary-pass' })).json()).token;
  assert.equal((await call('PUT', '/api/clinic/settings/ai-key', { token: nurse, body: { key: '' } })).status, 403);
  assert.equal((await get('/api/clinic/patients', nurse)).status, 200);
});

test('calendar reminder', async () => {
  const p = await enroll();
  const r = await get('/api/me/reminder.ics', p.token);
  assert.match(r.headers.get('content-type'), /text\/calendar/);
  const t = await r.text();
  assert.match(t, /BEGIN:VEVENT/);
  assert.match(t, /RRULE:FREQ=DAILY;INTERVAL=14/);
});

test('staff can change their password, and admins can remove staff', async () => {
  const admin = await adminLogin();
  const added = await (await post('/api/clinic/staff', { name: 'Kim', email: 'kim@demo.rise', password: 'first-password' }, admin)).json();
  const kim = (await (await post('/api/staff/login', { email: 'kim@demo.rise', password: 'first-password' })).json()).token;
  assert.equal((await post('/api/staff/password', { current: 'wrong', next: 'second-password' }, kim)).status, 400);
  assert.equal((await post('/api/staff/password', { current: 'first-password', next: 'second-password' }, kim)).status, 204);
  assert.equal((await post('/api/staff/login', { email: 'kim@demo.rise', password: 'second-password' })).status, 200);
  assert.equal((await call('DELETE', `/api/clinic/staff/${added.id}`, { token: admin })).status, 204);
  assert.equal((await get('/api/clinic/patients', kim)).status, 401, 'removed staff are signed out');
  assert.equal((await post('/api/staff/login', { email: 'kim@demo.rise', password: 'second-password' })).status, 401);
});

test('the server AI key is only used by allowed clinics', async () => {
  const db2 = openDb(':memory:'); seed(db2);
  const s2 = createApp(db2, { aiClient: fakeClient, anthropicKey: 'sk-ant-server-key-xxxxxxxxxxxxxxxxxxxx', aiClinics: 'DEMO42' }).listen(0);
  await new Promise((r) => s2.once('listening', r));
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  const p2 = (path, body, token) => fetch(b2 + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const other = await (await p2('/api/clinics', { clinicName: 'Self signup', name: 'X', email: 'x@self.test', password: 'long-enough-pw' })).json();
  assert.equal(other.clinic.aiEnabled, false, 'a self-signup clinic does not get the server key');
  const demo = await (await p2('/api/staff/login', { email: DEMO_STAFF.email, password: DEMO_STAFF.password })).json();
  assert.equal(demo.clinic.aiEnabled, true);
  s2.close();
});

test('deleting a patient removes their health data and AI text', async () => {
  const admin = await adminLogin();
  await call('PUT', '/api/clinic/settings/ai-key', { token: admin, body: { key: 'sk-ant-api03-' + 'b'.repeat(40) } });
  const p = await enroll();
  const c = await (await post('/api/me/checks', { stands: 12, weightLb: 190 }, p.token)).json();
  await get(`/api/me/checks/${c.id}/coach`, p.token);
  await get(`/api/clinic/patients/${p.id}/note`, admin);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM ai_outputs WHERE subject_id IN (?, ?)").get(p.id, String(c.id)).n >= 1);
  await call('DELETE', '/api/me', { token: p.token });
  const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(p.id);
  for (const col of ['start_weight_lb', 'current_weight_lb', 'height_in', 'start_date', 'goal', 'menopause']) assert.equal(row[col], null, col);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ai_outputs WHERE subject_id IN (?, ?)").get(p.id, String(c.id)).n, 0);
  await call('PUT', '/api/clinic/settings/ai-key', { token: admin, body: { key: '' } });
});

test('a large upload is refused before sign-in', async () => {
  const r = await fetch(base + '/api/me/read-report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'A'.repeat(2_000_000), mediaType: 'image/jpeg' }) });
  assert.equal(r.status, 401);
});

test('risk tier is recomputed at each check', async () => {
  const p = await enroll({ age: 60, sex: 'male', menopause: undefined, startDate: new Date(Date.now() - 70 * 864e5).toISOString().slice(0, 10), startWeightLb: 250, currentWeightLb: 245 });
  assert.equal(p.tier, 'standard');
  const c = await (await post('/api/me/checks', { stands: 14, weightLb: 210 }, p.token)).json();
  assert.equal(c.patient.tier, 'higher', 'losing 16% in 10 weeks is fast weight loss');
});
