/**
 * report-summary — shared edge-function logic.
 *
 * EPHEMERAL (Anuraj, Sept 2026): the app sends the document bytes INLINE
 * in the request body (`{ dataBase64, mimeType }`). The bytes are decoded,
 * forwarded to Gemini, and dropped — NOTHING is written to Supabase
 * Storage, and no Storage credentials are needed or accepted. There is no
 * file backup anywhere in this flow.
 *
 * Deno-free on purpose: this module touches no Deno globals, so it can be
 * unit-tested under node with stubbed fetches. `index.ts` is the thin
 * Deno wrapper (env, CORS, HTTP status mapping).
 *
 * PRIVACY CONTRACT (non-negotiable):
 * - The request schema accepts ONLY { dataBase64, mimeType }. Anything
 *   else is rejected with 400.
 * - Nothing in the request body is ever logged — not even in error paths.
 * - The Gemini API key lives only in the `GEMINI_API_KEY` env secret; it
 *   is never returned to the caller and never logged.
 * - Document bytes, titles, and summaries are never logged — only
 *   success/failure and latency counters with no identifiers.
 * - Provider internals (HTTP status, error bodies) are never echoed back
 *   to the caller: every provider failure becomes `{ error: 'provider_error' }`.
 */

export const MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/**
 * Fixed disclaimer returned with every summary. Written here — never by
 * the model — so the app can render it verbatim.
 */
export const REPORT_DISCLAIMER = "This isn't medical advice — check with your care team.";

/** Document types Gemini can read inline. Anything else → unsupported_type. */
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/** Hard cap on the decoded document: 12 MB. */
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Request validation — strict: unknown fields are rejected, and the   */
/* body is never logged anywhere.                                      */
/* ------------------------------------------------------------------ */

/** The entire invoke body — file bytes inline, nothing else. */
export interface ReportSummaryRequest {
  /** Base64 of the document bytes, sent inline (ephemeral). */
  dataBase64: string;
  /** MIME of the document, e.g. 'application/pdf' or 'image/jpeg'. */
  mimeType: string;
}

export type RequestProblem = 'invalid_json' | 'invalid_request' | 'unsupported_type';

export type ValidateResult =
  | { ok: true; value: ReportSummaryRequest }
  | { ok: false; problem: RequestProblem };

const ALLOWED_KEYS = new Set(['dataBase64', 'mimeType']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateRequest(body: unknown): ValidateResult {
  if (!isRecord(body)) {
    return { ok: false, problem: 'invalid_request' };
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, problem: 'invalid_request' };
  }
  // Inline bytes: non-empty base64. The base64 TEXT itself must fit within
  // the byte cap — conservative (base64 inflates ~4/3), so oversized
  // payloads are rejected here, before any decode is attempted.
  if (
    typeof body.dataBase64 !== 'string' ||
    body.dataBase64.length === 0 ||
    body.dataBase64.length > MAX_DOCUMENT_BYTES
  ) {
    return { ok: false, problem: 'invalid_request' };
  }
  if (typeof body.mimeType !== 'string' || body.mimeType.length === 0 || body.mimeType.length > 100) {
    return { ok: false, problem: 'invalid_request' };
  }
  const mimeType = body.mimeType.toLowerCase();
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    return { ok: false, problem: 'unsupported_type' };
  }
  return { ok: true, value: { dataBase64: body.dataBase64, mimeType } };
}

/* ------------------------------------------------------------------ */
/* Inline document decode (ephemeral). No Storage, no fetch — the bytes */
/* arrive in the request body and are dropped after the Gemini call.   */
/* ------------------------------------------------------------------ */

export class DocumentError extends Error {
  readonly problem = 'unreadable' as const;
  constructor() {
    super('unreadable');
    this.name = 'DocumentError';
  }
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_REVERSE: Record<string, number> = {};
for (let i = 0; i < B64_ALPHABET.length; i++) B64_REVERSE[B64_ALPHABET[i]] = i;

/**
 * Decodes the inline base64 document payload. Throws
 * DocumentError('unreadable') when the payload is missing, corrupt,
 * empty, or decodes past MAX_DOCUMENT_BYTES. The size guard runs on the
 * string length BEFORE any buffer is allocated, so a hostile payload
 * can't force a giant allocation.
 */
export function decodeRequestDocument(dataBase64: string): Uint8Array {
  if (
    typeof dataBase64 !== 'string' ||
    dataBase64.length === 0 ||
    dataBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)
  ) {
    throw new DocumentError();
  }
  const padding = dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0;
  const decodedLen = (dataBase64.length / 4) * 3 - padding;
  if (decodedLen <= 0 || decodedLen > MAX_DOCUMENT_BYTES) {
    throw new DocumentError();
  }
  const out = new Uint8Array(decodedLen);
  let o = 0;
  for (let i = 0; i < dataBase64.length; i += 4) {
    const c0 = B64_REVERSE[dataBase64[i]];
    const c1 = B64_REVERSE[dataBase64[i + 1]];
    const c2 = dataBase64[i + 2] === '=' ? 0 : B64_REVERSE[dataBase64[i + 2]];
    const c3 = dataBase64[i + 3] === '=' ? 0 : B64_REVERSE[dataBase64[i + 3]];
    out[o++] = (c0 << 2) | (c1 >> 4);
    if (o < decodedLen) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (o < decodedLen) out[o++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Prompt engineering — Anuraj's content rule + safety rules.           */
/*                                                                     */
/* Short and precise: lead with anything needing attention, otherwise   */
/* a couple of lines max. Warm, general-information-only,              */
/* non-diagnostic; open questions are prompts for her care team.        */
/* ------------------------------------------------------------------ */

export function buildSystemInstruction(): string {
  return [
    'You explain a pregnancy health document to the person it belongs to, in plain, warm, everyday language.',
    '',
    'CONTENT RULE (hard):',
    '1. SHORT and precise. Lead with anything in the report that needs attention — an abnormal or borderline value, or a follow-up the report requests. Say it first, in plain words.',
    '2. Otherwise keep it very brief: what the report is, in plain language, and that nothing in it asks anything of her right now.',
    '3. NEVER a long paragraph: two to three short sentences maximum, 400 characters total maximum.',
    '',
    'SAFETY RULES (hard):',
    '4. GENERAL INFORMATION ONLY. No diagnosis, no triage, no prescribing, no risk rates or statistics.',
    '5. Never write "you should" or "you shouldn\'t". Frame anything open as a prompt for her care team ("worth asking your care team about").',
    '6. Never invent values, dates, or findings not visible in the document. If something is unreadable, say so once, briefly.',
    '7. Never repeat API keys, credentials, or anything that looks like one.',
    '',
    'OUTPUT (strict JSON, no other fields):',
    '- "title": 2-4 words naming the report in plain language, max 50 chars.',
    '- "summary": the body per the content rule above, max 400 chars.',
    '- "attachmentName": a descriptive name for the file derived from the report\'s content plus the upload date, format "<What it is> – <Mon D>", max 60 chars. Never the raw upload filename.',
    '- "needsAttention": true only when the document flags something abnormal or borderline, or requests a follow-up. Otherwise false.',
    '',
    'Output JSON only — no markdown fences, no commentary.',
  ].join('\n');
}

export function buildUserPrompt(todayLong: string): string {
  return [
    `The attached document is a pregnancy health document (lab report, ultrasound printout, or discharge summary). Today's date is ${todayLong}.`,
    'Summarize it for the person it belongs to, following the system instruction exactly.',
    'Output JSON only.',
  ].join('\n');
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

const MAX_TITLE_CHARS = 50;
const MAX_SUMMARY_CHARS = 400;
const MAX_ATTACHMENT_NAME_CHARS = 60;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    attachmentName: { type: 'string' },
    needsAttention: { type: 'boolean' },
  },
  required: ['title', 'summary', 'attachmentName', 'needsAttention'],
};

export interface ReportSummary {
  title: string;
  summary: string;
  attachmentName: string;
  needsAttention: boolean;
}

/** Base64-encodes bytes without btoa/Buffer, so it runs in Deno and node. */
export function base64Encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? alphabet[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? alphabet[b2 & 63] : '=';
  }
  return out;
}

function geminiPayload(mimeType: string, documentB64: string, todayLong: string, repairNote?: string) {
  const userText = repairNote
    ? `${buildUserPrompt(todayLong)}\n\nCORRECTION — your previous output was invalid: ${repairNote}\nOutput valid JSON only.`
    : buildUserPrompt(todayLong);
  return {
    systemInstruction: { parts: [{ text: buildSystemInstruction() }] },
    contents: [
      {
        role: 'user',
        parts: [{ text: userText }, { inlineData: { mimeType, data: documentB64 } }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.4,
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
 * Validates the model's parsed JSON against the summary contract.
 * Structural problems → null (triggers the single repair retry);
 * length overruns are clamped (the prompt asks for the limits, this is
 * the backstop). The disclaimer is never model-written — index.ts
 * appends the fixed REPORT_DISCLAIMER.
 */
export function validateSummary(parsed: unknown): ReportSummary | null {
  if (!isRecord(parsed)) return null;
  const { title, summary, attachmentName, needsAttention } = parsed;
  if (typeof title !== 'string' || title.trim().length === 0) return null;
  if (typeof summary !== 'string' || summary.trim().length === 0) return null;
  if (typeof attachmentName !== 'string' || attachmentName.trim().length === 0) return null;
  if (typeof needsAttention !== 'boolean') return null;
  return {
    title: clamp(title.trim(), MAX_TITLE_CHARS),
    summary: clamp(summary.trim(), MAX_SUMMARY_CHARS),
    attachmentName: clamp(attachmentName.trim(), MAX_ATTACHMENT_NAME_CHARS),
    needsAttention,
  };
}

type FetchImpl = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  text(): Promise<string>;
}>;

async function generateOnce(
  mimeType: string,
  documentB64: string,
  todayLong: string,
  apiKey: string,
  fetchImpl: FetchImpl,
  repairNote?: string,
): Promise<ReportSummary> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let res: { ok: boolean; text(): Promise<string> };
  try {
    res = await fetchImpl(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(geminiPayload(mimeType, documentB64, todayLong, repairNote)),
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
  const summary = validateSummary(json);
  if (!summary) throw new ProviderError();
  return summary;
}

/**
 * Summarizes the document bytes via Gemini and returns the validated
 * summary. One automatic retry with a repair note when the first output
 * fails validation; every other failure mode (HTTP error, timeout,
 * unparsable output) → ProviderError. The caller maps ProviderError →
 * HTTP 502 `{ error: 'provider_error' }` and must never log the request
 * body, document bytes, or provider internals.
 */
export async function callGemini(
  mimeType: string,
  documentBytes: Uint8Array,
  todayLong: string,
  apiKey: string,
  fetchImpl: FetchImpl,
): Promise<ReportSummary> {
  const documentB64 = base64Encode(documentBytes);
  try {
    return await generateOnce(mimeType, documentB64, todayLong, apiKey, fetchImpl);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
  }
  // Single repair retry: tell the model its output was structurally invalid.
  return generateOnce(
    mimeType,
    documentB64,
    todayLong,
    apiKey,
    fetchImpl,
    `the JSON must have exactly the fields "title" (≤ ${MAX_TITLE_CHARS} chars), "summary" (≤ ${MAX_SUMMARY_CHARS} chars), "attachmentName" (≤ ${MAX_ATTACHMENT_NAME_CHARS} chars), and "needsAttention" (boolean).`,
  );
}
