import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createWithFallbacks } from './visionFiles';

let loading: Promise<PoseLandmarker> | null = null;

/** Loads the on-device pose model once. Video never leaves the phone. Tracks up to 2 people so Rise can ask others to step out. */
export function loadPose(): Promise<PoseLandmarker> {
  if (!loading) {
    loading = createWithFallbacks(async (files, modelAssetPath, delegate) => {
      const { PoseLandmarker } = await import('@mediapipe/tasks-vision');
      return PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath, delegate }, runningMode: 'VIDEO', numPoses: 2 });
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}
