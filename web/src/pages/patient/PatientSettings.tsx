import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, ErrorNote } from '../../components/Screen';
import { api } from '../../lib/api';
import { session } from '../../lib/session';
import { fmtDate } from '../../lib/format';
import type { Me } from '../../lib/types';

/** Reminders, privacy and account for the patient. */
export function PatientSettings() {
  const nav = useNavigate();
  const [p, setP] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [installed] = useState(() => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  useEffect(() => { api.me().then(setP).catch((e: Error) => setErr(e.message)); }, []);

  async function reminder() {
    try {
      const ics = await api.reminderIcs();
      const file = new File([ics], 'rise-check.ics', { type: 'text/calendar' });
      const nav2 = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav2.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Rise check reminder' }); return; }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = 'rise-check.ics'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { if ((e as Error).name !== 'AbortError') setErr((e as Error).message); }
  }

  return (
    <Screen back={{ to: '/', label: 'Done' }}>
      <div className="stack"><div className="rise-label">Settings</div><h1 className="display">Your Rise</h1></div>
      <ErrorNote message={err} />
      <section className="rise-card stack">
        <h2 className="rise-title">Reminders</h2>
        <p className="rise-body-lg" style={{ margin: 0 }}>{p ? `Next check ${fmtDate(p.nextDue, { weekday: 'long', month: 'long', day: 'numeric' })}, then every ${p.checkEveryDays === 14 ? '2' : '4'} weeks.` : '…'}</p>
        <button className="rise-btn rise-btn--secondary rise-btn--block" onClick={reminder}>Add reminders to my calendar</button>
      </section>
      {!installed && (
        <section className="rise-card stack">
          <h2 className="rise-title">Put Rise on your Home Screen</h2>
          <ol className="stack" style={{ margin: 0, paddingLeft: 22 }}>
            <li>In Safari, tap the Share button.</li>
            <li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
            <li>Open Rise from its icon. It works like an app, full screen.</li>
          </ol>
        </section>
      )}
      <section className="rise-card stack">
        <h2 className="rise-title">Your privacy</h2>
        <p className="rise-body-lg" style={{ margin: 0 }}>Your camera video and body photos never leave this phone. Rise saves your counts and measurements, and your care team can see them.</p>
        {p && <p className="rise-caption" style={{ margin: 0 }}>Care team code: <span className="rise-num">{p.providerCode}</span></p>}
      </section>
      <section className="rise-card stack">
        <h2 className="rise-title">This phone</h2>
        <button className="rise-btn rise-btn--secondary rise-btn--block" onClick={() => { session.clear(); nav('/', { replace: true }); }}>Unlink this phone</button>
        <p className="rise-caption" style={{ margin: 0 }}>Your checks stay saved. To use Rise again here, ask your care team for a link code.</p>
        {!confirming ? (
          <button className="rise-btn rise-btn--quiet danger" onClick={() => setConfirming(true)}>Delete my data</button>
        ) : (
          <div className="stack">
            <p className="error-note" role="alert">This deletes all your checks and messages, and your care team will no longer see them. It can't be undone.</p>
            <button className="rise-btn rise-btn--primary rise-btn--block danger-fill" onClick={async () => { try { await api.deleteMe(); nav('/', { replace: true }); } catch (e) { setErr((e as Error).message); } }}>Delete everything</button>
            <button className="rise-btn rise-btn--quiet" onClick={() => setConfirming(false)}>Keep my data</button>
          </div>
        )}
      </section>
    </Screen>
  );
}
