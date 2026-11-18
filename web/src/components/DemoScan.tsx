import { useEffect, useRef, useState } from 'react';
import { say, stopSpeaking } from '../lib/speech';

// Demo only: plays the body scan the real app runs (camera checks, timed front and side photos, measuring the
// outline at neck, waist and hips) with an animated figure, then hands over to the same result screen.
type Step = { view: 'front' | 'side'; stage: 'checks' | 'count' | 'flash' | 'measure'; text: string; n?: number; ms: number; speak?: string };
const STEPS: Step[] = [
  { view: 'front', stage: 'checks', text: 'Checking light and framing…', ms: 1300, speak: 'Face the phone with your arms a little away from your sides.' },
  { view: 'front', stage: 'count', text: 'Hold still', n: 3, ms: 700, speak: '3' },
  { view: 'front', stage: 'count', text: 'Hold still', n: 2, ms: 700, speak: '2' },
  { view: 'front', stage: 'count', text: 'Hold still', n: 1, ms: 700, speak: '1' },
  { view: 'front', stage: 'flash', text: 'Front photos taken', ms: 900, speak: 'Got it. Now turn so your side faces the phone.' },
  { view: 'side', stage: 'checks', text: 'Checking your side view…', ms: 1200 },
  { view: 'side', stage: 'count', text: 'Hold still', n: 3, ms: 700, speak: '3' },
  { view: 'side', stage: 'count', text: 'Hold still', n: 2, ms: 700, speak: '2' },
  { view: 'side', stage: 'count', text: 'Hold still', n: 1, ms: 700, speak: '1' },
  { view: 'side', stage: 'flash', text: 'Side photos taken', ms: 700, speak: 'Got it.' },
  { view: 'front', stage: 'measure', text: 'Measuring neck, waist and hips…', ms: 2200, speak: 'Measuring your scan.' },
];

const CHECKS = ['Lens is clean', 'Even light from the front', 'Head to feet in view', 'Pose'];

export function DemoScan({ onFinish, onCancel }: { onFinish: () => void; onCancel: () => void }) {
  const [i, setI] = useState(0);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useEffect(() => {
    const s = STEPS[i];
    if (s.speak) say(s.speak, { force: true });
    const id = setTimeout(() => (i < STEPS.length - 1 ? setI(i + 1) : finish.current()), s.ms);
    return () => clearTimeout(id);
  }, [i]);
  useEffect(() => () => stopSpeaking(), []);

  const s = STEPS[i];
  const side = s.view === 'side';
  const checksDone = s.stage === 'checks' ? 2 : 4;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="cam demo-cam">
        <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" className="demo-cam__scene" aria-label={s.text}>
          <rect width="300" height="400" fill="var(--tint)" />
          <rect y="360" width="300" height="40" fill="var(--paper)" />
          <rect x="70" y="40" width="160" height="330" rx="80" fill="none" className="scan-guide" />
          <g className="scan-fig">
            {side ? (
              <>
                <circle cx="150" cy="78" r="20" />
                <path d="M138 100 h24 q10 40 6 80 q10 30 2 70 l-4 108 h-14 l-2-100 l-6 100 h-14 l0-108 q-10-40 -2-70 q-6-40 10-80 z" />
              </>
            ) : (
              <>
                <circle cx="150" cy="78" r="20" />
                <path d="M118 104 h64 l4 70 q8 20 6 46 l-12 140 h-18 l-12-120 l-12 120 h-18 l-12-140 q-2-26 6-46 z" />
                <path d="M118 108 l-30 96 l10 4 l34-86 z M182 108 l30 96 l-10 4 l-34-86 z" />
              </>
            )}
          </g>
          {s.stage === 'measure' && (
            <g className="scan-measure">
              {[[102, 'Neck'], [190, 'Waist'], [232, 'Hips']].map(([y, label]) => (
                <g key={label}>
                  <line x1="84" x2="216" y1={y as number} y2={y as number} />
                  <text x="222" y={(y as number) + 4}>{label}</text>
                </g>
              ))}
            </g>
          )}
          {s.stage === 'flash' && <rect width="300" height="400" fill="#fff" className="scan-flash" />}
        </svg>
        <span className="cam__badge cam__badge--quiet">Demo camera</span>
        {s.n != null && <div className="cam__count" aria-live="assertive">{s.n}</div>}
        {s.stage !== 'count' && <div className="cam__fix" aria-live="polite">{s.text}</div>}
      </div>
      {s.stage !== 'measure' && (
        <ul className="rise-checks rise-checks--compact">
          {CHECKS.map((c, k) => (
            <li key={c} className={`rise-check rise-check--${k < checksDone ? 'ok' : 'wait'}`}>
              {c === 'Pose' ? (side ? 'Side to the phone' : 'Facing the phone, arms slightly out') : c}
              <span className="rise-check__state">{k < checksDone ? 'Done' : '…'}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="rise-caption" style={{ margin: 0 }}>{side ? 'Side photo' : 'Front photo'} · 3 photos per pose, measured on the phone.</p>
      <button className="rise-btn rise-btn--quiet" onClick={onCancel}>Cancel</button>
    </div>
  );
}
