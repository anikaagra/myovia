import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Screen, ErrorNote } from '../../components/Screen';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { staffSession } from '../../lib/session';
import type { AuditRow, ClinicSettings, Staff, StaffSession } from '../../lib/types';
import { ProviderBar, signOutIf401 } from './ProviderList';

type Member = Staff & { createdAt: string };

const ACTION: Record<string, string> = {
  'clinic.create': 'Created the clinic account',
  'staff.login': 'Signed in',
  'staff.add': 'Added a team member',
  'patient.enroll': 'Joined the clinic',
  'patient.link': 'Linked a new phone',
  'patient.delete': 'Deleted their Rise data',
  'patient.view': 'Opened the patient record',
  'patient.export': 'Exported the record',
  'followup.reviewed': 'Marked reviewed',
  'followup.contacted': 'Logged a call',
  'followup.message': 'Sent a message to the patient',
  'followup.note': 'Added a note',
  'followup.referred': 'Logged a referral',
  'linkcode.create': 'Made a phone link code',
  'note.generate': 'Drafted a note',
  'report.read': 'Read a printout photo',
  'settings.ai_key_set': 'Saved the AI key',
  'settings.ai_key_removed': 'Removed the AI key',
};
const actionWords = (a: string) => ACTION[a] ?? a.replace(/[._]/g, ' ');
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const status = (e: unknown) => (e as { status?: number } | null)?.status;

export function ProviderSettings() {
  const nav = useNavigate();
  const [me, setMe] = useState<StaffSession | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [ai, setAi] = useState<ClinicSettings | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDone, setAiDone] = useState<string | null>(null);

  const [team, setTeam] = useState<Member[] | null>(null);
  const [teamErr, setTeamErr] = useState<string | null>(null);
  const [nm, setNm] = useState({ name: '', email: '', password: '', role: 'nurse' as 'nurse' | 'admin' });
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addDone, setAddDone] = useState<string | null>(null);

  const [log, setLog] = useState<AuditRow[] | null>(null);
  const [logErr, setLogErr] = useState<string | null>(null);

  /** 401 goes back to sign-in; anything else (including 403) shows in that section. */
  const fail = (e: unknown, set: (m: string) => void) => { if (!signOutIf401(e, nav)) set((e as Error).message); };

  useEffect(() => {
    if (!staffSession.get()) { nav('/provider', { replace: true }); return; }
    let live = true;
    api.staffMe().then((s) => {
      if (!live) return;
      setMe(s);
      if (s.staff.role === 'admin') {
        api.audit().then((x) => { if (live) setLog(x); })
          .catch((e) => { if (live) fail(e, (m) => setLogErr(status(e) === 403 ? 'Only clinic admins can see the activity log.' : m)); });
      }
    }).catch((e) => { if (live) fail(e, setErr); });
    api.settings().then((x) => { if (live) setAi(x); }).catch((e) => { if (live) fail(e, setAiErr); });
    api.staffList().then((x) => { if (live) setTeam(x); }).catch((e) => { if (live) fail(e, setTeamErr); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const admin = me?.staff.role === 'admin';

  async function saveKey(next: string) {
    setAiBusy(true); setAiErr(null); setAiDone(null);
    try {
      await api.setAiKey(next);
      // The save response leaves out the key source, so read the settings again.
      setAi(await api.settings());
      setKey('');
      setAiDone(next ? 'Key saved.' : 'Key removed.');
    } catch (e) { fail(e, (m) => setAiErr(status(e) === 403 ? 'Only clinic admins can change the AI key.' : m)); }
    setAiBusy(false);
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setAddErr(null); setAddDone(null);
    if (nm.password.length < 10) { setAddErr('Use a temporary password of at least 10 characters.'); return; }
    setAddBusy(true);
    try {
      const s = await api.addStaff({ name: nm.name.trim(), email: nm.email.trim(), password: nm.password, role: nm.role });
      setAddDone(`${s.name} can now sign in with ${s.email} and the temporary password. Share it with them directly, not by email.`);
      setNm({ name: '', email: '', password: '', role: 'nurse' });
      api.staffList().then(setTeam).catch(() => { /* list refresh is best-effort */ });
    } catch (e2) { fail(e2, (m) => setAddErr(status(e2) === 403 ? 'Only clinic admins can add team members.' : m)); }
    setAddBusy(false);
  }

  if (err) return <Screen wide><ProviderBar me={me} current="settings" /><ErrorNote message={err} /></Screen>;

  return (
    <Screen wide>
      <ProviderBar me={me} current="settings" />
      <div className="stack">
        <h1 className="display">Clinic settings</h1>
        {me && <p className="muted" style={{ margin: 0 }}>Patients join with code <b className="rise-num prov-code">{me.clinic.code}</b></p>}
        {me && !admin && <p className="rise-caption" style={{ margin: 0 }}>Only clinic admins can change these settings.</p>}
      </div>

      {/* AI */}
      <section className="rise-card stack prov-settings" aria-labelledby="ai-title">
        <div className="rise-step__head">
          <h2 className="rise-title" id="ai-title">AI</h2>
          {ai && <span className={`rise-tag${ai.aiEnabled ? ' prov-tag--ai' : ''}`}>{ai.aiEnabled ? 'On' : 'Off'}</span>}
        </div>
        <p className="rise-body-lg" style={{ fontSize: 16, lineHeight: '24px' }}>
          AI drafts care-team notes, personalizes the message patients see after a check, and reads photos of body composition printouts. The rules, not AI, decide Steady, Watch and Check in.
        </p>
        {!ai && !aiErr && <p className="muted" style={{ margin: 0 }}>Loading…</p>}
        {ai && (
          <dl className="kv">
            <dt>Status</dt><dd>{ai.aiEnabled ? 'AI is on' : 'AI is off. Notes and messages use the standard templates.'}</dd>
            <dt>Key</dt>
            <dd>
              {ai.aiKeySource === 'clinic' ? <>Your clinic’s Anthropic key{ai.aiKeyHint ? <> ending <span className="rise-num">{ai.aiKeyHint}</span></> : ''}</>
                : ai.aiKeySource === 'server' ? 'The Rise server’s key (set by whoever runs Rise)'
                : 'No key set'}
            </dd>
          </dl>
        )}
        {ai && admin && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void saveKey(key.trim()); }}>
            <div className="field">
              <label className="rise-label" htmlFor="ai-key">{ai.aiKeySource === 'clinic' ? 'Replace Anthropic API key' : 'Anthropic API key'}</label>
              <input id="ai-key" name="ai-key" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                className="rise-num" placeholder="sk-ant-…" value={key} onChange={(e) => { setKey(e.target.value); setAiErr(null); setAiDone(null); }} />
              <span className="rise-caption">Stored on the Rise server for your clinic only. Only the last 4 characters are shown again.</span>
            </div>
            <div className="row">
              <button type="submit" className="rise-btn rise-btn--primary" disabled={aiBusy || !key.trim()}>{aiBusy ? 'Saving…' : 'Save key'}</button>
              {ai.aiKeySource === 'clinic' && (
                <button type="button" className="rise-btn rise-btn--quiet" disabled={aiBusy} onClick={() => void saveKey('')}>Remove key</button>
              )}
            </div>
          </form>
        )}
        <ErrorNote message={aiErr} />
        <p className="rise-caption" role="status" aria-live="polite" style={{ margin: 0 }}>{aiDone ?? ''}</p>
      </section>

      {/* Team */}
      <section className="rise-card stack prov-settings" aria-labelledby="team-title">
        <h2 className="rise-title" id="team-title">Team</h2>
        <ErrorNote message={teamErr} />
        {!team && !teamErr && <p className="muted" style={{ margin: 0 }}>Loading…</p>}
        {team && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Added</th>{admin && <th><span className="sr-only">Remove</span></th>}</tr></thead>
              <tbody>
                {team.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}{s.id === me?.staff.id ? <span className="rise-caption"> (you)</span> : ''}</td>
                    <td style={{ wordBreak: 'break-all' }}>{s.email}</td>
                    <td>{s.role === 'admin' ? 'Admin' : 'Nurse'}</td>
                    <td className="rise-num">{s.createdAt ? fmtDate(s.createdAt, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    {admin && <td>{s.id !== me?.staff.id && <button className="rise-btn rise-btn--quiet danger" onClick={async () => {
                      if (!window.confirm(`Remove ${s.name}? They will be signed out and can no longer sign in.`)) return;
                      try { await api.removeStaff(s.id); setTeam((t) => t?.filter((x) => x.id !== s.id) ?? t); } catch (e) { setTeamErr((e as Error).message); }
                    }}>Remove</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {admin && (
          <form className="stack prov-add" onSubmit={addMember} autoComplete="off">
            <h3 className="rise-label" style={{ margin: 0 }}>Add a team member</h3>
            <div className="prov-form-grid">
              <div className="field"><label className="rise-label" htmlFor="nm-name">Name</label>
                <input id="nm-name" autoComplete="off" required maxLength={60} placeholder="For example: Sam Ortiz, RN" value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} /></div>
              <div className="field"><label className="rise-label" htmlFor="nm-email">Email</label>
                <input id="nm-email" type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} required value={nm.email} onChange={(e) => setNm({ ...nm, email: e.target.value })} /></div>
              <div className="field"><label className="rise-label" htmlFor="nm-pw">Temporary password</label>
                <input id="nm-pw" type="text" autoComplete="new-password" autoCapitalize="none" spellCheck={false} required minLength={10} className="rise-num" value={nm.password} onChange={(e) => setNm({ ...nm, password: e.target.value })} />
                <span className="rise-caption">At least 10 characters.</span></div>
              <div className="field"><label className="rise-label" htmlFor="nm-role">Role</label>
                <select id="nm-role" value={nm.role} onChange={(e) => setNm({ ...nm, role: e.target.value === 'admin' ? 'admin' : 'nurse' })}>
                  <option value="nurse">Nurse: patients and follow-up</option>
                  <option value="admin">Admin: also settings, team and activity log</option>
                </select></div>
            </div>
            <ErrorNote message={addErr} />
            <p className="rise-caption" role="status" aria-live="polite" style={{ margin: 0 }}>{addDone ?? ''}</p>
            <button type="submit" className="rise-btn rise-btn--primary" style={{ justifySelf: 'start' }} disabled={addBusy}>{addBusy ? 'Adding…' : 'Add team member'}</button>
          </form>
        )}
      </section>

      <PasswordCard />

      {/* Activity log */}
      {admin && (
        <section className="rise-card stack prov-settings" aria-labelledby="log-title">
          <h2 className="rise-title" id="log-title">Activity log</h2>
          <p className="rise-caption" style={{ margin: 0 }}>Who opened, changed or exported patient records, newest first. Last 200 entries.</p>
          <ErrorNote message={logErr} />
          {!log && !logErr && <p className="muted" style={{ margin: 0 }}>Loading…</p>}
          {log && (log.length ? (
            <div className="tbl-wrap prov-log">
              <table className="tbl">
                <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Patient</th></tr></thead>
                <tbody>
                  {log.map((a, i) => (
                    <tr key={`${a.at}-${i}`}>
                      <td className="rise-num">{when(a.at)}</td>
                      <td>{a.actor ?? 'Unknown'}</td>
                      <td>{actionWords(a.action)}</td>
                      <td className="rise-num">{a.patientId
                        ? <Link to={`/provider/patients/${encodeURIComponent(a.patientId)}`} title={a.patientId}>{a.patientId.slice(0, 8)}</Link>
                        : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="rise-caption" style={{ margin: 0 }}>No activity yet.</p>)}
        </section>
      )}
    </Screen>
  );
}

function PasswordCard() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="rise-card stack prov-settings" aria-labelledby="pw-title">
      <h2 className="rise-title" id="pw-title">Your password</h2>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault(); setErr(null); setMsg(null);
        try { await api.changePassword(cur, next); setCur(''); setNext(''); setMsg('Password changed. Other devices were signed out.'); }
        catch (x) { setErr((x as Error).message); }
      }}>
        <input type="text" name="username" autoComplete="username" hidden readOnly />
        <div className="field"><label className="rise-label" htmlFor="pw-cur">Current password</label>
          <input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div className="field"><label className="rise-label" htmlFor="pw-new">New password</label>
          <input id="pw-new" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <ErrorNote message={err} />
        {msg && <p className="note" role="status">{msg}</p>}
        <button type="submit" className="rise-btn rise-btn--secondary" style={{ justifySelf: 'start' }}>Change password</button>
      </form>
    </section>
  );
}
