// Where the on-device pose model and its WebAssembly runtime load from. Local copies first (served with the app,
// works under any base path such as GitHub Pages), then the public CDNs.
const BASE = import.meta.env.BASE_URL ?? '/';
export const WASM_PATHS = [`${BASE}mediapipe/wasm`, 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'];
export const MODEL_PATHS = [
  `${BASE}models/pose_landmarker_lite.task`,
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
];

type Files = Awaited<ReturnType<typeof import('@mediapipe/tasks-vision').FilesetResolver.forVisionTasks>>;
type Make<T> = (files: Files, modelAssetPath: string, delegate: 'GPU' | 'CPU') => Promise<T>;

/** Tries each runtime location, model location and GPU then CPU until one works. */
export async function createWithFallbacks<T>(make: Make<T>): Promise<T> {
  const { FilesetResolver } = await import('@mediapipe/tasks-vision');
  let lastErr: unknown;
  for (const wasm of WASM_PATHS) {
    let files: Files;
    try { files = await FilesetResolver.forVisionTasks(wasm); } catch (e) { lastErr = e; continue; }
    for (const model of MODEL_PATHS) {
      for (const delegate of ['GPU', 'CPU'] as const) {
        try { return await make(files, model, delegate); } catch (e) { lastErr = e; }
      }
    }
  }
  throw lastErr;
}
