// AI features, powered by Claude. Every feature has a non-AI fallback, so Myovia works with no API key.
// Safety design:
//  - The rules engine (rules.js) decides Steady / Watch / Check in. The model never decides a state.
//  - Numbers (stands, protein grams, dates) come from code. The model only writes words around them,
//    and its output is checked: it must keep the same state and must not diagnose or touch medication.
//  - Patient photos/printouts sent for reading are not stored; only the extracted numbers are returned.

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { unsafeText, contradictsState, inventedNumbers, clip, patientFacts, providerFacts, cleanReading, COACH_SYSTEM, COACH_TOOL, NOTE_SYSTEM, NOTE_TOOL, READ_SYSTEM, READ_TOOL } from './aiText.js';

export { unsafeText, cleanReading, templateNote } from './aiText.js';

export const DEFAULT_MODEL = process.env.RISE_AI_MODEL || 'claude-sonnet-5-5';
export const FAST_MODEL = process.env.RISE_AI_FAST_MODEL || 'claude-haiku-5-5';

const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('base64url').slice(0, 32);

/**
 * Creates the AI service. `getKey(providerCode)` returns an API key or null.
 * `clientFor(key)` is injectable for tests.
 */
export function createAi(db, { getKey, clientFor = (apiKey) => new Anthropic({ apiKey, maxRetries: 2, timeout: 45_000 }) } = {}) {
  const cacheGet = db.prepare('SELECT output FROM ai_outputs WHERE kind = ? AND subject_id = ? AND input_hash = ?');
  const cachePut = db.prepare('INSERT OR REPLACE INTO ai_outputs (kind, subject_id, input_hash, output, model, created_at) VALUES (?,?,?,?,?,?)');

  async function callTool({ providerCode, model, system, content, tool, maxTokens = 1200 }) {
    const key = getKey(providerCode);
    if (!key) { const e = new Error('AI is not set up yet. Add an Anthropic API key in clinic settings.'); e.status = 503; e.code = 'ai_off'; throw e; }
    const client = clientFor(key);
    let res;
    try {
      res = await client.messages.create({
        model, max_tokens: maxTokens, system,
        tools: [tool], tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content }],
      });
    } catch (err) {
      const e = new Error(err?.status === 401 ? 'The AI key was rejected. Check the key in clinic settings.' : 'The AI service did not answer. Please try again.');
      e.status = err?.status === 401 ? 503 : 502; e.code = 'ai_error'; e.cause = err;
      throw e;
    }
    const block = res?.content?.find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (!block) { const e = new Error('The AI answer was incomplete. Please try again.'); e.status = 502; e.code = 'ai_error'; throw e; }
    return { input: block.input, model: res.model ?? model };
  }

  async function cached(kind, subjectId, input, fn) {
    const h = hash(input);
    const hit = cacheGet.get(kind, String(subjectId), h);
    if (hit) return JSON.parse(hit.output);
    const out = await fn();
    cachePut.run(kind, String(subjectId), h, JSON.stringify(out), out.model ?? null, new Date().toISOString());
    return out;
  }

  return {
    enabled: (providerCode) => Boolean(getKey(providerCode)),

    /**
     * Patient-facing message for one check. Keeps the rules' state, verdict and numbers; personalizes the
     * explanation and the week's plan to the patient's goal, limits and what changed.
     */
    async coach(p, check, plan) {
      const facts = patientFacts(p, check, plan);
      return cached('coach', check.id, facts, async () => {
        const { input, model } = await callTool({
          providerCode: p.providerCode, model: DEFAULT_MODEL, maxTokens: 900,
          system: COACH_SYSTEM,
          content: `Write the result message for this check. Facts (JSON):\n${JSON.stringify(facts)}`,
          tool: COACH_TOOL,
        });
        const text = [input.summary, input.why, ...(input.tips ?? [])].join(' ');
        if (unsafeText(text) || !input.summary || !input.why || contradictsState(text, check.state, check.flagged) || inventedNumbers(text, facts).length) {
          const e = new Error('AI message did not pass safety checks'); e.status = 502; e.code = 'ai_unsafe'; throw e;
        }
        return { summary: clip(input.summary, 280), why: clip(input.why, 400), tips: (input.tips ?? []).slice(0, 3).map((t) => clip(t, 160)), model, ai: true };
      });
    },

    /** Draft clinical note for the care team. Reviewed and edited by staff before use. */
    async providerNote(p, followUps) {
      const facts = providerFacts(p, followUps);
      return cached('note', p.id, facts, async () => {
        const { input, model } = await callTool({
          providerCode: p.providerCode, model: DEFAULT_MODEL, maxTokens: 1400,
          system: NOTE_SYSTEM,
          content: `Draft the note. Facts (JSON):\n${JSON.stringify(facts)}`,
          tool: NOTE_TOOL,
        });
        // The note is for clinicians, but the suggested patient message must meet patient-facing rules.
        const patientMessage = unsafeText(input.patientMessage) ? '' : input.patientMessage;
        // The state line is written by code and leads the summary, so the note can't misstate the result.
        const last = p.checks[p.checks.length - 1];
        const stateLine = `Myovia state ${last.createdAt.slice(0, 10)}: ${{ steady: 'Steady', watch: 'Watch', checkin: 'Check in' }[last.state]}${last.flagged ? ' (rough-day check)' : ''}.`;
        if (contradictsState(input.summary, last.state, true) && last.state !== 'steady') {
          const e = new Error('AI note contradicted the result'); e.status = 502; e.code = 'ai_unsafe'; throw e;
        }
        return {
          summary: clip(`${stateLine} ${input.summary}`, 700), measures: clip(input.measures, 1200), assessment: clip(input.assessment, 800),
          plan: clip(input.plan, 800), patientMessage: clip(patientMessage, 400), model, ai: true,
        };
      });
    },

    /** Reads a photo or PDF of a body composition printout (InBody, DEXA, smart scale screen). */
    async readReport(providerCode, { data, mediaType }) {
      const isPdf = mediaType === 'application/pdf';
      const { input, model } = await callTool({
        providerCode, model: FAST_MODEL, maxTokens: 700, system: READ_SYSTEM, tool: READ_TOOL,
        content: [
          isPdf
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
            : { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: 'Read the body composition values from this report. Use null for anything not shown.' },
        ],
      });
      return { ...cleanReading(input), model, ai: true };
    },
  };
}

