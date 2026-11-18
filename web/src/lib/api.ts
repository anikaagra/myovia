import type { AuditRow, ClinicList, ClinicPatient, ClinicSettings, Coach, FollowUp, FollowUpKind, Me, Note, Patient, Reading, Staff, StaffSession, SubmitResult } from './types';
import { demoApi } from './demoApi';
import { session, staffSession } from './session';

export const IS_DEMO = import.meta.env.VITE_DEMO === '1';
/** The demo running inside a Claude artifact, where the camera and pose model aren't available: simulate them. */
export const SIMULATE_CAMERA = IS_DEMO && import.meta.env.VITE_ROUTER === 'memory';

export class ApiError extends Error { constructor(m: string, public status: number, public code?: string) { super(m); } }

async function req<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  let res: Response;
  const { token, ...rest } = init;
  try {
    res = await fetch(path, { ...rest, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) } });
  } catch {
    throw new ApiError("We couldn't reach Myovia. Check your internet connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? 'Something went wrong. Please try again.', res.status, body.code);
  return body as T;
}
const P = () => session.get();
const S = () => staffSession.get();
const json = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

/** Record-ready export: one entry per check with its observations (same shape as the server's /export route). */
// @ts-expect-error plain JS module shared with the server
import { toExport as shared } from '../../../server/src/exportShape.js';
export const toExport = (p: Patient): unknown => shared(p);

const serverApi = {
  // Patient
  createPatient: async (data: Record<string, unknown>) => { const me = await req<Me>('/api/patients', json('POST', data)); if (me.token) session.set(me.token); return me; },
  linkPhone: async (code: string) => { const me = await req<Me>('/api/patients/link', json('POST', { code })); if (me.token) session.set(me.token); return me; },
  me: () => req<Me>('/api/me', { token: P() }),
  submitCheck: (data: Record<string, unknown>) => req<SubmitResult>('/api/me/checks', { ...json('POST', data), token: P() }),
  coach: (checkId: number) => req<Coach>(`/api/me/checks/${checkId}/coach`, { token: P() }),
  readReport: (file: { data: string; mediaType: string }) => req<Reading>('/api/me/read-report', { ...json('POST', file), token: P() }),
  reminderIcs: async () => {
    const res = await fetch('/api/me/reminder.ics', { headers: { authorization: `Bearer ${P()}` } });
    if (!res.ok) throw new ApiError('Could not make the reminder.', res.status);
    return res.text();
  },
  deleteMe: async () => { await req<void>('/api/me', { method: 'DELETE', token: P() }); session.clear(); },

  // Care team
  login: async (email: string, password: string) => { const s = await req<StaffSession>('/api/staff/login', json('POST', { email, password })); staffSession.set(s.token!); return s; },
  createClinic: async (data: { clinicName: string; name: string; email: string; password: string }) => {
    const s = await req<StaffSession>('/api/clinics', json('POST', data)); staffSession.set(s.token!); return s;
  },
  logout: async () => { try { await req<void>('/api/staff/logout', { method: 'POST', token: S() }); } finally { staffSession.clear(); } },
  staffMe: () => req<StaffSession>('/api/staff/me', { token: S() }),
  clinicPatients: () => req<ClinicList>('/api/clinic/patients', { token: S() }),
  clinicPatient: (id: string) => req<ClinicPatient>(`/api/clinic/patients/${id}`, { token: S() }),
  exportPatient: (id: string) => req<unknown>(`/api/clinic/patients/${id}/export`, { token: S() }),
  followUp: (id: string, kind: FollowUpKind, note?: string, checkId?: number) =>
    req<FollowUp[]>(`/api/clinic/patients/${id}/follow-ups`, { ...json('POST', { kind, note, checkId }), token: S() }),
  linkCode: (id: string) => req<{ code: string; expiresAt: string }>(`/api/clinic/patients/${id}/link-code`, { ...json('POST', {}), token: S() }),
  note: (id: string) => req<Note>(`/api/clinic/patients/${id}/note`, { token: S() }),
  settings: () => req<ClinicSettings>('/api/clinic/settings', { token: S() }),
  setAiKey: (key: string) => req<ClinicSettings>('/api/clinic/settings/ai-key', { ...json('PUT', { key }), token: S() }),
  staffList: () => req<(Staff & { createdAt: string })[]>('/api/clinic/staff', { token: S() }),
  addStaff: (data: { name: string; email: string; password: string; role: 'admin' | 'nurse' }) => req<Staff>('/api/clinic/staff', { ...json('POST', data), token: S() }),
  audit: () => req<AuditRow[]>('/api/clinic/audit', { token: S() }),
  changePassword: (current: string, next: string) => req<void>('/api/staff/password', { ...json('POST', { current, next }), token: S() }),
  removeStaff: (id: string) => req<void>(`/api/clinic/staff/${id}`, { method: 'DELETE', token: S() }),
};

export type Api = typeof serverApi;
export const api: Api = IS_DEMO ? demoApi : serverApi;
