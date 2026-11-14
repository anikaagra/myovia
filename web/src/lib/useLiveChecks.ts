import { useEffect, useRef, useState } from 'react';
import { loadPose } from './pose';
import { CheckSmoother, evaluateScanFrame, type Check } from './cameraChecks';
import { toGray, cornerMotion, lensStats, regionMean } from './frameStats';
import { startSensors } from './deviceSensors';
import type { Point } from './repCounter';
import { say } from './speech';

const SW = 160, SH = 120;

/**
 * Live camera checks for the body-scan photos: lens, light, framing, pose, one person, phone upright.
 * Returns the checks and how long they have all been passing, so the photo can be taken automatically.
 */
export function useScanChecks(videoRef: React.RefObject<HTMLVideoElement>, active: boolean, shot: 'front' | 'side') {
  const [checks, setChecks] = useState<Check[]>([]);
  const [readyMs, setReadyMs] = useState(0);
  const [trackerOk, setTrackerOk] = useState(true);
  const shotRef = useRef(shot);
  shotRef.current = shot;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer = 0;
    const canvas = document.createElement('canvas'); canvas.width = SW; canvas.height = SH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const sensors = startSensors();
    let smoother = new CheckSmoother(3, 2);
    let lastShot = shotRef.current;
    let prev: Float32Array | null = null;
    let readySince = 0, lastFix = '';
    (async () => {
      let pose: Awaited<ReturnType<typeof loadPose>> | null = null;
      try { pose = await loadPose(); } catch { if (!cancelled) setTrackerOk(false); }
      const loop = () => {
        if (cancelled) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2) {
          if (shotRef.current !== lastShot) { lastShot = shotRef.current; smoother = new CheckSmoother(3, 2); readySince = 0; }
          let lm: Point[] | null = null, people = 0;
          if (pose) { try { const r = pose.detectForVideo(v, performance.now()); people = r.landmarks.length; lm = (r.landmarks[0] as Point[]) ?? null; } catch { /* skip frame */ } }
          ctx.drawImage(v, 0, 0, SW, SH);
          const gray = toGray(ctx.getImageData(0, 0, SW, SH).data, SW, SH);
          const stats = lensStats(gray, SW, SH);
          const xs = lm?.map((p) => p.x) ?? [], ys = lm?.map((p) => p.y) ?? [];
          const s = sensors.read();
          const raw = evaluateScanFrame({ ...stats, motion: cornerMotion(prev, gray, SW, SH), landmarks: pose ? lm : null, people,
            personLuminance: lm ? regionMean(gray, SW, SH, { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }) : null,
            tilt: s.tilt, shaking: s.shaking }, shotRef.current);
          // Without the tracker, framing and pose can't be judged; don't block the photo on them.
          if (!pose) raw.checks.forEach((c) => { if (['frame', 'pose', 'alone'].includes(c.id)) { c.status = 'ok'; c.fix = ''; } });
          prev = gray;
          const r = smoother.update(raw);
          setChecks(r.checks);
          if (r.current && r.current.fix !== lastFix) { lastFix = r.current.fix; say(r.current.fix); }
          const now = performance.now();
          if (r.ready) { if (!readySince) readySince = now; lastFix = ''; setReadyMs(now - readySince); } else { readySince = 0; setReadyMs(0); }
        }
        timer = window.setTimeout(loop, 250);
      };
      loop();
    })();
    return () => { cancelled = true; clearTimeout(timer); sensors.stop(); };
  }, [active, videoRef]);

  return { checks, readyMs, trackerOk, current: checks.find((c) => c.status === 'fix') ?? null };
}
