// Tokens live on this device only. A patient token links this phone to one patient; a staff token is a sign-in.
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: session only */ } };
const del = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export const session = {
  get: () => get('rise.patientToken'),
  set: (token: string) => set('rise.patientToken', token),
  clear: () => { del('rise.patientToken'); del('rise.patientId'); },
};
export const staffSession = {
  get: () => get('rise.staffToken'),
  set: (token: string) => set('rise.staffToken', token),
  clear: () => del('rise.staffToken'),
};
