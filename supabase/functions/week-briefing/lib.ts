/**
 * week-briefing — shared edge-function logic (v1.1: LLM-as-phraser).
 *
 * The app now curates the facts on-device (the 40-week matrix in
 * src/briefing/matrix.ts) and the rules engine (src/briefing/engine.ts)
 * chooses the slots and their order. This function's only job is to PHRASE
 * the curated slots warmly. It never invents facts.
 *
 * - The request carries the anonymized context + the engine's plan
 *   (slot ids with their verbatim curated preview/body) + freshAngles.
 * - The model may reword the preview (≤80 chars) and body lines
 *   (same count, ≤220 chars each) of each slot. It must never add claims,
 *   numbers, or medical interpretation beyond the supplied text.
 * - Validation rejects structural problems; length overruns are clamped.
 * - When the provider fails, the app renders the curated copy directly —
 *   the function is a polish layer, never a dependency.
 *
 * Deno-free on purpose: this module touches no Deno globals, so it can be
 * unit-tested under node with a stubbed fetch. `index.ts` is the thin Deno
 * wrapper (env, CORS, HTTP status mapping).
 *
 * PRIVACY CONTRACT (the whole point of this function):
 * - The request schema accepts ONLY anonymized context plus the engine's
 *   curated plan text. Anything else is rejected.
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
 * One slot for the phraser: the engine's curated, human-reviewed text.
 * The model rewords `preview` and `body` — never the slotId.
 */
export interface PhraseSlotInput {
  /** Stable engine slot id, e.g. 'routine-baby', 'timely-prep-hospital-bag'. */
  slotId: string;
  /** Curated one-line preview (≤80 chars). */
  preview: string;
  /** Curated body lines (1–5, each ≤220 chars). */
  body: string[];
}

/**
 * The entire phraser request. Note what is absent: no due date, no names,
 * no emails, no DOB, no free-text journal content, no media.
 */
export interface PhraseRequest {
  /** Gestational week, 1-indexed: 4..42. */
  week: number;
  /** Day of the gestational week, 1-indexed: 1..7. */
  day: number;
  firstTimeMom: boolean;
  ageBand?: AgeBand;
  /** Distinct canonical symptom labels from the last 14 days, max 5. Context only. */
  symptomThemes: string[];
  /** Engine plan hash — lets the app cache by plan. */
  planHash: string;
  /** 2–3 one-line angles from the matrix the model may riff on. */
  freshAngles: string[];
  /** Only the slots the engine flagged phrase: true, in render order. */
  slots: PhraseSlotInput[];
}

export interface PhraseSlotOutput {
  slotId: string;
  preview: string;
  body: string[];
}

export interface PhraseResponse {
  slots: PhraseSlotOutput[];
  /** Set by the function from its own clock — never trusted from the model. */
  reviewDate: string;
}

export type RequestProblem = 'invalid_json' | 'invalid_request';

/* ------------------------------------------------------------------ */
/* Request validation — strict: unknown fields are rejected, and the    */
/* body is never logged anywhere.                                      */
/* ------------------------------------------------------------------ */

const ALLOWED_KEYS = new Set([
  'week',
  'day',
  'firstTimeMom',
  'ageBand',
  'symptomThemes',
  'planHash',
  'freshAngles',
  'slots',
]);
const ALLOWED_SLOT_KEYS = new Set(['slotId', 'preview', 'body']);

const MAX_SLOTS = 12;
const MAX_PREVIEW_CHARS = 80;
const MAX_BODY_LINES = 5;
const MAX_BODY_LINE_CHARS = 220;
const MAX_FRESH_ANGLES = 3;

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkSlot(s: unknown): PhraseSlotInput | null {
  if (!isRecord(s)) return null;
  for (const key of Object.keys(s)) {
    if (!ALLOWED_SLOT_KEYS.has(key)) return null;
  }
  if (typeof s.slotId !== 'string' || s.slotId.length === 0 || s.slotId.length > 80) return null;
  if (typeof s.preview !== 'string' || s.preview.length === 0 || s.preview.length > MAX_PREVIEW_CHARS) return null;
  if (!Array.isArray(s.body) || s.body.length < 1 || s.body.length > MAX_BODY_LINES) return null;
  const body: string[] = [];
  for (const line of s.body) {
    if (typeof line !== 'string' || line.length === 0 || line.length > MAX_BODY_LINE_CHARS) return null;
    body.push(line);
  }
  return { slotId: s.slotId, preview: s.preview, body };
}

export function validateRequest(
  body: unknown,
): { ok: true; value: PhraseRequest } | { ok: false; problem: RequestProblem } {
  if (!isRecord(body)) {
    return { ok: false, problem: 'invalid_request' };
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, problem: 'invalid_request' };
  }
  if (!isIntInRange(body.week, 4, 42)) return { ok: false, problem: 'invalid_request' };
  if (!isIntInRange(body.day, 1, 7)) return { ok: false, problem: 'invalid_request' };
  if (typeof body.firstTimeMom !== 'boolean') return { ok: false, problem: 'invalid_request' };

  const value: PhraseRequest = {
    week: body.week,
    day: body.day,
    firstTimeMom: body.firstTimeMom,
    symptomThemes: [],
    planHash: '',
    freshAngles: [],
    slots: [],
  };

  if (body.ageBand !== undefined) {
    if (typeof body.ageBand !== 'string' || !(AGE_BANDS as readonly string[]).includes(body.ageBand)) {
      return { ok: false, problem: 'invalid_request' };
    }
    value.ageBand = body.ageBand as AgeBand;
  }

  if (!Array.isArray(body.symptomThemes) || body.symptomThemes.length > 5) {
    return { ok: false, problem: 'invalid_request' };
  }
  for (const t of body.symptomThemes) {
    if (typeof t !== 'string' || t.trim().length === 0 || t.length > 40) {
      return { ok: false, problem: 'invalid_request' };
    }
    value.symptomThemes.push(t.trim());
  }

  if (typeof body.planHash !== 'string' || body.planHash.length === 0 || body.planHash.length > 32) {
    return { ok: false, problem: 'invalid_request' };
  }
  value.planHash = body.planHash;

  if (!Array.isArray(body.freshAngles) || body.freshAngles.length > MAX_FRESH_ANGLES) {
    return { ok: false, problem: 'invalid_request' };
  }
  for (const a of body.freshAngles) {
    if (typeof a !== 'string' || a.length > 120) return { ok: false, problem: 'invalid_request' };
    value.freshAngles.push(a);
  }

  if (!Array.isArray(body.slots) || body.slots.length === 0 || body.slots.length > MAX_SLOTS) {
    return { ok: false, problem: 'invalid_request' };
  }
  const seen = new Set<string>();
  for (const s of body.slots) {
    const slot = checkSlot(s);
    if (!slot) return { ok: false, problem: 'invalid_request' };
    if (seen.has(slot.slotId)) return { ok: false, problem: 'invalid_request' };
    seen.add(slot.slotId);
    value.slots.push(slot);
  }

  return { ok: true, value };
}

/* ------------------------------------------------------------------ */
/* Prompt engineering — the phraser contract.                           */
/*                                                                     */
/* The system instruction carries the product's safety rules; the user  */
/* prompt carries ONLY the anonymized context + the engine's curated    */
/* slots. The model rewords; it never invents. Neither ever contains   */
/* identifiers — the PhraseRequest type has no field for them.          */
/* ------------------------------------------------------------------ */

export function buildSystemInstruction(): string {
  return [
    'You are the phraser for Willow, a warm pregnancy journal app.',
    'You receive curated, human-reviewed pregnancy facts as slots (slotId + preview + body lines).',
    'Your ONLY job: reword each slot\'s preview and body in the app\'s voice — specific, not sugary; calm, not clinical.',
    '',
    'HARD RULES — every slot must obey all of these:',
    '1. NEVER add claims, facts, numbers, names, or medical interpretation beyond the supplied text.',
    '   Rephrase ONLY what is there. If a line is already warm, you may return it nearly unchanged.',
    '2. GENERAL INFORMATION ONLY. Keep the "many people…", "usually…", "often…" posture of the source text.',
    '3. NEVER personalize. Do not interpret the reader\'s experience.',
    "   Never write 'your back pain means…', 'your X means Y', or anything that",
    '   connects a symptom to her personally.',
    '4. NO diagnosis, NO triage, NO warnings, NO risk rates, NO scary statistics.',
    '   No prescriptive "you should/shouldn\'t".',
    '5. Keep the EXACT slotIds, in the EXACT order given. Keep the SAME number of body lines per slot.',
    '6. Never use fetal nicknames (no \'peanut\', \'little one\', \'baby bean\'). Never assume the baby\'s sex.',
    '7. The "recently logged" themes are aggregate category labels — context for tone only.',
    '   Never mention that she logged them. Never connect them to her.',
    '',
    'FORMAT: preview ≤ 80 chars, body lines each ≤ 220 chars. Output JSON only — no markdown fences, no commentary.',
  ].join('\n');
}

export function buildUserPrompt(r: PhraseRequest): string {
  const lines: string[] = [
    `Phrase these pregnancy-briefing slots for: pregnancy week ${r.week}, day ${r.day} of that week.`,
    r.firstTimeMom
      ? 'She is a first-time mother.'
      : 'This is not her first pregnancy.',
  ];
  if (r.ageBand) lines.push(`Her age band is ${r.ageBand}.`);
  if (r.symptomThemes.length > 0) {
    lines.push(
      `Recently logged symptom themes (last 14 days, category labels only, for tone context): ${r.symptomThemes.join(', ')}.`,
    );
  } else {
    lines.push('No recent symptom themes logged.');
  }
  if (r.freshAngles.length > 0) {
    lines.push(
      `Fresh angles you may riff on (only within the supplied facts): ${r.freshAngles.join(' · ')}.`,
    );
  }
  lines.push(
    'Reword each slot\'s preview and body warmly. Never add claims. Return the same slotIds in the same order:',
    JSON.stringify({ slots: r.slots }),
    'Output JSON only.',
  );
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
    slots: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_SLOTS,
      items: {
        type: 'object',
        properties: {
          slotId: { type: 'string' },
          preview: { type: 'string' },
          body: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_BODY_LINES,
            items: { type: 'string' },
          },
        },
        required: ['slotId', 'preview', 'body'],
      },
    },
    reviewDate: { type: 'string' },
  },
  required: ['slots', 'reviewDate'],
};

function geminiPayload(r: PhraseRequest, extraInstruction?: string) {
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
 * Validates the model's parsed JSON against the phraser contract: the same
 * slotIds in the same order as the request, each with a preview and the
 * same number of body lines. Structural problems → null; length overruns
 * are clamped (the prompt asks for the limits, this is the backstop).
 * `reviewDate` is always the function's own today — the model's value is
 * ignored.
 */
export function validatePhrasing(
  parsed: unknown,
  request: PhraseRequest,
  todayISO: string,
): PhraseResponse | null {
  if (!isRecord(parsed)) return null;
  const slots = parsed.slots;
  if (!Array.isArray(slots) || slots.length !== request.slots.length) return null;
  const out: PhraseSlotOutput[] = [];
  for (let i = 0; i < request.slots.length; i++) {
    const expected = request.slots[i];
    const s = slots[i] as Record<string, unknown> | null;
    if (!isRecord(s)) return null;
    if (s.slotId !== expected.slotId) return null; // exact order, exact ids
    if (typeof s.preview !== 'string' || s.preview.trim().length === 0) return null;
    if (!Array.isArray(s.body) || s.body.length !== expected.body.length) return null;
    const body: string[] = [];
    for (const line of s.body) {
      if (typeof line !== 'string' || line.trim().length === 0) return null;
      body.push(clamp(line.trim(), MAX_BODY_LINE_CHARS));
    }
    out.push({
      slotId: expected.slotId,
      preview: clamp(s.preview.trim(), MAX_PREVIEW_CHARS),
      body,
    });
  }
  return { slots: out, reviewDate: todayISO };
}

type FetchImpl = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

async function generateOnce(
  r: PhraseRequest,
  apiKey: string,
  fetchImpl: FetchImpl,
  todayISO: string,
  repairNote?: string,
): Promise<PhraseResponse> {
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
  const phrasing = validatePhrasing(json, r, todayISO);
  if (!phrasing) throw new ProviderError();
  return phrasing;
}

/**
 * Calls Gemini and returns validated phrasing. One automatic retry with
 * a repair note when the first output fails validation; every other
 * failure mode (HTTP error, timeout, unparsable output) → ProviderError.
 * The caller maps ProviderError → HTTP 502 `{ error: 'provider_error' }`
 * and must never log the request body or provider internals.
 */
export async function callGemini(
  r: PhraseRequest,
  apiKey: string,
  fetchImpl: FetchImpl,
  todayISO: string,
): Promise<PhraseResponse> {
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
    `the JSON did not match the required schema (same ${r.slots.length} slotIds in the same order, preview ≤ ${MAX_PREVIEW_CHARS} chars, ${MAX_BODY_LINES} or fewer body lines of ≤ ${MAX_BODY_LINE_CHARS} chars each).`,
  );
}
