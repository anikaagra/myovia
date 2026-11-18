import { useEffect, useRef, useState } from 'react';
import { measureScan, type ScanMeasurements, type Sex, type View } from '../lib/bodyScan/geometry';
import { analyzePhoto, fileToCanvas } from '../lib/bodyScan/segment';
import { say, stopSpeaking, unlockSpeech } from '../lib/speech';
import { useScanChecks } from '../lib/useLiveChecks';
import { requestMotionAccess } from '../lib/deviceSensors';
import { IS_DEMO, SIMULATE_CAMERA } from '../lib/api';
import { DemoScan } from './DemoScan';
import { navyBodyFat } from '../lib/bodyScan/geometry';
import { combineEstimate, median, type Estimate } from '../lib/bodyScan/estimate';

export type PhoneScan = ScanMeasurements & { weightLb: number; leanMassLb: number; estimate: Estimate; photosUsed: number };
type Phase = 'demo' | 'intro' | 'camera' | 'upload' | 'working' | 'result';
type Shot = 'front' | 'side';

const TIMER_S = 10;

/** Two photos (front, side) → neck, waist and hip estimates → estimated body fat and lean mass. */
export function BodyScanCapture({ sex, age, heightIn, weightLb, previous, onWeight, onDone, onCancel }: {
  sex: Sex; age: number; heightIn: number | null; weightLb: string; previous?: { bodyFatPct: number; daysAgo: number } | null;
  onWeight: (v: string) => void; onDone: (s: PhoneScan) => void; onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [shot, setShot] = useState<Shot>('front');
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<PhoneScan | null>(null);
  const [height, setHeight] = useState(heightIn ? String(heightIn) : '');
  const photos = useRef<Partial<Record<Shot, HTMLCanvasElement[]>>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timers = useRef<number[]>([]);
  const [armed, setArmed] = useState<Shot | null>(null);
  // Demo builds can simulate the scan, so it can be shown on stage without taking photos.
  const [simulate, setSimulate] = useState(IS_DEMO);
  const live = useScanChecks(videoRef, phase === 'camera', shot);

  const stopCamera = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  useEffect(() => () => { stopCamera(); timers.current.forEach(clearTimeout); stopSpeaking(); }, []);

  const ready = () => {
    const w = Number(weightLb), h = Number(height);
    if (!(w >= 60 && w <= 800)) return "Enter today's weight from your scale first. The scan needs it to work out lean mass.";
    if (!(h >= 48 && h <= 90)) return 'Enter your height in inches (for example, 5 ft 4 in is 64).';
    return null;
  };

  async function process() {
    setPhase('working'); setErr(null);
    try {
      // Each view is a short burst of photos. Measure every front/side pair and keep the median, so one blurry
      // frame or a breath in can't swing the result.
      const fronts = (await Promise.all((photos.current.front ?? []).map(analyzePhoto))) as (View | null)[];
      const sides = (await Promise.all((photos.current.side ?? []).map(analyzePhoto))) as (View | null)[];
      const F = fronts.filter(Boolean) as View[], S = sides.filter(Boolean) as View[];
      if (!F.length || !S.length) throw new Error(`We couldn't find you in the ${!F.length ? 'front' : 'side'} photo. Stand 6 to 8 feet from the phone with your whole body in view.`);
      const results: ScanMeasurements[] = [];
      let lastIssue: string | null = null;
      for (let i = 0; i < Math.max(F.length, S.length); i++) {
        const { result: m, issue } = measureScan(F[i % F.length], S[i % S.length], Number(height), sex);
        if (m) results.push(m); else lastIssue = issue;
      }
      if (!results.length) throw new Error(lastIssue ?? 'Try the photos again.');
      const r1 = (n: number) => Math.round(n * 10) / 10;
      const m: ScanMeasurements = { neckIn: r1(median(results.map((x) => x.neckIn))), waistIn: r1(median(results.map((x) => x.waistIn))),
        hipIn: r1(median(results.map((x) => x.hipIn))), bodyFatPct: r1(median(results.map((x) => x.bodyFatPct))) };
      finish(m, results.length);
      setPhase('result');
      say('Your scan is done.', { force: true });
    } catch (e) {
      const msg = (e as Error).message;
      setErr(/fetch|network|wasm|model|Failed/i.test(msg) ? "We couldn't start the scanner. Check your internet connection and try again." : msg);
      photos.current = {};
      setShot('front');
      setPhase('intro');
    }
  }

  // The shareable demo can't open a camera or load the model, so it shows example measurements instead.
  function finish(m: ScanMeasurements, photosUsed: number) {
    const w = Number(weightLb);
    const estimate = combineEstimate({ photoPct: m.bodyFatPct, age, sex, heightIn: Number(height), weightLb: w, previous });
    setResult({ ...m, bodyFatPct: estimate.bodyFatPct, weightLb: w, leanMassLb: estimate.leanMassLb, estimate, photosUsed });
    setPhase('result');
    say(estimate.warning ? 'Your scan is done, but it may be off. Please check the screen.' : 'Your scan is done.', { force: true });
  }

  function demoScan() {
    // Example measurements in proportion to the patient's height and weight, as a real scan would produce.
    const h = Number(height), w = Number(weightLb);
    const bmi = (w * 0.4536) / (h * 0.0254) ** 2;
    const neckIn = (sex === 'male' ? 14.2 : 12.4) + (bmi - 25) * 0.14;
    const waistIn = h * (0.42 + (bmi - 22) * 0.0125), hipIn = h * (sex === 'male' ? 0.56 : 0.6) + (bmi - 25) * 0.5;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    // A returning patient's simulated photo reading sits close to their last scan, as a real one would.
    const bodyFatPct = previous ? r1(previous.bodyFatPct + 0.4) : r1(navyBodyFat(sex, h, neckIn, waistIn, hipIn) ?? 35);
    finish({ neckIn: r1(neckIn), waistIn: r1(waistIn), hipIn: r1(hipIn), bodyFatPct }, 6);
  }

  async function startCamera() {
    const e = ready(); if (e) return setErr(e);
    if (SIMULATE_CAMERA || simulate) { setErr(null); setPhase('demo'); return; }
    setErr(null); setShot('front'); photos.current = {}; setPhase('camera');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => undefined); }
      say('Prop your phone at waist height and step back until your whole body is in view. Face the phone with your arms a little away from your sides.', { force: true });
    } catch {
      setErr('Rise needs your camera for the scan. Allow camera access, or upload two photos instead.');
      setPhase('intro');
    }
  }

  function capture(which: Shot) {
    // A burst of 3 frames, 300 ms apart.
    const grab = () => {
      const v = videoRef.current!;
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      (photos.current[which] ??= []).push(c);
    };
    photos.current[which] = [];
    grab();
    window.setTimeout(grab, 300);
    window.setTimeout(() => {
      grab();
      say('Got it.', { force: true });
      if (which === 'front') { setShot('side'); window.setTimeout(() => say('Now turn so your side faces the phone, arms relaxed.', { force: true }), 900); }
      else { stopCamera(); process(); }
    }, 600);
  }

  // After the countdown, the photo is taken the moment every check has passed for a second (like Spren's
  // red-to-green capture), so a blurry or badly framed photo is never used.
  useEffect(() => {
    if (!armed) return;
    if (live.readyMs >= 1000 || !live.trackerOk) { const w = armed; setArmed(null); capture(w); }
  }, [armed, live.readyMs, live.trackerOk]); // eslint-disable-line react-hooks/exhaustive-deps

  function takeTimed(which: Shot) {
    say(which === 'front' ? 'Face the phone, arms slightly out. Taking the photo in 10 seconds.' : 'Turn so your side faces the phone. Arms relaxed. Taking the photo in 10 seconds.', { force: true });
    for (let i = TIMER_S; i >= 1; i--) timers.current.push(window.setTimeout(() => { setCount(i); if (i <= 3) say(String(i), { force: true }); }, (TIMER_S - i) * 1000));
    timers.current.push(window.setTimeout(() => { setCount(null); setArmed(which); }, TIMER_S * 1000));
  }

  async function onFiles(which: Shot, files: FileList | null) {
    if (!files?.[0]) return;
    photos.current[which] = [await fileToCanvas(files[0])];
    setErr(null);
    if (photos.current.front && photos.current.side) { const e = ready(); if (e) return setErr(e); process(); }
    else setShot(which === 'front' ? 'side' : 'front');
  }

  if (phase === 'result' && result) return (
    <div className="stack" style={{ gap: 16 }}>
      <h2 className="rise-title">Your scan results</h2>
      {result.estimate.warning && <p className="note" role="alert"><b>This scan may be off.</b> {result.estimate.warning}</p>}
      <div className="mini-stats">
        <div><span className="rise-caption">Body fat (estimate)</span><b>{result.bodyFatPct}%</b><span className="rise-caption">likely {result.estimate.low}–{result.estimate.high}%</span></div>
        <div><span className="rise-caption">Lean mass (estimate)</span><b>{result.leanMassLb} lb</b><span className="rise-caption">likely {result.estimate.leanLow}–{result.estimate.leanHigh} lb</span></div>
      </div>
      <dl className="kv">
        <dt>Neck</dt><dd className="rise-num">{result.neckIn} in</dd>
        <dt>Waist</dt><dd className="rise-num">{result.waistIn} in</dd>
        <dt>Hips</dt><dd className="rise-num">{result.hipIn} in</dd>
        <dt>Weight</dt><dd className="rise-num">{result.weightLb} lb</dd>
      </dl>
      {(SIMULATE_CAMERA || simulate) && <p className="note">Demo: these are example measurements. In the app they come from your front and side photos.</p>}
      <p className="rise-caption" style={{ margin: 0 }}>Estimated from your body's outline. A phone scan can be a few points off a DEXA scan, so Rise compares it only with your own past Rise scans. Your photos stayed on this phone and have been deleted.</p>
      <p className="rise-caption" style={{ margin: 0 }}>Measured from {result.photosUsed} photo{result.photosUsed === 1 ? '' : 's'} and checked against what's typical for your age, height and weight. Your trend over several scans is more reliable than any one scan.</p>
      {result.estimate.warning ? <>
        <button className="rise-btn rise-btn--primary rise-btn--block" onClick={() => { setResult(null); setPhase('intro'); }}>Scan again</button>
        <button className="rise-btn rise-btn--secondary rise-btn--block" onClick={() => onDone(result)}>Use these numbers anyway</button>
      </> : <>
        <button className="rise-btn rise-btn--primary rise-btn--block" onClick={() => onDone(result)}>Use these numbers</button>
        <button className="rise-btn rise-btn--quiet" onClick={() => { setResult(null); setPhase('intro'); }}>Scan again</button>
      </>}
    </div>
  );

  if (phase === 'demo') return <DemoScan onFinish={demoScan} onCancel={() => setPhase('intro')} />;
  if (phase === 'working') return <p className="rise-body-lg" aria-live="polite">Measuring your scan… This takes a few seconds.</p>;

  if (phase === 'camera') return (
    <div className="stack" style={{ gap: 16 }}>
      <div className={`cam${live.current ? ' cam--fix' : ''}`}>
        <video ref={videoRef} playsInline muted autoPlay aria-label="Camera preview" className="mirror" />
        <svg className="overlay" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true" style={{ transform: 'none' }}>
          <rect x="70" y="20" width="160" height="360" rx="20" fill="none" stroke="var(--on-brand)" strokeWidth="3" strokeDasharray="10 8" opacity=".8" />
        </svg>
        <span className="cam__badge">{shot === 'front' ? 'Photo 1 of 2: front' : 'Photo 2 of 2: side'}</span>
        {count != null && <div className="cam__count" aria-live="assertive">{count}</div>}
        {live.current && <div className="cam__fix" aria-hidden="true">{live.current.fix}</div>}
      </div>
      <ul className="rise-checks rise-checks--compact" aria-live="polite">
        {live.checks.map((c) => (
          <li key={c.id} className={`rise-check rise-check--${c.status}`}>{c.status === 'fix' ? c.fix : c.label}
            <span className="rise-check__state">{c.status === 'ok' ? 'Done' : c.status === 'fix' ? 'Fix' : '…'}</span></li>
        ))}
      </ul>
      {armed && <p className="note" role="status">{live.current ? 'Waiting for the checks above. The photo is taken as soon as they pass.' : 'Hold still…'}</p>}
      <p className="rise-body-lg">{shot === 'front' ? 'Face the phone with your arms a little away from your sides. Fit your whole body inside the dashed outline.' : 'Turn so your side faces the phone, arms relaxed at your sides.'}</p>
      <button className="rise-btn rise-btn--primary rise-btn--block" disabled={count != null || armed != null} onClick={() => takeTimed(shot)}>{count != null || armed ? 'Get in position…' : `Take ${shot} photo in ${TIMER_S} seconds`}</button>
      <button className="rise-btn rise-btn--quiet" onClick={() => { stopCamera(); timers.current.forEach(clearTimeout); setCount(null); setArmed(null); setPhase('intro'); }}>Cancel</button>
    </div>
  );

  if (phase === 'upload') return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="rise-body-lg">Choose two full-body photos: one facing the camera with arms slightly out, and one from the side.</p>
      <div className="field"><label className="rise-label" htmlFor="up-front">Front photo{photos.current.front ? ' ✓' : ''}</label><input id="up-front" type="file" accept="image/*" onChange={(e) => onFiles('front', e.target.files)} /></div>
      <div className="field"><label className="rise-label" htmlFor="up-side">Side photo{photos.current.side ? ' ✓' : ''}</label><input id="up-side" type="file" accept="image/*" onChange={(e) => onFiles('side', e.target.files)} /></div>
      {err && <p role="alert" className="error-note">{err}</p>}
      <button className="rise-btn rise-btn--quiet" onClick={() => setPhase('intro')}>Back</button>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="rise-body-lg">You'll take two photos, front and side. Rise measures your neck, waist and hips from your outline and estimates your body fat and lean mass.</p>
      <ul className="stack" style={{ margin: 0, paddingLeft: 24 }}>
        <li>Wear fitted clothes, like leggings and a fitted top.</li>
        <li>Stand 6 to 8 feet away, against a plain wall, in good light.</li>
        <li>Prop the phone at waist height. A timer gives you 10 seconds.</li>
      </ul>
      <div className="two-col">
        <div className="field"><label className="rise-label" htmlFor="scan-weight">Today's weight (lb)</label><input id="scan-weight" className="rise-num" inputMode="decimal" value={weightLb} onChange={(e) => { setErr(null); onWeight(e.target.value); }} /></div>
        <div className="field"><label className="rise-label" htmlFor="scan-height">Height (in)</label><input id="scan-height" className="rise-num" inputMode="numeric" value={height} onChange={(e) => { setErr(null); setHeight(e.target.value.replace(/\D/g, '')); }} /></div>
      </div>
      {IS_DEMO && !SIMULATE_CAMERA && (
        <div className="rise-choices" role="radiogroup" aria-label="Demo camera">
          <label className="rise-choice"><input type="radio" name="scanmode" id="scan-sim" checked={simulate} onChange={() => setSimulate(true)} /> Simulate the scan</label>
          <label className="rise-choice"><input type="radio" name="scanmode" id="scan-real" checked={!simulate} onChange={() => setSimulate(false)} /> Use my real camera</label>
        </div>
      )}
      {err && <p role="alert" className="error-note">{err}</p>}
      <button className="rise-btn rise-btn--primary rise-btn--block" onClick={() => { unlockSpeech(); void requestMotionAccess(); void startCamera(); }}>Start the scan</button>
      <button className="rise-btn rise-btn--secondary rise-btn--block" onClick={() => { const e = ready(); if (e) return setErr(e); setErr(null); photos.current = {}; setPhase('upload'); }}>Upload two photos instead</button>
      <button className="rise-btn rise-btn--quiet" onClick={onCancel}>Choose another way</button>
      <p className="rise-caption" style={{ margin: 0 }}>Photos are measured on this phone and never uploaded.</p>
    </div>
  );
}
