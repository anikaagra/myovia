import { useEffect, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { loadPose } from '../lib/pose';
import { evaluateFrame, CheckSmoother, type Check } from '../lib/cameraChecks';
import { toGray, cornerMotion, lensStats, regionMean } from '../lib/frameStats';
import { StandCounter, type Point } from '../lib/repCounter';
import { startSensors } from '../lib/deviceSensors';
import { say, stopSpeaking } from '../lib/speech';

export type Capture = {
  stands: number; confidence: number; durationSec: number; armsFlags?: number;
  /** Seconds from the start at which each stand was counted, and hip height (0 seated, ~1 standing) over time. */
  repTimes?: number[]; series?: [number, number][];
};
type Phase = 'starting' | 'error' | 'checking' | 'countdown' | 'recording' | 'rejected';

const DURATION_MS = 30_000;
const READY_HOLD_MS = 2000; // every check green for 2 s before the countdown starts
const SW = 160, SH = 120; // analysis frame
const MIN_CONFIDENCE = 0.75;
const MAX_GAP_MS = 2500;
const DEBUG = typeof location !== 'undefined' && /[?&]debug=1/.test(location.search + location.hash);

function Mark({ status }: { status: Check['status'] }) {
  return (
    <svg className="rise-check__mark" viewBox="0 0 24 24" aria-hidden="true">
      {status === 'ok' ? <circle cx="12" cy="12" r="10" /> : status === 'fix' ? <path d="M12 2 L23 21 L1 21 Z" /> : <circle cx="12" cy="12" r="9" />}
    </svg>
  );
}

// Skeleton segments drawn over the preview, Spren-style: blue when tracked well, amber when a check needs fixing.
const BONES: [number, number][] = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [11, 13], [13, 15], [12, 14], [14, 16]];

function bodyBox(lm: Point[]) {
  const pts = lm.filter((p) => (p.visibility ?? 1) > 0.5);
  if (pts.length < 6) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

export function CameraStage({ onDone, onManual }: { onDone: (c: Capture) => void; onManual: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>('starting');
  const [phase, setPhaseState] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [reps, setReps] = useState(0);
  const [left, setLeft] = useState(30);
  const [trail, setTrail] = useState<string>('');
  const [hip, setHip] = useState<{ x: number; y: number } | null>(null);
  const [bones, setBones] = useState<string[]>([]);
  const [box, setBox] = useState({ w: 300, h: 400 });
  const [attempt, setAttempt] = useState(0);
  const [debug, setDebug] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    const timers: number[] = [];
    const canvas = document.createElement('canvas');
    canvas.width = SW; canvas.height = SH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const sensors = startSensors();
    const smoother = new CheckSmoother(3, 2);
    let landmarker: PoseLandmarker | null = null;
    let prevGray: Float32Array | null = null;
    let lm: Point[] | null = null;
    let people = 0;
    let readyCount = 0;
    let lastPose = 0, lastStats = 0, readySince = 0, endAt = 0, lastFix = '', lastRepAt = 0, lastLostSay = 0, lastArmsSay = 0;
    const counter = new StandCounter();
    const pts: { x: number; y: number }[] = [];

    const toBox = (p: Point) => {
      const v = videoRef.current!, el = boxRef.current!;
      const cw = el.clientWidth, ch = el.clientHeight, vw = v.videoWidth || 640, vh = v.videoHeight || 480;
      const s = Math.max(cw / vw, ch / vh);
      // Both the video and this overlay are mirrored by CSS (selfie view), so draw in unmirrored video coordinates.
      return { x: p.x * vw * s + (cw - vw * s) / 2, y: p.y * vh * s + (ch - vh * s) / 2 };
    };
    const drawBones = (marks: Point[] | null) => {
      if (!marks || !boxRef.current || !videoRef.current) { setBones([]); return; }
      setBones(BONES.filter(([a, b]) => (marks[a]?.visibility ?? 0) > 0.5 && (marks[b]?.visibility ?? 0) > 0.5)
        .map(([a, b]) => { const p = toBox(marks[a]), q = toBox(marks[b]); return `${p.x.toFixed(1)},${p.y.toFixed(1)} ${q.x.toFixed(1)},${q.y.toFixed(1)}`; }));
    };

    const startCountdown = () => {
      setPhase('countdown');
      say('All set. Sit in the middle of the chair with your arms crossed over your chest. When I say go, stand all the way up and sit back down, as many times as you can, for 30 seconds.', { force: true });
      [3, 2, 1].forEach((n, i) => timers.push(window.setTimeout(() => { setCount(n); say(String(n), { force: true }); }, 9000 + i * 1000)));
      timers.push(window.setTimeout(() => {
        setCount(null); say('Go.', { force: true });
        endAt = performance.now() + DURATION_MS;
        lastRepAt = performance.now();
        setPhase('recording');
      }, 12000));
    };

    const reject = (msg: string, spoken: string) => {
      setError(msg); setPhase('rejected'); say(spoken, { force: true });
    };

    const finish = () => {
      const stands = counter.finish();
      setReps(stands);
      const confidence = Number(counter.confidence.toFixed(2));
      if (confidence < MIN_CONFIDENCE || counter.longestGap > MAX_GAP_MS) {
        return reject("We lost sight of you for part of the check, so we can't trust the count. Move the phone back a step, turn on a light, and try again.",
          "We couldn't see you the whole time. Let's try again.");
      }
      if (stands > 0 && counter.armsFlags > stands / 2) {
        return reject('It looked like you used your arms to stand up. For a fair comparison, keep your arms crossed over your chest the whole time. Try again when you’re ready.',
          'Keep your arms crossed the whole time. Let’s try again.');
      }
      say(`Done. ${stands} stands.`, { force: true });
      const t0 = endAt - DURATION_MS;
      const sec = (t: number) => Math.round(((t - t0) / 1000) * 10) / 10;
      onDone({ stands, confidence, durationSec: 30, armsFlags: counter.armsFlags,
        repTimes: counter.repTimes.map(sec), series: counter.series.filter(([t]) => t >= t0).map(([t, h]) => [sec(t), h] as [number, number]) });
    };

    const tick = () => {
      if (cancelled) return;
      const v = videoRef.current;
      const now = performance.now();
      if (v && landmarker && v.readyState >= 2) {
        if (now - lastPose >= 50) {
          lastPose = now;
          try {
            const res = landmarker.detectForVideo(v, now);
            people = res.landmarks.length;
            // With two people in view, follow the larger (closer) one.
            const sized = res.landmarks.map((l) => ({ l: l as Point[], b: bodyBox(l as Point[]) })).sort((a, b) =>
              ((b.b ? (b.b.y1 - b.b.y0) : 0) - (a.b ? (a.b.y1 - a.b.y0) : 0)));
            lm = sized[0]?.l ?? null;
          } catch { lm = null; }
          if (phaseRef.current !== 'recording') drawBones(lm);
          if (phaseRef.current === 'countdown') counter.calibrate(lm);
        }
        if (phaseRef.current === 'checking' && now - lastStats >= 300) {
          lastStats = now;
          ctx.drawImage(v, 0, 0, SW, SH);
          const gray = toGray(ctx.getImageData(0, 0, SW, SH).data, SW, SH);
          const stats = lensStats(gray, SW, SH);
          const bb = lm ? bodyBox(lm) : null;
          const s = sensors.read();
          const input = { ...stats, motion: cornerMotion(prevGray, gray, SW, SH), landmarks: lm, people,
            personLuminance: bb ? regionMean(gray, SW, SH, bb) : null, tilt: s.tilt, shaking: s.shaking };
          prevGray = gray;
          const r = smoother.update(evaluateFrame(input));
          setChecks(r.checks);
          if (DEBUG) setDebug(`sharp ${stats.sharpness.toFixed(0)} detail ${stats.detail.toFixed(3)} p5 ${stats.p5} p95 ${stats.p95} lum ${stats.luminance.toFixed(0)} clip ${(stats.clipped * 100).toFixed(1)}% person ${input.personLuminance?.toFixed(0) ?? '–'} tilt ${s.tilt ? `${s.tilt.beta.toFixed(0)}/${s.tilt.gamma.toFixed(0)}` : '–'} shake ${s.shaking?.toFixed(1) ?? '–'} people ${people}`);
          if (r.current && r.current.fix !== lastFix) { lastFix = r.current.fix; say(r.current.fix); }
          if (r.ready) { lastFix = ''; readyCount++; if (!readySince) readySince = now; if (now - readySince >= READY_HOLD_MS && readyCount >= 5) startCountdown(); }
          else { readySince = 0; readyCount = 0; }
        }
        if (phaseRef.current === 'recording') {
          if (counter.update(lm, now)) { setReps(counter.reps); say(String(counter.reps), { force: true }); lastRepAt = now; setHint(null); }
          if (!lm && now - lastLostSay > 4000) { lastLostSay = now; say('Stay in view of the camera.', { force: true }); setHint('Stay in view of the camera.'); }
          if (counter.armsFlags > 0 && now - lastArmsSay > 8000) { lastArmsSay = now; say('Keep your arms crossed.', { force: true }); setHint('Keep your arms crossed over your chest.'); }
          if (counter.reps > 0 && now - lastRepAt > 8000) { lastRepAt = now; say('Keep going if you can.', { force: true }); }
          const hp = lm ? lm[23] ?? lm[24] : null;
          if (hp && boxRef.current) {
            const b = toBox(hp);
            pts.push(b); if (pts.length > 300) pts.shift();
            setHip(b);
            if (pts.length % 3 === 0) setTrail(pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
          }
          setLeft(Math.max(0, Math.ceil((endAt - now) / 1000)));
          if (now >= endAt) { finish(); return; }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'Insecure' });
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        // If the screen closed while the camera was starting, turn it straight off again.
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => undefined);
        landmarker = await loadPose();
        if (cancelled) return;
        if (boxRef.current) setBox({ w: boxRef.current.clientWidth, h: boxRef.current.clientHeight });
        setPhase('checking');
        say('Prop your phone upright at hip height, two or three steps away, with your side facing it. I’ll tell you if anything needs fixing.', { force: true });
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const name = (e as Error).name;
        setError(name === 'NotAllowedError' ? 'Rise needs your camera to count your stands. On iPhone: Settings › Safari › Camera › Allow, then try again.'
          : name === 'Insecure' ? 'Your browser blocked the camera because this page is not on a secure link. Open Rise from its https link.'
          : name === 'NotFoundError' ? "We couldn't find a camera on this device."
          : name === 'NotReadableError' ? 'Another app is using the camera. Close it and try again.'
          : "We couldn't start the movement tracker. Check your internet connection and try again.");
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      sensors.stop();
      stream?.getTracks().forEach((t) => t.stop());
      stopSpeaking();
    };
  }, [attempt, onDone]);

  const current = checks.find((c) => c.status === 'fix');
  const retry = () => { setError(null); setReps(0); setLeft(30); setTrail(''); setHip(null); setChecks([]); setHint(null); setPhase('starting'); setAttempt((a) => a + 1); };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className={`cam${current ? ' cam--fix' : ''}`} ref={boxRef}>
        <video ref={videoRef} playsInline muted autoPlay aria-label="Camera preview" className="mirror" />
        <svg className="overlay" viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true">
          {phase !== 'recording' && bones.map((b) => <polyline key={b} className={`bone${current ? ' bone--fix' : ''}`} points={b} />)}
          {trail && <polyline className="path" points={trail} />}
          {hip && <circle className="hip" cx={hip.x} cy={hip.y} r="9" />}
        </svg>
        {phase === 'checking' && current && <div className="cam__fix" aria-hidden="true">{current.fix}</div>}
        {phase === 'recording' && <span className="cam__badge">Recording</span>}
        {count != null && <div className="cam__count" aria-live="assertive">{count}</div>}
        {DEBUG && debug && <div className="cam__debug">{debug}</div>}
      </div>

      {phase === 'starting' && <p className="rise-body-lg" aria-live="polite">Starting your camera…</p>}

      {phase === 'checking' && (
        <>
          <h2 className="rise-title">Getting your camera ready</h2>
          <ul className="rise-checks" aria-live="polite">
            {checks.map((c) => (
              <li key={c.id} className={`rise-check rise-check--${c.status}`}>
                <Mark status={c.status} />{c.status === 'fix' ? c.fix : c.label}
                <span className="rise-check__state" style={{ color: c.status === 'ok' ? 'var(--steady)' : c.status === 'fix' ? 'var(--watch)' : undefined }}>{c.status === 'ok' ? 'Done' : c.status === 'fix' ? 'Fix' : 'Next'}</span>
              </li>
            ))}
          </ul>
          <p className="rise-caption" style={{ margin: 0 }}>{current ? 'Recording starts by itself when every check is done.' : 'All set. Hold still…'}</p>
        </>
      )}

      {phase === 'countdown' && <p className="rise-body-lg" aria-live="polite">Sit in the middle of the chair, arms crossed over your chest. Stand all the way up and sit back down, as many times as you can.</p>}

      {phase === 'recording' && (
        <>
          <div className="meter" aria-live="polite">
            <div><div className="rise-label">Stands</div><div className="data-xl">{reps}</div></div>
            <div style={{ textAlign: 'right' }}><div className="rise-label">Time left</div><div className="rise-num" style={{ fontSize: 28, lineHeight: '32px' }}>0:{String(left).padStart(2, '0')}</div></div>
          </div>
          {hint && <p className="note" role="status">{hint}</p>}
        </>
      )}

      {(phase === 'error' || phase === 'rejected') && error && (
        <div className="stack">
          <p role="alert" className="error-note">{error}</p>
          <button className="rise-btn rise-btn--primary rise-btn--block" onClick={retry}>Try again</button>
        </div>
      )}
      <button className="rise-btn rise-btn--quiet" onClick={onManual}>Can't use the camera? Enter your count</button>
    </div>
  );
}
