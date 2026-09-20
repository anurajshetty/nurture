/**
 * report-summary — shared edge-function logic.
 *
 * Sends an uploaded pregnancy health document (lab report, ultrasound
 * printout, discharge summary) to the Gemini API for a short,
 * plain-language summary, plus a short title and an auto-derived
 * attachment name. The app uploads the file to her private Storage
 * bucket first; this function reads the bytes server-side from Storage
 * (forwarding the caller's Authorization header so RLS applies) — the
 * app never ships file bytes through the invoke call.
 *
 * Deno-free on purpose: this module touches no Deno globals, so it can
 * be unit-tested under node with stubbed fetches. `index.ts` is the thin
 * Deno wrapper (env, CORS, HTTP status mapping).
 *
 * PRIVACY CONTRACT (non-negotiable):
 * - The request schema accepts ONLY { eventId, bucket, storagePath,
 *   mimeType }. Anything else is rejected with 400.
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

/** Buckets the function is willing to read from (allowlist). */
export const ALLOWED_BUCKETS = ['photos', 'files'] as const;
export type ReportBucket = (typeof ALLOWED_BUCKETS)[number];

/** Document types Gemini can read inline. Anything else → unsupported_type. */
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/** The entire invoke request. Note what is absent: no file bytes, no names, no dates. */
export interface ReportSummaryRequest {
  /** The timeline event this summary belongs to (opaque id, never logged). */
  eventId: string;
  /** Storage bucket allowlist: 'photos' | 'files'. */
  bucket: ReportBucket;
  /** Object path inside the bucket, e.g. "reports/<uuid>.pdf". */
  storagePath: string;
  /** MIME of the uploaded file; must be one of the supported types. */
  mimeType: string;
}

/** The validated summary returned to the app (disclaimer appended by index.ts). */
export interface ReportSummary {
  /** 2–4 words naming the report, plain language. ≤50 chars. */
  title: string;
  /** The body, per Anuraj's content rule. ≤400 chars. */
  summary: string;
  /** Descriptive attachment name from the report's content + upload date. ≤60 chars. */
  attachmentName: string;
  /** True when the document flags anything abnormal/borderline or asks for a follow-up. */
  needsAttention: boolean;
}

export type RequestProblem = 'invalid_json' | 'invalid_request' | 'unsupported_type';

/* ------------------------------------------------------------------ */
/* Request validation — strict: unknown fields are rejected, and the    */
/* body is never logged anywhere.                                      */
/* ------------------------------------------------------------------ */

const ALLOWED_KEYS = new Set(['eventId', 'bucket', 'storagePath', 'mimeType']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown, maxLen: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

export function validateRequest(
  body: unknown,
): { ok: true; value: ReportSummaryRequest } | { ok: false; problem: RequestProblem } {
  if (!isRecord(body)) {
    return { ok: false, problem: 'invalid_request' };
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, problem: 'invalid_request' };
  }
  if (!isNonEmptyString(body.eventId, 80)) return { ok: false, problem: 'invalid_request' };
  if (typeof body.bucket !== 'string' || !(ALLOWED_BUCKETS as readonly string[]).includes(body.bucket)) {
    return { ok: false, problem: 'invalid_request' };
  }
  if (!isNonEmptyString(body.storagePath, 512)) return { ok: false, problem: 'invalid_request' };
  // Never let a crafted path escape the bucket.
  if (body.storagePath.includes('..') || body.storagePath.startsWith('/')) {
    return { ok: false, problem: 'invalid_request' };
  }
  if (typeof body.mimeType !== 'string' || body.mimeType.length === 0 || body.mimeType.length > 100) {
    return { ok: false, problem: 'invalid_request' };
  }
  if (!SUPPORTED_MIME_TYPES.has(body.mimeType.toLowerCase())) {
    return { ok: false, problem: 'unsupported_type' };
  }
  return {
    ok: true,
    value: {
      eventId: body.eventId,
      bucket: body.bucket as ReportBucket,
      storagePath: body.storagePath,
      mimeType: body.mimeType.toLowerCase(),
    },
  };
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
/* Storage download (server-side). The app never ships file bytes.     */
/* ------------------------------------------------------------------ */

export class DocumentError extends Error {
  readonly problem = 'unreadable' as const;
  constructor() {
    super('unreadable');
    this.name = 'DocumentError';
  }
}

export interface StorageRef {
  supabaseUrl: string;
  /**
   * The Supabase anon key (auto-provided as `SUPABASE_ANON_KEY`). Sent as
   * the `apikey` header so the Storage API accepts the request; the
   * caller's Authorization header is what RLS evaluates.
   */
  anonKey: string;
  /** The caller's Authorization header, forwarded so Storage RLS applies. */
  authHeader: string | null;
  bucket: ReportBucket;
  storagePath: string;
}

type FetchImpl = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

/**
 * Reads the uploaded file from Supabase Storage server-side. Throws
 * DocumentError('unreadable') when the object is missing, forbidden,
 * empty, or too large — the caller maps it to HTTP 422
 * `{ error: 'unreadable' }` and the app shows the "Couldn't read this
 * one" card.
 */
export async function fetchDocumentBytes(
  ref: StorageRef,
  fetchImpl: FetchImpl,
): Promise<Uint8Array> {
  const base = ref.supabaseUrl.replace(/\/+$/, '');
  const url = `${base}/storage/v1/object/${encodeURIComponent(ref.bucket)}/${ref.storagePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  const headers: Record<string, string> = { apikey: ref.anonKey };
  if (ref.authHeader) headers['Authorization'] = ref.authHeader;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
  } catch {
    throw new DocumentError();
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new DocumentError();
  let buffer: ArrayBuffer;
  try {
    buffer = await res.arrayBuffer();
  } catch {
    throw new DocumentError();
  }
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentError();
  }
  return new Uint8Array(buffer);
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
  let res;
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
