import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { View } from './geometry';
import { createWithFallbacks } from '../visionFiles';

let loading: Promise<PoseLandmarker> | null = null;

/** Pose model in still-image mode with a person segmentation mask. Runs on the device; photos are never uploaded. */
function loadImagePose(): Promise<PoseLandmarker> {
  if (!loading) {
    loading = createWithFallbacks(async (files, modelAssetPath, delegate) => {
      const { PoseLandmarker } = await import('@mediapipe/tasks-vision');
      return PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath, delegate }, runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true });
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** Landmarks and a person mask for one photo. */
export async function analyzePhoto(img: HTMLCanvasElement | HTMLImageElement | ImageBitmap): Promise<View | null> {
  const pose = await loadImagePose();
  const res = pose.detect(img);
  const lm = res.landmarks[0];
  const m = res.segmentationMasks?.[0];
  if (!lm || !m) { res.segmentationMasks?.forEach((x) => x.close()); return null; }
  const view: View = { landmarks: lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })), mask: { data: m.getAsFloat32Array().slice(), width: m.width, height: m.height } };
  res.segmentationMasks?.forEach((x) => x.close());
  return view;
}

/** Load a chosen photo file into a canvas, scaled down so analysis stays fast. */
export async function fileToCanvas(file: File, maxSide = 960): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
