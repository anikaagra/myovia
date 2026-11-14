// Demo build only: AI through the Claude artifact runtime (`sample`), so the shared demo can show the real AI
// features without an API key. Same prompts, fact builders and safety checks as the server.
// @ts-expect-error plain JS module shared with the server
import * as T from '../../../server/src/aiText.js';
import type { Note, Plan, Reading } from './types';

type Sample = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string }>) & {
  json: (input: string, opts?: Record<string, unknown>) => Promise<unknown>;
};
let loading: Promise<Sample | null> | null = null;

export function demoSampler(): Promise<Sample | null> {
  if (!loading) {
    const c = (window as unknown as { claude?: { use: (n: string) => Promise<unknown> } }).claude;
    loading = c?.use ? c.use('sample').then((s) => (s as Sample) ?? null).catch(() => null) : Promise.resolve(null);
  }
  return loading;
}

const schemaText = (tool: { input_schema: unknown }) => JSON.stringify(tool.input_schema);

// Phone demo only (GitHub Pages): an Anthropic key the owner pasted into Settings, kept on this device only and
// sent straight to Anthropic. Never use this pattern with shared devices or real patients; the server keeps keys there.
const KEY = 'rise.demo.anthropicKey';
export const demoKey = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (k: string) => { try { if (k) localStorage.setItem(KEY, k); else localStorage.removeItem(KEY); } catch { /* ignore */ } },
};
const MODEL = 'claude-sonnet-5-5';

async function direct<Out>(system: string, tool: { name: string; input_schema: unknown }, content: unknown): Promise<Out | null> {
  const key = demoKey.get();
  if (!key) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1400, system, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content }] }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return (body.content?.find((b: { type: string }) => b.type === 'tool_use')?.input as Out) ?? null;
  } catch { return null; }
}

export async function demoAiAvailable() { return Boolean(demoKey.get() || (await demoSampler())); }

async function ask<Out>(system: string, tool: { name: string; input_schema: unknown }, user: string, opts: Record<string, unknown> = {}): Promise<Out | null> {
  if (demoKey.get()) {
    const images = (opts.images as Blob[] | undefined) ?? [];
    const blocks = await Promise.all(images.map(async (b) => ({
      type: b.type === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: b.type, data: await blobToBase64(b) },
    })));
    return direct<Out>(system, tool, images.length ? [...blocks, { type: 'text', text: user }] : user);
  }
  const s = await demoSampler();
  if (!s) return null;
  const input = `${system}\n\n${user}\n\nReply with only a JSON object matching this JSON Schema, no other text:\n${schemaText(tool)}`;
  try { return (await s.json(input, { modelTier: 'default', ...opts })) as Out; } catch { return null; }
}

export async function demoCoach(p: unknown, check: { id: number }, plan: Plan) {
  const facts = T.patientFacts(p, check, plan);
  const out = await ask<{ summary: string; why: string; tips: string[] }>(T.COACH_SYSTEM, T.COACH_TOOL, `Write the result message for this check. Facts (JSON):\n${JSON.stringify(facts)}`);
  if (!out?.summary || !out.why || T.unsafeText([out.summary, out.why, ...(out.tips ?? [])].join(' '))) return null;
  return { summary: T.clip(out.summary, 280), why: T.clip(out.why, 400), tips: (out.tips ?? []).slice(0, 3).map((t: string) => T.clip(t, 160)) };
}

export async function demoNote(p: unknown, followUps: unknown[]): Promise<Note | null> {
  const facts = T.providerFacts(p, followUps);
  const out = await ask<Note>(T.NOTE_SYSTEM, T.NOTE_TOOL, `Draft the note. Facts (JSON):\n${JSON.stringify(facts)}`);
  if (!out?.summary) return null;
  return { ...out, patientMessage: T.unsafeText(out.patientMessage) ? '' : out.patientMessage, ai: true };
}

export async function demoReadReport(blob: Blob): Promise<Reading | null> {
  const out = await ask<Record<string, unknown>>(T.READ_SYSTEM, T.READ_TOOL,
    'Read the body composition values from the attached report image. Use null for anything not shown.', { images: [blob] });
  return out ? (T.cleanReading(out) as Reading) : null;
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => bad(r.error); r.readAsDataURL(b); });
}
