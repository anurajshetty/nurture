/**
 * week-briefing — shared edge-function logic.
 *
 * Deno-free on purpose: this module touches no Deno globals, so it can be
 * unit-tested under node with a stubbed fetch. `index.ts` is the thin Deno
 * wrapper (env, CORS, HTTP status mapping).
 *
 * PRIVACY CONTRACT (the whole point of this function):
 * - The request schema accepts ONLY anonymized context: week, day,
 *   firstTimeMom, ageBand, symptomThemes. Anything else is rejected.
 * - Nothing in the request body is ever logged — not even in error paths.
 * - The Gemini API key lives only in the `GEMINI_API_KEY` env secret; it is
 *   never returned to the caller and never logged.
 * - Provider internals (status codes, error bodies) are never echoed back
 *   to the caller: every provider failure becomes `{ error: 'provider_error' }`.
 */

export const MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** Shown under every briefing. Fixed by the function — the model never writes it. */
export const BRIEFING_FOOTER = 'Not medical advice — general information only.';

export type AgeBand = 'under-25' | '25-29' | '30-34' | '35-39' | '40-plus';
export const AGE_BANDS: readonly AgeBand[] = [
  'under-25',
  '25-29',
  '30-34',
  '35-39',
  '40-plus',
];

/**
 * The entire anonymized context the app may send. Note what is absent:
 * no due date, no names, no emails, no DOB, no free-text notes, no media.
 */
export interface BriefingRequest {
  /** Gestational week, 1-indexed: 4..42. */
  week: number;
  /** Day of the gestational week, 1-indexed: 1..7. */
  day: number;
  firstTimeMom: boolean;
  ageBand?: AgeBand;
  /** Distinct canonical symptom labels from the last 14 days, max 5. */
  symptomThemes: string[];
}

export type CardId = 'baby' | 'body' | 'know' | 'tips';
export const CARD_ORDER: readonly CardId[] = ['baby', 'body', 'know', 'tips'];

export interface BriefingCard {
  id: CardId;
  title: string;
  subtitle: string;
  body: string[];
}

export interface Briefing {
  cards: BriefingCard[];
  /** Set by the function from its own clock — never trusted from the model. */
  reviewDate: string;
}

export type RequestProblem = 'invalid_json' | 'invalid_request';

/* ------------------------------------------------------------------ */
/* Request validation — strict: unknown fields are rejected, and the    */
/* body is never logged anywhere.                                      */
/* ------------------------------------------------------------------ */

const ALLOWED_KEYS = new Set(['week', 'day', 'firstTimeMom', 'ageBand', 'symptomThemes']);

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export function validateRequest(
  body: unknown,
): { ok: true; value: BriefingRequest } | { ok: false; problem: RequestProblem } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, problem: 'invalid_request' };
  }
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, problem: 'invalid_request' };
  }
  if (!isIntInRange(b.week, 4, 42)) return { ok: false, problem: 'invalid_request' };
  if (!isIntInRange(b.day, 1, 7)) return { ok: false, problem: 'invalid_request' };
  if (typeof b.firstTimeMom !== 'boolean') return { ok: false, problem: 'invalid_request' };

  const value: BriefingRequest = {
    week: b.week,
    day: b.day,
    firstTimeMom: b.firstTimeMom,
    symptomThemes: [],
  };

  if (b.ageBand !== undefined) {
    if (typeof b.ageBand !== 'string' || !(AGE_BANDS as readonly string[]).includes(b.ageBand)) {
      return { ok: false, problem: 'invalid_request' };
    }
    value.ageBand = b.ageBand as AgeBand;
  }

  if (!Array.isArray(b.symptomThemes) || b.symptomThemes.length > 5) {
    return { ok: false, problem: 'invalid_request' };
  }
  for (const t of b.symptomThemes) {
    if (typeof t !== 'string' || t.trim().length === 0 || t.length > 40) {
      return { ok: false, problem: 'invalid_request' };
    }
    value.symptomThemes.push(t.trim());
  }

  return { ok: true, value };
}

/* ------------------------------------------------------------------ */
/* Prompt engineering.                                                 */
/*                                                                     */
/* The system instruction carries the product's safety rules; the user  */
/* prompt carries ONLY the anonymized context. Neither ever contains   */
/* identifiers — the BriefingRequest type has no field for them.        */
/* ------------------------------------------------------------------ */

export function buildSystemInstruction(): string {
  return [
    'You are the week-briefing writer for Nurture, a warm pregnancy journal app.',
    'Write a one-week briefing as four short cards. Your reader is a pregnant woman.',
    '',
    'TONE — match this exactly: specific, not sugary; calm, not clinical;',
    'respectful, not presumptuous. Never force celebration. Never use fetal',
    "nicknames (no 'peanut', 'little one', 'baby bean'). Never assume the baby's sex.",
    '',
    'HARD RULES — every card must obey all of these:',
    "1. GENERAL INFORMATION ONLY. Describe what is typical in this week of pregnancy:",
    "   'in week 28, many women notice…', 'usually…', 'often…', 'it is common for…'.",
    '2. NEVER personalize. Do not interpret the reader\'s experience.',
    "   Never write 'your back pain means…', 'your X means Y', or anything that",
    '   connects a symptom to her personally.',
    '3. NO diagnosis, NO triage, NO medical-adjacent alerts or warnings.',
    '   If a topic could be read as advice about what to do for a symptom,',
    '   keep it neutral and general — or leave it out.',
    '4. COMPACT CARDS: a few short lines each. Overflow rule — more to say',
    '   about the mother than fits goes in the BODY card; more about the',
    "   baby's development goes in the BABY card.",
    '5. EXACTLY FOUR CARDS, in this order:',
    '   baby — what is developing this week;',
    '   body — what many women commonly feel this week;',
    '   know — one useful piece of general knowledge;',
    '   tips — gentle everyday ideas.',
    '6. The "recently logged" themes are aggregate category labels from the last',
    '   14 days. Use them ONLY to weight which general-info topics are most',
    '   relevant this week (e.g. include backache among the common experiences).',
    '   Never mention that she logged them. Never connect them to her.',
    '',
    'FORMAT: title ≤ 40 chars, subtitle ≤ 60 chars, body 1–3 short lines,',
    'each line ≤ 220 chars. Output JSON only — no markdown fences, no commentary.',
  ].join('\n');
}

export function buildUserPrompt(r: BriefingRequest): string {
  const lines: string[] = [
    `Write the week briefing for: pregnancy week ${r.week}, day ${r.day} of that week (day 1 = first day of week ${r.week}).`,
    r.firstTimeMom
      ? 'She is a first-time mother.'
      : 'This is not her first pregnancy.',
  ];
  if (r.ageBand) lines.push(`Her age band is ${r.ageBand}.`);
  if (r.symptomThemes.length > 0) {
    lines.push(
      `Recently logged symptom themes (last 14 days, category labels only): ${r.symptomThemes.join(', ')}.`,
    );
  } else {
    lines.push('No recent symptom themes logged.');
  }
  lines.push('Output JSON only: exactly four cards in baby → body → know → tips order.');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Gemini call. `fetchImpl` is injectable so tests never hit the network. */
/* ------------------------------------------------------------------ */

export class ProviderError extends Error {
  constructor() {
    super('provider_error');
    this.name = 'ProviderError';
  }
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: ['baby', 'body', 'know', 'tips'] },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          body: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: { type: 'string' },
          },
        },
        required: ['id', 'title', 'subtitle', 'body'],
      },
    },
    reviewDate: { type: 'string' },
  },
  required: ['cards', 'reviewDate'],
};

function geminiPayload(r: BriefingRequest, extraInstruction?: string) {
  const userText = extraInstruction
    ? `${buildUserPrompt(r)}\n\nCORRECTION — your previous output was invalid: ${extraInstruction}\nOutput valid JSON only.`
    : buildUserPrompt(r);
  return {
    systemInstruction: { parts: [{ text: buildSystemInstruction() }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.6,
    },
  };
}

/** Truncates to max chars at a word boundary, appending '…'. */
function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1).replace(/\s+\S*$/, '');
  return `${cut || s.slice(0, max - 1)}…`;
}

/**
 * Validates the model's parsed JSON against the card contract. Structural
 * problems → null; length overruns are clamped (the prompt asks for the
 * limits, this is the backstop). `reviewDate` is always the function's own
 * today — the model's value is ignored.
 */
export function validateBriefing(parsed: unknown, todayISO: string): Briefing | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const cards = (parsed as Record<string, unknown>).cards;
  if (!Array.isArray(cards) || cards.length !== 4) return null;
  const out: BriefingCard[] = [];
  for (let i = 0; i < 4; i++) {
    const c = cards[i] as Record<string, unknown> | null;
    if (typeof c !== 'object' || c === null) return null;
    if (c.id !== CARD_ORDER[i]) return null; // exact order, exact ids
    if (typeof c.title !== 'string' || c.title.trim().length === 0) return null;
    if (typeof c.subtitle !== 'string' || c.subtitle.trim().length === 0) return null;
    if (!Array.isArray(c.body) || c.body.length < 1 || c.body.length > 3) return null;
    const body: string[] = [];
    for (const line of c.body) {
      if (typeof line !== 'string' || line.trim().length === 0) return null;
      body.push(clamp(line.trim(), 220));
    }
    out.push({
      id: c.id as CardId,
      title: clamp(c.title.trim(), 40),
      subtitle: clamp(c.subtitle.trim(), 60),
      body,
    });
  }
  return { cards: out, reviewDate: todayISO };
}

type FetchImpl = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

async function generateOnce(
  r: BriefingRequest,
  apiKey: string,
  fetchImpl: FetchImpl,
  todayISO: string,
  repairNote?: string,
): Promise<Briefing> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetchImpl(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(geminiPayload(r, repairNote)),
      signal: controller.signal,
    });
  } catch {
    throw new ProviderError();
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new ProviderError();
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new ProviderError();
  }
  let json: unknown;
  try {
    const parsed = JSON.parse(text) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const modelText = (parsed.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
    if (!modelText.trim()) throw new ProviderError();
    json = JSON.parse(modelText);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError();
  }
  const briefing = validateBriefing(json, todayISO);
  if (!briefing) throw new ProviderError();
  return briefing;
}

/**
 * Calls Gemini and returns a validated briefing. One automatic retry with
 * a repair note when the first output fails validation; every other
 * failure mode (HTTP error, timeout, unparsable output) → ProviderError.
 * The caller maps ProviderError → HTTP 502 `{ error: 'provider_error' }`
 * and must never log the request body or provider internals.
 */
export async function callGemini(
  r: BriefingRequest,
  apiKey: string,
  fetchImpl: FetchImpl,
  todayISO: string,
): Promise<Briefing> {
  try {
    return await generateOnce(r, apiKey, fetchImpl, todayISO);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
  }
  // Single repair retry: tell the model its output was structurally invalid.
  return generateOnce(
    r,
    apiKey,
    fetchImpl,
    todayISO,
    'the JSON did not match the required schema (4 cards in baby→body→know→tips order, title ≤ 40 chars, subtitle ≤ 60 chars, 1–3 body lines of ≤ 220 chars each).',
  );
}
