import { useEffect, useState } from 'react';
import { Link, useNavigate, type NavigateFunction } from 'react-router-dom';
import { Screen, ErrorNote } from '../../components/Screen';
import { StatusSignal } from '../../components/StatusSignal';
import { Sparkline } from '../../components/Sparkline';
import { api } from '../../lib/api';
import { fmtDate, monthsSince, sexLabel } from '../../lib/format';
import { staffSession } from '../../lib/session';
import type { ClinicList, ClinicRow, FollowUpKind, StaffSession } from '../../lib/types';

// ---------- shared by the care-team pages ----------

/** True when the server says the staff sign-in is missing or expired. */
export const isSignedOut = (e: unknown) => (e as { status?: number } | null)?.status === 401;

/** Sends staff back to sign-in when their session has ended. Returns true if it did. */
export function signOutIf401(e: unknown, nav: NavigateFunction) {
  if (!isSignedOut(e)) return false;
  staffSession.clear();
  nav('/provider', { replace: true });
  return true;
}

export const FOLLOW_UP_VERB: Record<FollowUpKind, string> = {
  reviewed: 'Reviewed', contacted: 'Contacted', message: 'Messaged', note: 'Note added', referred: 'Referred',
};

/** "Contacted by Jordan Lee, RN · Oct 2" */
export function followUpLine(f: { kind: FollowUpKind; createdAt: string; by: string | null }) {
  return `${FOLLOW_UP_VERB[f.kind]}${f.by ? ` by ${f.by}` : ''} · ${fmtDate(f.createdAt)}`;
}

/** Clinic name, who is signed in, and the care-team links. */
export function ProviderBar({ me, clinicName, current }: { me: StaffSession | null; clinicName?: string; current: 'list' | 'settings' }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try { await api.logout(); } catch { /* the token is cleared either way */ }
    nav('/provider', { replace: true });
  }
  return (
    <nav className="prov-bar" aria-label="Care team">
      <div className="prov-bar__who">
        <span className="prov-bar__clinic">{me?.clinic.name ?? clinicName ?? 'Rise care team'}</span>
        {me && <span className="rise-caption">Signed in as {me.staff.name}{me.staff.role === 'admin' ? ' · admin' : ''}</span>}
      </div>
      <div className="prov-bar__links">
        {current === 'list' ? <Link className="rise-btn rise-btn--quiet" to="/provider/settings">Settings</Link>
          : <Link className="rise-btn rise-btn--quiet" to="/provider/list">Check-ins</Link>}
        <button type="button" className="rise-btn rise-btn--quiet" onClick={signOut} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </nav>
  );
}

// ---------- list ----------

function Row({ p }: { p: ClinicRow }) {
  const m = monthsSince(p.startDate);
  return (
    <Link className="rise-row prov-row" to={`/provider/patients/${encodeURIComponent(p.id)}`}>
      <div className="prov-row__who">
        <div className="rise-row__name">{p.firstName}</div>
        <div className="rise-row__meta">{sexLabel(p.sex)}, {p.age}{p.medication ? ` · ${p.medication}${m != null ? ` ${m} mo` : ''}` : ''} {p.tier === 'higher' && <span className="rise-tag">Higher risk</span>}</div>
      </div>
      <div className="prov-row__state">{p.state ? <StatusSignal state={p.state} /> : <span className="rise-row__meta">No checks</span>}</div>
      <div className="prov-row__spark"><Sparkline values={p.recent} cutoff={p.normCutoff} /></div>
      <span className="rise-num prov-row__nums" style={{ fontSize: 15 }}>
        {p.latest != null ? `${p.latest} reps` : '—'}{p.belowNorm ? ' (low)' : ''}
        {p.leanShare != null && <><br />lean {Math.round(p.leanShare * 100)}% of loss</>}
        {p.gripKg != null && <><br />grip {p.gripKg} kg</>}
      </span>
      <span className="rise-row__meta prov-row__when">{p.lastCheck ? `Checked ${fmtDate(p.lastCheck)}` : '—'}{p.overdue ? ' · overdue' : ''}</span>
      {p.reasons.length > 0 && p.state !== 'steady' && <span className="rise-row__meta prov-row__wide">Why: {p.reasons.join('; ')}.</span>}
      {(p.lastFollowUp || p.needsReview) && (
        <span className="rise-row__meta prov-row__wide">{p.lastFollowUp ? followUpLine(p.lastFollowUp) : 'No follow-up yet'}</span>
      )}
    </Link>
  );
}

function Section({ title, rows, empty, id }: { title: string; rows: ClinicRow[]; empty?: string; id: string }) {
  if (!rows.length && !empty) return null;
  return (
    <section className="stack" aria-labelledby={id}>
      <h2 className="rise-title" id={id}>{title} <span className="muted rise-num" style={{ fontWeight: 500 }}>{rows.length}</span></h2>
      <div className="rise-card prov-list">
        {rows.length ? rows.map((p) => <Row key={p.id} p={p} />) : <div className="prov-empty">{empty}</div>}
      </div>
    </section>
  );
}

export function ProviderList() {
  const nav = useNavigate();
  const [d, setD] = useState<ClinicList | null>(null);
  const [me, setMe] = useState<StaffSession | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showSteady, setShowSteady] = useState(false);

  useEffect(() => {
    if (!staffSession.get()) { nav('/provider', { replace: true }); return; }
    let live = true;
    api.clinicPatients().then((x) => { if (live) setD(x); })
      .catch((e: Error) => { if (live && !signOutIf401(e, nav)) setErr(e.message); });
    api.staffMe().then((x) => { if (live) setMe(x); }).catch((e) => { if (live) signOutIf401(e, nav); });
    return () => { live = false; };
  }, [nav]);

  if (err) return <Screen wide><ProviderBar me={me} current="list" /><ErrorNote message={err} /></Screen>;
  if (!d) return <Screen wide><ProviderBar me={me} current="list" /><p className="muted">Loading check-ins…</p></Screen>;

  const review = d.patients.filter((p) => p.needsReview);
  const other = d.patients.filter((p) => !p.needsReview && (p.state === 'checkin' || p.state === 'watch'));
  const steady = d.patients.filter((p) => !p.needsReview && p.state === 'steady');
  const none = d.patients.filter((p) => !p.needsReview && !p.state);
  const count = (s: string) => d.patients.filter((p) => p.state === s).length;

  return (
    <Screen wide>
      <ProviderBar me={me} clinicName={d.name} current="list" />
      <div className="prov-head">
        <div className="stack">
          <h1 className="display">Check-ins</h1>
          <p className="muted" style={{ margin: 0 }}>Patients join with code <b className="rise-num prov-code">{d.code}</b></p>
        </div>
        <div className="summary-chips prov-chips">
          <div className="chip-stat"><span className="rise-label">Needs review</span><b>{review.length}</b></div>
          <div className="chip-stat"><span className="rise-label">Check in</span><b>{count('checkin')}</b></div>
          <div className="chip-stat"><span className="rise-label">Watch</span><b>{count('watch')}</b></div>
          <div className="chip-stat"><span className="rise-label">Steady</span><b>{count('steady')}</b></div>
        </div>
      </div>

      <Section id="sec-review" title="Needs review" rows={review} empty="No one needs review right now." />
      <Section id="sec-other" title="Other Watch and Check in" rows={other} />

      <section className="rise-card prov-list" aria-label="Steady patients and patients with no checks">
        <div className="prov-fold">
          <span className="muted">{steady.length} {steady.length === 1 ? 'patient' : 'patients'} steady{none.length ? ` · ${none.length} with no checks yet` : ''}</span>
          {steady.length + none.length > 0 && (
            <button type="button" className="rise-btn rise-btn--quiet" aria-expanded={showSteady} onClick={() => setShowSteady((s) => !s)}>{showSteady ? 'Hide' : 'Show all'}</button>
          )}
        </div>
        {showSteady && [...steady, ...none].map((p) => <Row key={p.id} p={p} />)}
      </section>

      {d.patients.length === 0 && (
        <p className="note">No patients yet. Give patients the code <b className="rise-num">{d.code}</b>; they enter it when they set up Rise on their phone.</p>
      )}
      <p className="rise-caption" style={{ margin: 0 }}>Needs review: the latest check is Watch or Check in and no one has marked it reviewed, logged a call or logged a referral since. Within each group, sorted by urgency, then risk tier. Each result combines the 30-second chair stand (vs. CDC STEADI norms), lean share of weight lost (vs. the 20–40% seen in GLP-1 trials) and optional grip (vs. EWGSOP2 cut-offs). "Low" means below the STEADI norm for age and sex.</p>
    </Screen>
  );
}
