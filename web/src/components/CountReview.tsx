import { useMemo, useState } from 'react';
import type { Capture } from './CameraStage';
import { reviewCount } from '../lib/standReview';

/**
 * After the 30 seconds: shows the count over a replay of the hip path, with a dot for every stand counted,
 * so the patient can see what the camera saw. They confirm, fix the number, or redo the check. Any change is
 * saved and shown to the care team next to the camera's own count.
 */
export function CountReview({ capture, lastStands, onSave, onRedo }: {
  capture: Capture; lastStands: number | null;
  onSave: (c: Capture & { countedByCamera: number; adjusted: boolean }) => void; onRedo: () => void;
}) {
  const [n, setN] = useState(capture.stands);
  const [editing, setEditing] = useState(false);
  const check = useMemo(() => reviewCount({ stands: capture.stands, repTimes: capture.repTimes, confidence: capture.confidence, lastStands }), [capture, lastStands]);
  const W = 340, H = 150, pad = { l: 8, r: 58, t: 14, b: 22 };
  const x = (t: number) => pad.l + (t / 30) * (W - pad.l - pad.r);
  const y = (h: number) => pad.t + (1 - Math.max(-0.1, Math.min(1.2, h)) / 1.2) * (H - pad.t - pad.b);
  const series = capture.series ?? [];
  const path = series.map(([t, h], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(h).toFixed(1)}`).join(' ');
  const at = (t: number) => { let best = series[0]; for (const p of series) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; return best?.[1] ?? 1; };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 4 }}>
        <div className="rise-label">Your count</div>
        <div className="meter"><span className="data-xl">{n}</span><span className="rise-caption">stands in 30 seconds{n !== capture.stands ? ` (camera counted ${capture.stands})` : ''}</span></div>
      </div>

      {series.length > 1 && (
        <figure className="rise-card count-chart" style={{ margin: 0 }}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Your hip height over 30 seconds, with ${capture.stands} stands marked`}>
            <line x1={pad.l} x2={W - pad.r} y1={y(0.65)} y2={y(0.65)} className="count-chart__line" />
            <text x={W - pad.r + 6} y={y(1) + 4} className="count-chart__axis">standing</text>
            <text x={W - pad.r + 6} y={y(0) + 4} className="count-chart__axis">seated</text>
            <path d={path} className="count-chart__path" />
            {(capture.repTimes ?? []).map((t, i) => (
              <g key={i}>
                <circle cx={x(t)} cy={y(at(t))} r="7" className="count-chart__dot" />
                <text x={x(t)} y={y(at(t)) + 3.5} textAnchor="middle" className="count-chart__n">{i + 1}</text>
              </g>
            ))}
            {[0, 10, 20, 30].map((s) => <text key={s} x={x(s)} y={H - 6} textAnchor={s === 0 ? 'start' : s === 30 ? 'end' : 'middle'} className="count-chart__axis">{s}s</text>)}
          </svg>
          <figcaption className="rise-caption">Each dot is a stand the camera counted.</figcaption>
        </figure>
      )}

      {check.level === 'check' && <p className="note" role="status"><b>Please check this count.</b> {check.message} If it doesn't look right, fix the number or do the check again.</p>}

      {editing ? (
        <div className="stack">
          <div className="stepper" role="group" aria-label="Correct the count">
            <button className="rise-btn rise-btn--secondary" aria-label="One fewer" onClick={() => setN((v) => Math.max(0, v - 1))}>−</button>
            <span className="rise-num stepper__n" aria-live="polite">{n}</span>
            <button className="rise-btn rise-btn--secondary" aria-label="One more" onClick={() => setN((v) => Math.min(40, v + 1))}>+</button>
          </div>
          <p className="rise-caption" style={{ margin: 0 }}>Only count full stands, all the way up. Your care team sees both your number and the camera's.</p>
        </div>
      ) : null}

      <button className="rise-btn rise-btn--primary rise-btn--block" onClick={() => onSave({ ...capture, stands: n, countedByCamera: capture.stands, adjusted: n !== capture.stands })}>
        {n === capture.stands ? 'That looks right' : `Save ${n} stands`}
      </button>
      {!editing && <button className="rise-btn rise-btn--secondary rise-btn--block" onClick={() => setEditing(true)}>Fix the count</button>}
      <button className="rise-btn rise-btn--quiet" onClick={onRedo}>Do the check again</button>
    </div>
  );
}
