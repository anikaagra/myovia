import { useEffect, useMemo, useRef, useState } from 'react';
import type { Check } from '../lib/cameraChecks';
import type { Capture } from './CameraStage';
import { simulateStands } from '../lib/standReview';
import { say, stopSpeaking } from '../lib/speech';

// Demo build only (where a camera isn't available): plays the same camera checks, countdown and 30-second
// recording the real app runs, with an animated patient, then hands a realistic capture to the review screen.
const SCRIPT: { fixAt: Check['id'] | null; fix: string }[] = [
  { fixAt: 'lens', fix: 'Wipe your camera lens with a soft cloth.' },
  { fixAt: 'distance', fix: 'Move the phone back one step.' },
  { fixAt: 'side', fix: 'Turn your chair so your side faces the phone.' },
  { fixAt: null, fix: '' },
];
const LABELS: [Check['id'], string][] = [['lens', 'Lens is clean'], ['light', 'Good light'], ['distance', 'Whole body in view'], ['side', 'Side view'], ['alone', 'Only you in view'], ['steady', 'Phone is upright and steady']];
const SPEED = 3; // the 30 seconds play in 10 so demos stay short

/** Side-view figure for hip height h (0 seated, 1 standing): knee and feet fixed, thigh swings up, trunk leans forward mid-rise. */
function figure(h: number) {
  const knee = { x: 150, y: 214 }, ankle = { x: 152, y: 286 }, thigh = 64, trunk = 78;
  const a = (Math.max(0, Math.min(1, h)) * Math.PI) / 2;
  const hip = { x: knee.x - thigh * Math.cos(a), y: knee.y - thigh * Math.sin(a) };
  const lean = ((8 + 34 * Math.sin(Math.PI * Math.max(0, Math.min(1, h)))) * Math.PI) / 180; // forward lean while rising
  const sh = { x: hip.x + trunk * Math.sin(lean), y: hip.y - trunk * Math.cos(lean) };
  const head = { x: sh.x + 10 * Math.sin(lean), y: sh.y - 22 };
  return { knee, ankle, hip, sh, head };
}

export function DemoCamera({ onDone, lastStands }: { onDone: (c: Capture) => void; lastStands?: number | null }) {
  const [target, setTarget] = useState(String(lastStands ?? 12));
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'checks' | 'countdown' | 'recording'>('checks');
  const [count, setCount] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const sim = useMemo(() => simulateStands(Math.max(0, Math.min(40, Number(target) || 0))), [target]);
  const raf = useRef(0);

  useEffect(() => {
    if (phase !== 'checks') return;
    const step = SCRIPT[i];
    if (step.fixAt) say(step.fix);
    if (i < SCRIPT.length - 1) { const id = setTimeout(() => setI(i + 1), 1700); return () => clearTimeout(id); }
    const id = setTimeout(() => setPhase('countdown'), 1200);
    return () => clearTimeout(id);
  }, [i, phase]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    say('All set. Arms crossed. When I say go, stand up and sit down as many times as you can.', { force: true });
    const ids = [3, 2, 1].map((n, k) => setTimeout(() => { setCount(n); say(String(n), { force: true }); }, 2500 + k * 900));
    ids.push(setTimeout(() => { setCount(null); say('Go.', { force: true }); setPhase('recording'); }, 2500 + 3 * 900));
    return () => ids.forEach(clearTimeout);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const start = performance.now();
    let said = 0;
    const tick = () => {
      const sec = Math.min(30, ((performance.now() - start) / 1000) * SPEED);
      setT(sec);
      const done = sim.repTimes.filter((r) => r <= sec).length;
      if (done > said) { said = done; say(String(done), { force: true }); }
      if (sec >= 30) { say(`Done. ${sim.repTimes.length} stands.`, { force: true }); onDone({ stands: sim.repTimes.length, confidence: 0.94, durationSec: 30, repTimes: sim.repTimes, series: sim.series }); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); stopSpeaking(); };
  }, [phase, sim, onDone]);

  const h = phase === 'recording' ? sim.series[Math.min(299, Math.floor(t * 10))]?.[1] ?? 0 : 0;
  const f = figure(h);
  const trail = phase === 'recording' ? sim.series.slice(Math.max(0, Math.floor(t * 10) - 60), Math.floor(t * 10) + 1).map(([, hh]) => figure(hh).hip) : [];
  const reps = sim.repTimes.filter((r) => r <= t).length;
  const step = SCRIPT[i];
  const failIdx = phase === 'checks' && step.fixAt ? LABELS.findIndex(([id]) => id === step.fixAt) : LABELS.length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className={`cam demo-cam${phase === 'checks' && step.fixAt ? ' cam--fix' : ''}`}>
        <svg viewBox="0 0 300 320" preserveAspectRatio="xMidYMax slice" className="demo-cam__scene" aria-label={phase === 'recording' ? `Recording, ${reps} stands` : 'Camera preview'}>
          <rect x="0" y="0" width="300" height="320" fill="var(--paper-raised)" />
          <rect x="0" y="0" width="300" height="290" fill="var(--tint)" />
          <rect x="0" y="288" width="300" height="32" fill="var(--paper)" />
          {/* chair */}
          <rect x="70" y="214" width="62" height="7" rx="2" fill="var(--line-strong)" />
          <rect x="72" y="221" width="5" height="67" fill="var(--line-strong)" /><rect x="125" y="221" width="5" height="67" fill="var(--line-strong)" />
          <rect x="70" y="140" width="5" height="80" fill="var(--line-strong)" />
          {/* hip trail */}
          {trail.length > 1 && <polyline points={trail.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} className="path" />}
          {/* figure */}
          <g className={`demo-fig${phase === 'checks' && step.fixAt ? ' demo-fig--fix' : ''}`}>
            <line x1={f.ankle.x} y1={f.ankle.y} x2={f.knee.x} y2={f.knee.y} />
            <line x1={f.ankle.x} y1={f.ankle.y} x2={f.ankle.x + 18} y2={f.ankle.y + 2} />
            <line x1={f.knee.x} y1={f.knee.y} x2={f.hip.x} y2={f.hip.y} />
            <line x1={f.hip.x} y1={f.hip.y} x2={f.sh.x} y2={f.sh.y} />
            <line x1={f.sh.x - 2} y1={f.sh.y + 10} x2={f.sh.x + 14} y2={f.sh.y + 22} />
            <circle cx={f.head.x} cy={f.head.y} r="13" />
          </g>
          {phase === 'recording' && <circle cx={f.hip.x} cy={f.hip.y} r="7" className="hip" />}
        </svg>
        {phase === 'checks' && step.fixAt && <div className="cam__fix" aria-hidden="true">{step.fix}</div>}
        {phase === 'recording' && <span className="cam__badge">Recording</span>}
        {phase !== 'recording' && <span className="cam__badge cam__badge--quiet">Demo camera</span>}
        {count != null && <div className="cam__count" aria-live="assertive">{count}</div>}
      </div>

      {phase === 'checks' && (
        <>
          <h2 className="rise-title">Getting your camera ready</h2>
          <ul className="rise-checks" aria-live="polite">
            {LABELS.map(([id, label], k) => {
              const status = k < failIdx ? 'ok' : k === failIdx ? 'fix' : 'wait';
              return (
                <li key={id} className={`rise-check rise-check--${status}`}>
                  <svg className="rise-check__mark" viewBox="0 0 24 24" aria-hidden="true">{status === 'ok' ? <circle cx="12" cy="12" r="10" /> : status === 'fix' ? <path d="M12 2 L23 21 L1 21 Z" /> : <circle cx="12" cy="12" r="9" />}</svg>
                  {status === 'fix' ? step.fix : label}
                  <span className="rise-check__state" style={{ color: status === 'ok' ? 'var(--steady)' : status === 'fix' ? 'var(--watch)' : undefined }}>{status === 'ok' ? 'Done' : status === 'fix' ? 'Fix' : 'Next'}</span>
                </li>
              );
            })}
          </ul>
          <details className="demo-settings">
            <summary className="rise-caption">Demo settings</summary>
            <div className="field"><label className="rise-label" htmlFor="demo-count">Stands the demo patient does</label>
              <input id="demo-count" className="rise-num" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, '').slice(0, 2))} /></div>
          </details>
        </>
      )}
      {phase === 'countdown' && <p className="rise-body-lg" aria-live="polite">Sit in the middle of the chair, arms crossed over your chest. Stand all the way up and sit back down, as many times as you can.</p>}
      {phase === 'recording' && (
        <>
          <div className="meter" aria-live="polite">
            <div><div className="rise-label">Stands</div><div className="data-xl">{reps}</div></div>
            <div style={{ textAlign: 'right' }}><div className="rise-label">Time left</div><div className="rise-num" style={{ fontSize: 28, lineHeight: '32px' }}>0:{String(Math.max(0, Math.ceil(30 - t))).padStart(2, '0')}</div></div>
          </div>
          <p className="rise-caption" style={{ margin: 0 }}>Demo: the 30 seconds play at {SPEED}× speed.</p>
        </>
      )}
    </div>
  );
}
