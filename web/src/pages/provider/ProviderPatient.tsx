import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen, ErrorNote } from '../../components/Screen';
import { StatusSignal } from '../../components/StatusSignal';
import { RiseTrace } from '../../components/RiseTrace';
import { DomainSummary } from '../../components/DomainSummary';
import { api } from '../../lib/api';
import { fmtDate, sexLabel, signed } from '../../lib/format';
import { staffSession } from '../../lib/session';
import type { ClinicPatient, FollowUp, FollowUpKind, Note } from '../../lib/types';
import { signOutIf401 } from './ProviderList';

const ACT: Record<string, string> = { rarely: 'Rarely exercises', some: 'Light activity', regular: 'Exercises 2–3×/week', very: 'Strength trains most weeks' };
const FALLS: Record<string, string> = { none: 'None', once: 'One', more: 'More than one', skip: 'Not answered' };

const KIND_LABEL: Record<FollowUpKind, string> = {
  reviewed: 'Reviewed', contacted: 'Call logged', message: 'Message to patient', note: 'Note', referred: 'Referred',
};
type FormKind = Exclude<FollowUpKind, 'reviewed'>;
const FORM: Record<FormKind, { title: string; label: string; placeholder: string; required: boolean; save: string }> = {
  contacted: { title: 'Log a call', label: 'What you discussed (optional)', placeholder: 'For example: Talked through protein targets. Will add two strength sessions a week.', required: false, save: 'Log call' },
  referred: { title: 'Referred', label: 'Referred to (optional)', placeholder: 'For example: Dietitian, physical therapy', required: false, save: 'Log referral' },
  note: { title: 'Add note', label: 'Note for the care team', placeholder: 'Only the care team sees this.', required: true, save: 'Save note' },
  message: { title: 'Message patient', label: 'Message', placeholder: 'Write in plain words. The patient reads this in Rise.', required: true, save: 'Send message' },
};

const fullTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Clipboard with a fallback for browsers that block navigator.clipboard (older Safari, http). */
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

const noteText = (n: Note, who: string) => [
  `Rise muscle check note: ${who}${n.ai ? ' (AI draft; review before use)' : ''}`,
  '', 'Summary', n.summary, '', 'Measures', n.measures, '', 'Assessment', n.assessment, '', 'Suggested plan', n.plan,
  '', 'Suggested message to patient', n.patientMessage,
].join('\n');

export function ProviderPatient() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<ClinicPatient | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fail = (e: unknown, set: (m: string) => void) => { if (!signOutIf401(e, nav)) set((e as Error).message); };

  // Follow-ups
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [form, setForm] = useState<FormKind | null>(null);
  const [text, setText] = useState('');
  const [fuBusy, setFuBusy] = useState(false);
  const [fuErr, setFuErr] = useState<string | null>(null);
  const [fuDone, setFuDone] = useState<string | null>(null);
  const formRef = useRef<HTMLTextAreaElement>(null);

  // Draft note
  const [note, setNote] = useState<Note | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [noteCopied, setNoteCopied] = useState<'ok' | 'fail' | null>(null);

  // Link a new phone
  const [link, setLink] = useState<{ code: string; expiresAt: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);

  // Export
  const [exp, setExp] = useState<string | null>(null);
  const [expBusy, setExpBusy] = useState(false);
  const [expErr, setExpErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    if (!staffSession.get()) { nav('/provider', { replace: true }); return; }
    let live = true;
    setP(null); setErr(null); setNote(null); setLink(null); setExp(null); setForm(null);
    api.clinicPatient(id).then((x) => { if (live) { setP(x); setFollowUps(x.followUps); } })
      .catch((e) => { if (live) fail(e, setErr); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { if (form) formRef.current?.focus(); }, [form]);

  const back = { to: '/provider/list', label: 'All check-ins' };
  if (err) return <Screen wide back={back}><ErrorNote message={err} /></Screen>;
  if (!p) return <Screen wide back={back}><p className="muted">Loading patient…</p></Screen>;

  const last = p.checks[p.checks.length - 1];
  const base = p.checks[0];

  async function addFollowUp(kind: FollowUpKind, body?: string) {
    setFuErr(null); setFuDone(null);
    const trimmed = body?.trim() ?? '';
    if ((kind === 'message' || kind === 'note') && !trimmed) {
      setFuErr(kind === 'message' ? 'Write the message for the patient.' : 'Write the note first.');
      return;
    }
    setFuBusy(true);
    try {
      const list = await api.followUp(id, kind, trimmed || undefined, last?.id);
      setFollowUps(list);
      setForm(null); setText('');
      setFuDone(kind === 'message' ? 'Message sent. The patient sees it in their Rise app.' : `${KIND_LABEL[kind]}: saved.`);
    } catch (e) { fail(e, setFuErr); }
    setFuBusy(false);
  }
  function openForm(k: FormKind, prefill = '') {
    setForm(k); setText(prefill); setFuErr(null); setFuDone(null);
  }

  async function draftNote() {
    setDrafting(true); setNoteErr(null); setNoteCopied(null);
    try { setNote(await api.note(id)); } catch (e) { fail(e, setNoteErr); }
    setDrafting(false);
  }

  async function makeLink() {
    setLinkBusy(true); setLinkErr(null);
    try { setLink(await api.linkCode(id)); } catch (e) { fail(e, setLinkErr); }
    setLinkBusy(false);
  }

  async function getExport() {
    if (exp) return exp;
    setExpBusy(true); setExpErr(null);
    try { const j = JSON.stringify(await api.exportPatient(id), null, 2); setExp(j); return j; }
    catch (e) { fail(e, setExpErr); return null; }
    finally { setExpBusy(false); }
  }
  async function download() {
    const j = await getExport(); if (!j) return;
    const url = URL.createObjectURL(new Blob([j], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `rise-${p!.firstName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copyExport() {
    const j = await getExport(); if (!j) return;
    if (await copyText(j)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } else setShowJson(true);
  }
  async function toggleJson() {
    if (showJson) { setShowJson(false); return; }
    if (await getExport()) setShowJson(true);
  }

  const timeline = [...followUps].reverse();
  const f = form ? FORM[form] : null;

  return (
    <Screen wide back={back}>
      <div className="prov-head">
        <div className="stack">
          <div className="row"><h1 className="display">{p.firstName}</h1>{last && <StatusSignal state={last.state} />}{p.tier === 'higher' && <span className="rise-tag">Higher risk</span>}</div>
          <div className="muted">{sexLabel(p.sex)}, {p.age} · {p.medication ?? 'GLP-1'}{p.dose ? ` ${p.dose}` : ''}{p.startDate ? ` since ${fmtDate(p.startDate, { month: 'short', year: 'numeric' })}` : ''}</div>
        </div>
        <div className="row">
          <button type="button" className="rise-btn rise-btn--secondary" onClick={download} disabled={expBusy}>Download record</button>
          <button type="button" className="rise-btn rise-btn--quiet" onClick={copyExport} disabled={expBusy}>{copied ? 'Copied' : 'Copy record data'}</button>
          <button type="button" className="rise-btn rise-btn--quiet" onClick={toggleJson} disabled={expBusy}>{showJson ? 'Hide record data' : 'View record data'}</button>
        </div>
      </div>
      <ErrorNote message={expErr} />
      {showJson && exp && <pre className="rise-card tbl-wrap" style={{ margin: 0, fontSize: 13, lineHeight: '20px', maxHeight: 360, overflow: 'auto', fontFamily: 'var(--font-mono)' }}>{exp}</pre>}

      <div className="detail-grid">
        <div className="stack" style={{ gap: 24 }}>
          {last && (
            <section className="rise-card stack" aria-labelledby="why">
              <div className="rise-step__head"><h2 className="rise-title" id="why">Why this result</h2><StatusSignal state={last.state} /></div>
              {last.reasons.length ? <ul className="reasons">{last.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                : <p className="rise-caption" style={{ margin: 0 }}>Every measure is within range for this patient.</p>}
              {last.flagged && <p className="note">Readiness flag: the patient reported {[last.sleptPoorly && 'poor sleep', last.painOrIll && 'pain or illness'].filter(Boolean).join(' and ')}. Not escalated; retest in 7 days.</p>}
              <p className="rise-caption" style={{ margin: 0 }}><b>Patient was told:</b> {last.action}</p>
            </section>
          )}

          {/* Follow-up */}
          <section className="rise-card stack" aria-labelledby="fu-title">
            <h2 className="rise-title" id="fu-title">Follow-up</h2>
            <div className="prov-actions">
              <button type="button" className="rise-btn rise-btn--primary" disabled={fuBusy} onClick={() => { setForm(null); void addFollowUp('reviewed'); }}>Mark reviewed</button>
              {(['contacted', 'referred', 'note', 'message'] as FormKind[]).map((k) => (
                <button key={k} type="button" className="rise-btn rise-btn--secondary" aria-pressed={form === k} disabled={fuBusy}
                  onClick={() => (form === k ? setForm(null) : openForm(k))}>{FORM[k].title}</button>
              ))}
            </div>
            {f && form && (
              <form className="stack prov-fu-form" onSubmit={(e) => { e.preventDefault(); void addFollowUp(form, text); }}>
                <div className="field">
                  <label className="rise-label" htmlFor="fu-text">{f.label}</label>
                  <textarea id="fu-text" ref={formRef} className="prov-textarea" rows={form === 'message' ? 5 : 3} maxLength={1000}
                    placeholder={f.placeholder} required={f.required} value={text} onChange={(e) => { setText(e.target.value); setFuErr(null); }} />
                  {form === 'message' && <span className="rise-caption">The patient sees this message in their Rise app the next time they open it. Rise does not send a text or email.</span>}
                </div>
                <div className="row">
                  <button type="submit" className="rise-btn rise-btn--primary" disabled={fuBusy}>{fuBusy ? 'Saving…' : f.save}</button>
                  <button type="button" className="rise-btn rise-btn--quiet" onClick={() => { setForm(null); setText(''); setFuErr(null); }}>Cancel</button>
                </div>
              </form>
            )}
            <ErrorNote message={fuErr} />
            <p className="rise-caption" role="status" aria-live="polite" style={{ margin: 0 }}>{fuDone ?? ''}</p>
            {timeline.length ? (
              <ol className="prov-timeline">
                {timeline.map((x) => (
                  <li key={x.id}>
                    <div className="prov-timeline__head">
                      <b>{KIND_LABEL[x.kind]}</b>
                      <span className="rise-caption">{x.staffName ?? 'Care team'} · {fullTime(x.createdAt)}</span>
                    </div>
                    {x.note && <p className="prov-timeline__note">{x.note}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="rise-caption" style={{ margin: 0 }}>No follow-up yet.</p>}
          </section>

          {/* Draft note */}
          <section className="rise-card stack" aria-labelledby="note-title" aria-busy={drafting}>
            <div className="rise-step__head">
              <h2 className="rise-title" id="note-title">Draft note</h2>
              {note && <span className={`rise-tag${note.ai ? ' prov-tag--ai' : ''}`}>{note.ai ? 'AI draft — review before use' : 'Template'}</span>}
            </div>
            {!note && !drafting && <p className="rise-caption" style={{ margin: 0 }}>A chart-ready summary of this patient’s checks, with a suggested plan and message. You review and edit it before use.</p>}
            {drafting && <p className="prov-drafting" role="status"><span className="prov-spinner" aria-hidden="true" />Drafting… this can take up to 30 seconds.</p>}
            {note && !drafting && (
              <>
                {note.error && <p className="rise-caption" style={{ margin: 0 }}>AI wasn’t available for this draft, so this is the standard template.</p>}
                <dl className="prov-note">
                  <dt>Summary</dt><dd>{note.summary}</dd>
                  <dt>Measures</dt><dd>{note.measures}</dd>
                  <dt>Assessment</dt><dd>{note.assessment}</dd>
                  <dt>Suggested plan</dt><dd>{note.plan}</dd>
                  <dt>Suggested message to patient</dt><dd>{note.patientMessage}</dd>
                </dl>
                {noteCopied === 'fail' && <textarea className="prov-textarea" readOnly rows={8} value={noteText(note, p.firstName)} aria-label="Note text. Select it and copy." onFocus={(e) => e.currentTarget.select()} />}
              </>
            )}
            <ErrorNote message={noteErr} />
            <div className="row">
              <button type="button" className={`rise-btn ${note ? 'rise-btn--quiet' : 'rise-btn--secondary'}`} onClick={draftNote} disabled={drafting}>{drafting ? 'Drafting…' : note ? 'Draft again' : 'Draft note'}</button>
              {note && !drafting && (
                <>
                  <button type="button" className="rise-btn rise-btn--secondary" onClick={async () => setNoteCopied((await copyText(noteText(note, p.firstName))) ? 'ok' : 'fail')}>
                    {noteCopied === 'ok' ? 'Copied' : 'Copy note'}
                  </button>
                  {note.patientMessage && (
                    <button type="button" className="rise-btn rise-btn--secondary" onClick={() => {
                      openForm('message', note.patientMessage);
                      document.getElementById('fu-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}>Send suggested message</button>
                  )}
                </>
              )}
            </div>
            {noteCopied === 'fail' && <p className="rise-caption" style={{ margin: 0 }}>Copying is blocked in this browser. Select the text above and copy it.</p>}
          </section>

          {last ? (
            <section className="rise-card stack">
              <div className="rise-label">Leg strength · 30-second chair stand</div>
              <div className="meter">
                <span className="data-xl">{last.stands}<span className="rise-caption"> reps</span></span>
                <span className="rise-caption" style={{ textAlign: 'right' }}>
                  {base && base !== last ? `${signed(last.stands - base.stands)} since baseline (${base.stands})` : 'Baseline'}<br />
                  {last.belowNorm ? `Below average for ${p.sex === 'male' ? 'men' : 'women'} ${last.normBand} (under ${last.normCutoff})` : `At or above STEADI norm (${last.normCutoff}+)`}
                </span>
              </div>
              {p.checks.length > 1 && <RiseTrace points={p.checks.map((c) => ({ date: c.createdAt, stands: c.stands }))} cutoff={last.normCutoff} bandLabel={`Shaded: at or above the STEADI norm for age ${last.normBand}`} wide />}
              <p className="rise-caption" style={{ margin: 0 }}>Shaded: at or above CDC STEADI norm for {p.sex === 'male' ? 'men' : 'women'} {last.normBand}{p.age < 60 ? ' (extrapolated; STEADI norms start at 60)' : ''}. Phone video is a pilot measure pending validation against in-person testing.</p>
            </section>
          ) : <p className="note">No checks yet.</p>}

          {last?.domains?.mass.measured && (() => {
            const m = last.domains!.mass;
            const scans = p.checks.filter((c) => c.leanMassLb != null && c.bodyCompMethod === m.method);
            const first = scans[0];
            return (
              <section className="rise-card stack">
                <div className="rise-step__head"><div className="rise-label">Muscle mass · {m.methodLabel}</div>{m.state && <StatusSignal state={m.state} />}</div>
                <div className="mini-stats">
                  <div><span className="rise-caption">Weight</span><b>{first && first !== scans[scans.length - 1] ? `${first.weightLb} → ${last.weightLb}` : last.weightLb} lb</b></div>
                  <div><span className="rise-caption">Lean mass</span><b>{first && first !== scans[scans.length - 1] ? `${first.leanMassLb} → ${last.leanMassLb}` : last.leanMassLb} lb</b></div>
                  <div><span className="rise-caption">Lean share of loss</span><b>{m.leanShare != null ? `${Math.round(m.leanShare * 100)}%` : '—'}</b></div>
                  {last.bodyFatPct != null && <div><span className="rise-caption">Body fat</span><b>{last.bodyFatPct}%</b></div>}
                </div>
                <p className="rise-caption" style={{ margin: 0 }}>
                  {m.leanShare != null ? `${m.leanLost} lb lean of ${m.weightLost} lb lost since ${fmtDate(m.baselineDate!)}. ` : 'Not enough weight change since the first scan on this device to judge yet (needs 4 lb and 2%). '}
                  {last.bodyCompDetail?.source === 'rise-scan' ? `Rise phone scan: circumference estimate (neck ${last.bodyCompDetail.neckIn}, waist ${last.bodyCompDetail.waistIn}, hip ${last.bodyCompDetail.hipIn} in; U.S. Navy equation). ` : ''}
                  {last.bodyCompDetail?.source === 'import' ? `Imported${last.bodyCompDetail.from ? ` from ${last.bodyCompDetail.from}` : ''}${last.bodyCompDetail.measuredOn ? `, measured ${last.bodyCompDetail.measuredOn}` : ''}. ` : ''}
                  GLP-1 trials report lean mass at about 20–40% of weight lost (Dubin et al., 2024); Watch at 40%, Check in at 60% (draft). Only scans from the same device are compared. Lean mass includes water and organs, not just muscle.
                  {m.lowMuscle ? ' Appendicular muscle index is below the EWGSOP2 cut-off.' : ''}
                </p>
              </section>
            );
          })()}

          {last?.domains?.grip.measured && (() => {
            const g = last.domains!.grip;
            return (
              <section className="rise-card stack">
                <div className="rise-step__head"><div className="rise-label">Grip strength</div>{g.state && <StatusSignal state={g.state} />}</div>
                <div className="mini-stats">
                  <div><span className="rise-caption">Latest</span><b>{g.value} kg</b></div>
                  <div><span className="rise-caption">First</span><b>{g.baseline} kg</b></div>
                  <div><span className="rise-caption">EWGSOP2 cut-off</span><b>{g.cutoff} kg</b></div>
                </div>
                <p className="rise-caption" style={{ margin: 0 }}>Patient-reported from a home dynamometer, best of 3. Watch below the cut-off or after a 10% drop; Check in after a 20% drop (draft).</p>
              </section>
            );
          })()}

          <section className="rise-card">
            <h2 className="rise-title" style={{ marginBottom: 8 }}>Checks</h2>
            {p.checks.length ? (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Date</th><th>State</th><th>Reps</th><th>Weight</th><th>Lean</th><th>Grip</th><th>Capture</th><th>Readiness</th></tr></thead>
                  <tbody>
                    {[...p.checks].reverse().map((c) => (
                      <tr key={c.id}>
                        <td className="rise-num">{fmtDate(c.createdAt)}</td>
                        <td><StatusSignal state={c.state} /></td>
                        <td className="rise-num">{c.stands}</td>
                        <td className="rise-num">{c.weightLb ?? '—'}</td>
                        <td className="rise-num">{c.leanMassLb ?? '—'}{c.domains?.mass.leanShare != null ? ` (${Math.round(c.domains.mass.leanShare * 100)}%)` : ''}</td>
                        <td className="rise-num">{c.gripKg != null ? `${c.gripKg} kg` : '—'}</td>
                        <td>{c.method === 'demo' || c.method === 'manual' ? 'Self-reported' : `Video${c.confidence != null ? ` · ${Math.round(c.confidence * 100)}%` : ''}`}</td>
                        <td>{c.sleptPoorly || c.painOrIll ? [c.sleptPoorly && 'Slept badly', c.painOrIll && 'Pain or ill'].filter(Boolean).join(', ') : 'OK'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="rise-caption" style={{ margin: 0 }}>No checks yet.</p>}
          </section>
        </div>

        <aside className="stack" style={{ gap: 24 }}>
          {last?.domains && <DomainSummary domains={last.domains} title="What the patient sees" />}
          <section className="rise-card stack">
            <h2 className="rise-title">Risk tier: {p.tier === 'higher' ? 'Higher' : 'Standard'}</h2>
            {p.tierReasons.length ? <ul style={{ margin: 0, paddingLeft: 20, fontSize: 16, lineHeight: '24px' }}>{p.tierReasons.map((r) => <li key={r}>{r}</li>)}</ul>
              : <p className="rise-caption" style={{ margin: 0 }}>No risk factors from setup.</p>}
            <p className="rise-caption" style={{ margin: 0 }}>Checks every {p.checkEveryDays} days. Next due {fmtDate(p.nextDue)}.</p>
          </section>
          <section className="rise-card stack">
            <h2 className="rise-title">Setup answers</h2>
            <dl className="kv">
              <dt>Goal</dt><dd>{p.goal ?? '—'}</dd>
              <dt>Activity</dt><dd>{p.activity ? ACT[p.activity] : '—'}</dd>
              <dt>Falls (1 yr)</dt><dd>{p.falls ? FALLS[p.falls] : '—'}</dd>
              <dt>Joint pain</dt><dd>{p.jointPain === 'yes' ? 'Yes, standing is hard' : p.jointPain === 'no' ? 'No' : '—'}</dd>
              {p.sex === 'female' && <><dt>Menopause</dt><dd>{({ yes: 'Yes', no: 'No', unsure: 'Not sure', skip: 'Not answered' } as Record<string, string>)[p.menopause ?? ''] ?? '—'}</dd></>}
              <dt>Weight</dt><dd className="rise-num">{p.startWeightLb && p.currentWeightLb ? `${p.startWeightLb} → ${p.currentWeightLb} lb` : '—'}</dd>
            </dl>
          </section>

          {/* Link a new phone */}
          <section className="rise-card stack" aria-labelledby="link-title">
            <h2 className="rise-title" id="link-title">Link a new phone</h2>
            {link ? (
              <>
                <div className="prov-linkcode rise-num" aria-label={`Link code ${link.code.split('').join(' ')}`}>{link.code.slice(0, 3)} {link.code.slice(3)}</div>
                <p className="rise-caption" style={{ margin: 0 }}>Expires at {new Date(link.expiresAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Works once.</p>
                <p className="note">On the new phone, open Rise and choose ‘I already use Rise’. Then enter this code.</p>
              </>
            ) : (
              <p className="rise-caption" style={{ margin: 0 }}>For a patient with a new or reset phone. Their history stays with them.</p>
            )}
            <ErrorNote message={linkErr} />
            <button type="button" className="rise-btn rise-btn--secondary" style={{ justifySelf: 'start' }} onClick={makeLink} disabled={linkBusy}>
              {linkBusy ? 'Making code…' : link ? 'Make a new code' : 'Make a link code'}
            </button>
            {link && <p className="rise-caption" style={{ margin: 0 }}>A new code cancels this one.</p>}
          </section>
        </aside>
      </div>
    </Screen>
  );
}
