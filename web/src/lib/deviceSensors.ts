// Phone orientation and shake from the motion sensors. iPhone asks permission once, and only from a tap,
// so call requestMotionAccess() in the click handler that opens the camera.

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

export async function requestMotionAccess(): Promise<boolean> {
  try {
    const O = (globalThis as unknown as { DeviceOrientationEvent?: PermissionApi }).DeviceOrientationEvent;
    const M = (globalThis as unknown as { DeviceMotionEvent?: PermissionApi }).DeviceMotionEvent;
    const results = await Promise.all([O?.requestPermission?.(), M?.requestPermission?.()]);
    return results.every((r) => r === undefined || r === 'granted');
  } catch { return false; }
}

export type SensorReading = { tilt: { beta: number; gamma: number } | null; shaking: number | null };

/** Starts listening; `read()` returns the latest smoothed values (null when the phone doesn't report them). */
export function startSensors() {
  let tilt: SensorReading['tilt'] = null;
  let shaking: number | null = null;
  const onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    // In landscape the axes swap; Myovia asks for portrait, so only portrait is judged.
    const portrait = !screen.orientation || screen.orientation.type.startsWith('portrait');
    if (!portrait) { tilt = null; return; }
    tilt = tilt ? { beta: tilt.beta * 0.7 + e.beta * 0.3, gamma: tilt.gamma * 0.7 + e.gamma * 0.3 } : { beta: e.beta, gamma: e.gamma };
  };
  const onMotion = (e: DeviceMotionEvent) => {
    const r = e.rotationRate;
    if (!r || r.alpha == null) return;
    const mag = Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0);
    shaking = shaking == null ? mag : shaking * 0.8 + mag * 0.2;
  };
  window.addEventListener('deviceorientation', onOrient);
  window.addEventListener('devicemotion', onMotion);
  return {
    read: (): SensorReading => ({ tilt, shaking }),
    stop: () => { window.removeEventListener('deviceorientation', onOrient); window.removeEventListener('devicemotion', onMotion); },
  };
}
