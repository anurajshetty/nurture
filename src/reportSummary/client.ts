/**
 * Edge-function caller for Report summaries (Willow, ephemeral — Anuraj Sept 2026).
 *
 * `summarizeReport(input)` invokes the Supabase `report-summary` edge
 * function with `{ dataBase64, mimeType }` — the picked file's bytes,
 * read into memory ONLY for this call. NOTHING is persisted: no local DB
 * blob, no Supabase Storage upload, no media-outbox row, no "Backing
 * up…" states. The Gemini key never leaves the edge function.
 *
 * The response is validated strictly at runtime before it is trusted:
 * non-empty title/summary/attachmentName within the length caps, a
 * boolean needsAttention, and the fixed disclaimer (the function writes
 * it; the model never does).
 *
 * Failures surface as a typed ReportSummaryError:
 * - 'not_configured'  — the edge function has no provider key yet
 *   (or no backend is wired up). The entry is hard-deleted and the UI
 *   toasts — nothing persists a card (Anuraj, Sept 20, 2026).
 * - 'not_related'     — the function judged the document off-topic
 *   (HTTP 422 `{error:'not_related'}`). The entry is hard-deleted and
 *   the UI toasts — the document is never persisted as a feed entry.
 * - 'network'         — transport failure or the 20s timeout.
 * - 'invalid_response' — the function answered, but the outcome was
 *   unusable (bad schema, other 4xx/502), or the input failed validation.
 *
 * The supabase client is resolved lazily (and is injectable for tests) so
 * importing this module never touches native modules or the network.
 *
 * Ephemeral byte stash: `stashReportBytes` keeps the picked bytes in a
 * module-level Map (memory only, cleared after the summary attempt) so
 * the in-flight attempt can send them. A restart wipes the stash — a
 * persisted 'summarizing' state with no stashed bytes has its entry
 * hard-deleted instead of hanging.
 *
 * Summary-state persistence: `writeReportSummaryState` manages
 * `event.data.reportSummary` (`{status:'summarizing'} | {status:'ready',…}
 * | {status:'failed'}`), mirroring the store's dirty + outbox-upsert
 * convention so the state syncs like any other payload change. Listeners
 * via `subscribeReportSummary` are notified after every write so cards
 * re-render without polling.
 */

import { getDb } from '../lib/db';
import { getEvent, hardDeleteEvent } from '../sync/store';
import {
  REPORT_SUMMARY_DISCLAIMER,
  readReportSummaryState,
  runReportSummaryFlow,
  type ReportBytes,
  type ReportFailureKind,
  type ReportSummaryInput,
  type ReportSummaryResult,
  type ReportSummaryState,
} from './flow';

export {
  REPORT_SUMMARY_DISCLAIMER,
  readReportSummaryState,
  type ReportFailureKind,
  type ReportSummaryInput,
  type ReportSummaryResult,
  type ReportSummaryState,
};

/** Transient toast copy for a genuine summary failure (Anuraj, Sept 2026). Locked copy. */
export const REPORT_SUMMARY_FAILED_TOAST = 'Report summary failed';

/** Transient toast copy for the off-topic verdict (Anuraj, Sept 2026). Locked copy. */
export const REPORT_SUMMARY_NOT_RELATED_TOAST = 'Report not related to pregnancy or baby';

/** Name of the Supabase edge function that summarizes health documents. */
export const REPORT_SUMMARY_FUNCTION_NAME = 'report-summary';

/** Hard timeout for the edge-function round trip. */
export const REPORT_SUMMARY_FETCH_TIMEOUT_MS = 20_000;

/* Length caps (Anuraj's rule: short and precise, never a long paragraph). */
export const MAX_SUMMARY_TITLE_CHARS = 50;
export const MAX_SUMMARY_BODY_CHARS = 400;
export const MAX_ATTACHMENT_NAME_CHARS = 60;

/** Document types the edge function can read inline. */
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/** Sanity cap on the inline payload: 10MB of bytes ≈ 13.4M base64 chars. */
const MAX_INLINE_CHARS = 20_000_000;

export type ReportSummaryErrorCode = 'not_configured' | 'network' | 'invalid_response' | 'not_related';

/** Typed failure from summarizeReport. `code` is stable for UI branching. */
export class ReportSummaryError extends Error {
  readonly code: ReportSummaryErrorCode;
  constructor(code: ReportSummaryErrorCode, message: string) {
    super(message);
    this.name = 'ReportSummaryError';
    this.code = code;
  }
}

declare const require: (id: string) => unknown;

function toSummaryError(e: unknown, fallback: string): ReportSummaryError {
  if (e instanceof ReportSummaryError) return e;
  const message = e instanceof Error ? e.message : fallback;
  return new ReportSummaryError('network', message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function summaryInvalid(reason: string): ReportSummaryError {
  return new ReportSummaryError('invalid_response', `Bad summary payload: ${reason}.`);
}

/** Truncates to max chars, preferring a word boundary. */
function clampLen(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1).replace(/\s+\S*$/, '');
  return `${cut || s.slice(0, max - 1)}…`;
}

/**
 * Strict validation of the function's `{ title, summary, attachmentName,
 * needsAttention, disclaimer }` response. Length overruns are clamped —
 * the function already clamps, this is defense in depth. Throws
 * ReportSummaryError('invalid_response').
 */
export function validateSummaryResponse(data: unknown): ReportSummaryResult {
  if (!isRecord(data)) throw summaryInvalid('top-level payload is not an object');
  const { title, summary, attachmentName, needsAttention, disclaimer } = data;
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw summaryInvalid('title is missing');
  }
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw summaryInvalid('summary is missing');
  }
  if (typeof attachmentName !== 'string' || attachmentName.trim().length === 0) {
    throw summaryInvalid('attachmentName is missing');
  }
  if (typeof needsAttention !== 'boolean') {
    throw summaryInvalid('needsAttention must be a boolean');
  }
  return {
    title: clampLen(title.trim(), MAX_SUMMARY_TITLE_CHARS),
    summary: clampLen(summary.trim(), MAX_SUMMARY_BODY_CHARS),
    attachmentName: clampLen(attachmentName.trim(), MAX_ATTACHMENT_NAME_CHARS),
    needsAttention,
    disclaimer:
      typeof disclaimer === 'string' && disclaimer.trim().length > 0
        ? disclaimer
        : REPORT_SUMMARY_DISCLAIMER,
  };
}

/* ------------------------------------------------------------------ */
/* Transport.                                                          */
/* ------------------------------------------------------------------ */

/** Injectable seam for unit tests (same shape as the briefing client's). */
export interface SummarizeReportDeps {
  configured?: boolean;
  invoke?: (body: ReportSummaryInput) => Promise<{ data: unknown; error: unknown }>;
  timeoutMs?: number;
}

type InvokeFn = (body: ReportSummaryInput) => Promise<{ data: unknown; error: unknown }>;

/**
 * Test-only transport override, gated on the repo's `?testhooks=1` flag
 * (see src/testhooks.ts). The interactive suite sets
 * `window.__reportSummaryTestTransport = { invoke }` so the app still
 * crosses a real fetch boundary — stubbed at the network layer by
 * Playwright — even in builds with no Supabase credentials. Inert in
 * production: without `testhooks=1` this is never consulted.
 */
function readTestTransport(): InvokeFn | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as Record<string, unknown>;
  const search = (w.location as { search?: string } | undefined)?.search;
  if (typeof search !== 'string' || !search.includes('testhooks=1')) return undefined;
  const t = w.__reportSummaryTestTransport as { invoke?: unknown } | undefined;
  return typeof t?.invoke === 'function' ? (t.invoke as InvokeFn) : undefined;
}

/** Resolve the supabase transport (lazy so the module import stays pure). */
function resolveTransport(deps: SummarizeReportDeps): {
  configured: boolean;
  invoke: InvokeFn;
} {
  const testInvoke = deps.invoke ?? readTestTransport();
  let configured = deps.configured;
  let invoke: InvokeFn | undefined = testInvoke;
  if (configured === undefined || invoke === undefined) {
    const sb = require('../lib/supabase') as {
      isConfigured: boolean;
      supabase: {
        functions: {
          invoke: (
            name: string,
            opts: { body: ReportSummaryInput },
          ) => Promise<{ data: unknown; error: unknown }>;
        };
      } | null;
    };
    if (configured === undefined) configured = testInvoke ? true : sb.isConfigured;
    if (invoke === undefined) {
      const client = sb.supabase;
      invoke = async (body) => {
        const { data, error } = await client!.functions.invoke(REPORT_SUMMARY_FUNCTION_NAME, {
          body,
        });
        return { data, error };
      };
    }
  }
  return { configured: configured ?? false, invoke: invoke! };
}

/** True when a functions.invoke error is the edge function's 503 not_configured. */
function isNotConfiguredError(error: unknown, data: unknown): boolean {
  if (isRecord(data) && data.error === 'not_configured') return true;
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  return status === 503;
}

/**
 * True when the failure is the edge function's off-topic verdict: HTTP
 * 422 with a `{error:'not_related'}` body. Both 422 verdicts
 * ('unreadable' and 'not_related') share the status, so the BODY decides
 * — a bare 422 is not enough. Never throws and never logs the body
 * (document contents stay private).
 */
async function isNotRelatedVerdict(error: unknown, data: unknown): Promise<boolean> {
  try {
    if (isRecord(data) && data.error === 'not_related') return true;
    const context = (error as { context?: unknown } | null)?.context;
    if (!isRecord(context) || context.status !== 422) return false;
    const json = context.json;
    if (typeof json !== 'function') return false;
    const body = await (json as () => Promise<unknown>).call(context);
    return isRecord(body) && body.error === 'not_related';
  } catch {
    return false;
  }
}

/**
 * Summarizes a report via the `report-summary` edge function. Sends
 * `{ dataBase64, mimeType }` — the in-memory document bytes, inline.
 * Nothing is persisted by this call. Throws ReportSummaryError on any
 * failure.
 */
export async function summarizeReport(
  input: ReportSummaryInput,
  deps: SummarizeReportDeps = {},
): Promise<ReportSummaryResult> {
  if (typeof input.dataBase64 !== 'string' || input.dataBase64.length === 0) {
    throw summaryInvalid('input.dataBase64 must be a non-empty string');
  }
  if (input.dataBase64.length > MAX_INLINE_CHARS) {
    throw summaryInvalid('input.dataBase64 is larger than the inline cap');
  }
  if (typeof input.mimeType !== 'string' || !SUPPORTED_MIME_TYPES.has(input.mimeType.toLowerCase())) {
    throw summaryInvalid('input.mimeType must be a supported document type');
  }

  const { configured, invoke } = resolveTransport(deps);
  if (!configured) {
    throw new ReportSummaryError(
      'not_configured',
      'Report summaries are unavailable — the backend is not connected yet.',
    );
  }

  const timeoutMs = deps.timeoutMs ?? REPORT_SUMMARY_FETCH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = await Promise.race([
      invoke(input).then(
        (r) => ({ ok: true as const, result: r }),
        (e: unknown) => ({ ok: false as const, error: e }),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ReportSummaryError('network', `Summary request timed out after ${timeoutMs}ms.`),
            ),
          timeoutMs,
        );
      }),
    ]);
    if (!settled.ok) {
      // The transport threw (real supabase-js path: FunctionsHttpError on
      // non-2xx). An off-topic verdict still surfaces here — read the 422
      // body before falling back to the generic network mapping.
      if (await isNotRelatedVerdict(settled.error, null)) {
        throw new ReportSummaryError('not_related', 'Report is not related to pregnancy or baby.');
      }
      throw toSummaryError(settled.error, 'Summary request failed.');
    }
    if (settled.result.error) {
      if (isNotConfiguredError(settled.result.error, settled.result.data)) {
        throw new ReportSummaryError(
          'not_configured',
          'Report summaries are not set up yet.',
        );
      }
      if (await isNotRelatedVerdict(settled.result.error, settled.result.data)) {
        throw new ReportSummaryError('not_related', 'Report is not related to pregnancy or baby.');
      }
      // The function answered with an HTTP error (400/422/502 …): the
      // transport worked, the response didn't. Thrown transport/timeout
      // failures stay 'network' via the branch above.
      throw new ReportSummaryError('invalid_response', 'Summary request failed.');
    }
    return validateSummaryResponse(settled.result.data);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Ephemeral byte stash (memory only — never persisted).                */
/* ------------------------------------------------------------------ */

const reportByteStash = new Map<string, ReportBytes>();

/** Stashes picked bytes in memory so the summary can send them. */
export function stashReportBytes(eventId: string, bytes: ReportBytes): void {
  reportByteStash.set(eventId, bytes);
}

/* ------------------------------------------------------------------ */
/* Summary-state persistence on event.data.reportSummary.              */
/*                                                                     */
/* Mirrors src/sync/store.ts's payload-rewrite convention (dirty +      */
/* outbox upsert) so the summary state syncs like any other payload     */
/* change. Never throws — callers treat persistence as best-effort and  */
/* keep their in-memory state regardless. Every write notifies          */
/* `subscribeReportSummary` listeners so cards re-render without polling.*/
/* ------------------------------------------------------------------ */

type SummaryListener = (eventId: string) => void;
const summaryListeners = new Set<SummaryListener>();

/** Subscribe to summary-state writes for re-rendering. Returns unsubscribe. */
export function subscribeReportSummary(listener: SummaryListener): () => void {
  summaryListeners.add(listener);
  return () => {
    summaryListeners.delete(listener);
  };
}

function notifySummaryListeners(eventId: string): void {
  for (const l of summaryListeners) {
    try {
      l(eventId);
    } catch {
      // A listener must never break persistence.
    }
  }
}

type SummaryOutcomeListener = (eventId: string, kind: ReportFailureKind) => void;
const summaryOutcomeListeners = new Set<SummaryOutcomeListener>();

/**
 * Subscribe to summary-run outcomes that delete the entry (genuine
 * failure or off-topic verdict). The Logs screen uses this to drop the
 * interim card from its list and show the transient toast — the entry
 * is already gone by the time this fires. Returns unsubscribe.
 */
export function subscribeReportSummaryOutcome(listener: SummaryOutcomeListener): () => void {
  summaryOutcomeListeners.add(listener);
  return () => {
    summaryOutcomeListeners.delete(listener);
  };
}

function notifyOutcomeListeners(eventId: string, kind: ReportFailureKind): void {
  for (const l of summaryOutcomeListeners) {
    try {
      l(eventId, kind);
    } catch {
      // A listener must never break the flow.
    }
  }
}

/** Rewrites one event's data payload (dirty + outbox upsert). Best-effort, never throws. */
function patchEventData(eventId: string, patch: (data: Record<string, unknown>) => void): boolean {
  try {
    const db = getDb();
    const row = db.getFirstSync<{ data: string }>('SELECT data FROM events WHERE id = ?', eventId);
    if (!row) return false;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      data = {};
    }
    patch(data);
    const now = new Date().toISOString();
    const Crypto = require('expo-crypto') as { randomUUID(): string };
    db.withTransactionSync(() => {
      db.runSync(
        'UPDATE events SET data = ?, updated_at = ?, dirty = 1 WHERE id = ?',
        JSON.stringify(data),
        now,
        eventId,
      );
      db.runSync(
        `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
        Crypto.randomUUID(),
        eventId,
        now,
      );
    });
    notifySummaryListeners(eventId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persists `event.data.reportSummary` for one event. Best-effort: never
 * throws, so a failed write can't break the card's in-memory state.
 */
export function writeReportSummaryState(eventId: string, state: ReportSummaryState): void {
  patchEventData(eventId, (data) => {
    data.reportSummary = state;
  });
}

/**
 * Smart entry naming: on a successful summary the feed entry takes the
 * LLM-derived name (e.g. "Growth scan – Sep 19") instead of the raw
 * upload filename. Best-effort, never throws.
 */
export function updateReportEntryName(eventId: string, name: string): void {
  patchEventData(eventId, (data) => {
    data.text = name;
  });
}

/* ------------------------------------------------------------------ */
/* Flow wiring: store + stash + transport → the pure flow in flow.ts.   */
/* ------------------------------------------------------------------ */

function flowStoreFor(eventId: string) {
  return {
    readState: (): ReportSummaryState | null => {
      const event = getEvent(eventId);
      return event ? readReportSummaryState(event.data) : null;
    },
    writeState: (state: ReportSummaryState): void => {
      writeReportSummaryState(eventId, state);
    },
    setEntryName: (name: string): void => {
      updateReportEntryName(eventId, name);
    },
    deleteEntry: (): void => {
      hardDeleteEvent(eventId);
    },
  };
}

function takeStashedBytes(eventId: string): ReportBytes | null {
  // Peek, don't consume: a failure mid-flight still has the bytes stashed,
  // and on app restart a stuck 'summarizing' entry must not be retried —
  // the flow hard-deletes instead.
  return reportByteStash.get(eventId) ?? null;
}

/**
 * Starts the ephemeral summary flow for a report event (called right
 * after the event is saved and its bytes are stashed). Fire-and-forget:
 * the card re-renders via `subscribeReportSummary` as states land, and
 * failures delete the entry + notify `subscribeReportSummaryOutcome`
 * (the UI toasts; nothing persists).
 */
export function startReportSummary(eventId: string, deps: SummarizeReportDeps = {}): void {
  void runReportSummaryFlow({
    eventId,
    store: flowStoreFor(eventId),
    takeBytes: () => takeStashedBytes(eventId),
    clearBytes: () => {
      reportByteStash.delete(eventId);
    },
    summarize: (input) => summarizeReport(input, deps),
    onFailure: (kind) => notifyOutcomeListeners(eventId, kind),
  });
}

/**
 * Re-runs the flow after a remount when the persisted state is still
 * 'summarizing'. Same-session only in practice: with no stashed bytes
 * the entry is hard-deleted instead of hanging.
 */
export function resumeReportSummary(eventId: string, deps: SummarizeReportDeps = {}): void {
  const event = getEvent(eventId);
  const state = event ? readReportSummaryState(event.data) : null;
  if (state?.status === 'summarizing') {
    startReportSummary(eventId, deps);
  }
}

/**
 * One-time convergence for entries persisted by the old failure model:
 * a 'failed' summary state no longer has a card — not even the retired
 * 'not_configured' setup card ("Report summaries aren't set up yet."),
 * which was setup leakage in the feed (Anuraj, Sept 20, 2026). All
 * 'failed' entries are hard-deleted: no persistent failed card, ever.
 * Best-effort, never throws.
 */
export function purgeLegacyFailedReportEntries(): void {
  try {
    const db = getDb();
    const rows = db.getAllSync<{ id: string; data: string }>(
      "SELECT id, data FROM events WHERE type = 'report' AND deleted_at IS NULL",
    );
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const state = readReportSummaryState(data);
      if (state && state.status === 'failed') {
        hardDeleteEvent(row.id);
      }
    }
  } catch {
    // Best-effort: a failed purge must never break the feed.
  }
}
