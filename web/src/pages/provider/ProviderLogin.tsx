import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, ErrorNote } from '../../components/Screen';
import { api, IS_DEMO } from '../../lib/api';
import { DEMO_LOGIN } from '../../lib/demoApi';
import { staffSession } from '../../lib/session';

type Mode = 'signin' | 'create';

export function ProviderLogin() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>('signin');
  const [checking, setChecking] = useState(() => Boolean(staffSession.get()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [name, setName] = useState('');

  // Already signed in on this device: confirm the session is still good, then go to the list.
  useEffect(() => {
    if (!staffSession.get()) return;
    let live = true;
    api.staffMe()
      .then(() => { if (live) nav('/provider/list', { replace: true }); })
      .catch((e: { status?: number }) => { if (e?.status === 401) staffSession.clear(); if (live) setChecking(false); });
    return () => { live = false; };
  }, [nav]);

  function switchMode(m: Mode) { setMode(m); setErr(null); setPassword(''); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (mode === 'create' && password.length < 10) { setErr('Use a password of at least 10 characters.'); return; }
    setBusy(true);
    try {
      if (mode === 'signin') await api.login(email.trim(), password);
      else await api.createClinic({ clinicName: clinicName.trim(), name: name.trim(), email: email.trim(), password });
      nav('/provider/list', { replace: true });
    } catch (e2) {
      setErr((e2 as Error).message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  if (checking) return <Screen back={{ to: '/', label: 'Patient app' }}><p className="muted">Checking your sign-in…</p></Screen>;

  const creating = mode === 'create';
  return (
    <Screen back={{ to: '/', label: 'Patient app' }}>
      <div className="stack">
        <div className="rise-label">For care teams</div>
        <h1 className="display">{creating ? 'Create a clinic account' : 'Sign in to your check-in list'}</h1>
        {creating && <p className="muted" style={{ margin: 0 }}>You become the clinic admin. Myovia gives you a clinic code to share with patients, and you can add nurses later.</p>}
      </div>

      <form className="stack" onSubmit={submit} method="post">
        {creating && (
          <>
            <div className="field"><label className="rise-label" htmlFor="clinic-name">Clinic name</label>
              <input id="clinic-name" name="organization" autoComplete="organization" required maxLength={80} value={clinicName}
                onChange={(e) => { setErr(null); setClinicName(e.target.value); }} /></div>
            <div className="field"><label className="rise-label" htmlFor="staff-name">Your name</label>
              <input id="staff-name" name="name" autoComplete="name" required maxLength={60} placeholder="For example: Jordan Lee, RN" value={name}
                onChange={(e) => { setErr(null); setName(e.target.value); }} /></div>
          </>
        )}
        <div className="field"><label className="rise-label" htmlFor="email">Email</label>
          <input id="email" name="username" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off"
            spellCheck={false} required value={email} onChange={(e) => { setErr(null); setEmail(e.target.value); }} /></div>
        <div className="field"><label className="rise-label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete={creating ? 'new-password' : 'current-password'} required
            minLength={creating ? 10 : undefined} value={password} onChange={(e) => { setErr(null); setPassword(e.target.value); }}
            aria-describedby={creating ? 'pw-hint' : undefined} />
          {creating && <span id="pw-hint" className="rise-caption">At least 10 characters.</span>}
        </div>
        <ErrorNote message={err} />
        <button className="rise-btn rise-btn--primary rise-btn--block" type="submit" disabled={busy}>
          {busy ? (creating ? 'Creating account…' : 'Signing in…') : creating ? 'Create clinic account' : 'Sign in'}
        </button>
      </form>

      {IS_DEMO && !creating && (
        <div className="note stack" style={{ gap: 8 }}>
          <span>Demo sign-in: <b className="rise-num">{DEMO_LOGIN.email}</b>, password <b className="rise-num">{DEMO_LOGIN.password}</b>. It includes six example patients.</span>
          <button type="button" className="rise-btn rise-btn--secondary" style={{ justifySelf: 'start' }}
            onClick={() => { setEmail(DEMO_LOGIN.email); setPassword(DEMO_LOGIN.password); setErr(null); }}>Use demo sign-in</button>
        </div>
      )}

      <div className="row">
        <span className="muted">{creating ? 'Already have an account?' : 'New to Myovia?'}</span>
        <button type="button" className="rise-btn rise-btn--quiet" onClick={() => switchMode(creating ? 'signin' : 'create')}>
          {creating ? 'Sign in instead' : 'Create a clinic account'}
        </button>
      </div>
      <p className="rise-caption" style={{ margin: 0 }}>Sign-ins last 12 hours on this device. Sign out when you share a computer.</p>
    </Screen>
  );
}
