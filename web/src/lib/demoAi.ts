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

async function ask<Out>(system: string, tool: { name: string; input_schema: unknown }, user: string, opts: Record<string, unknown> = {}): Promise<Out | null> {
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
