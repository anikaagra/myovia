import { useState } from 'react';
import { api } from '../lib/api';
import type { Reading } from '../lib/types';

const MAX_EDGE = 2000;

/** Shrinks a photo to a sharp-enough JPEG for reading text, and returns base64 without the data: prefix. */
async function photoToJpeg(file: File): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => null);
  const img = bmp ?? await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = URL.createObjectURL(file); });
  const w = 'naturalWidth' in img ? img.naturalWidth : img.width, h = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const s = Math.min(1, MAX_EDGE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}
const fileToBase64 = (file: File) => new Promise<string>((ok, bad) => {
  const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => bad(r.error); r.readAsDataURL(file);
});

/** Photo or PDF of a body composition printout, read by AI into numbers the patient then checks. The file isn't stored. */
export function ReportPhoto({ onDone, onCancel, onTypeInstead }: { onDone: (r: Reading) => void; onCancel: () => void; onTypeInstead: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    const pdf = file.type === 'application/pdf';
    if (pdf && file.size > 8_000_000) return setErr('That PDF is too large. Take a photo of the page instead.');
    setBusy(true);
    try {
      const data = pdf ? await fileToBase64(file) : await photoToJpeg(file);
      if (!pdf) setPreview(`data:image/jpeg;base64,${data}`);
      onDone(await api.readReport({ data, mediaType: pdf ? 'application/pdf' : 'image/jpeg' }));
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="rise-body-lg">Take a clear photo of your InBody result sheet or DEXA report, flat and in good light. Rise reads the numbers, then you check them.</p>
      <ul className="stack" style={{ margin: 0, paddingLeft: 24 }}>
        <li>Fill the frame with the page.</li>
        <li>Avoid glare and shadows.</li>
        <li>The photo isn't saved. Only the numbers you confirm are.</li>
      </ul>
      {preview && <img src={preview} alt="Your printout" className="report-preview" />}
      {busy ? <p className="rise-body-lg" aria-live="polite">Reading your printout… This can take up to 20 seconds.</p> : (
        <label className="rise-btn rise-btn--primary rise-btn--block" style={{ cursor: 'pointer' }}>
          {preview ? 'Try another photo' : 'Take or choose a photo'}
          <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      )}
      {err && <p role="alert" className="error-note">{err}</p>}
      {err && <button className="rise-btn rise-btn--secondary rise-btn--block" onClick={onTypeInstead}>Type the numbers in instead</button>}
      <button className="rise-btn rise-btn--quiet" onClick={onCancel} disabled={busy}>Choose another way</button>
    </div>
  );
}
