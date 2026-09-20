/**
 * Ephemeral report-summary flow (Willow, Anuraj Sept 2026).
 *
 * Report bytes are NEVER persisted: no local DB blob, no Supabase Storage
 * upload, no media-outbox row. The picked file is read into memory, sent
 * inline (`{ dataBase64, mimeType }`) to the `report-summary` edge function
 * for the Gemini summary, and then dropped.
 *
 * This module is deliberately pure and dependency-free (no expo-sqlite,
 * no React Native imports) so it unit-tests under node. `client.ts` wires
 * it to the real store/transport; the tests drive it with doubles.
 *
 * Flow states on `event.data.reportSummary`:
 * - 'summarizing' — interim entry in the feed ("Summarizing your report…")
 * - 'ready'       — summary card (title, body, fixed disclaimer)
 * - 'failed'      — error card with Try again
 *
 * Legacy note: the pre-ephemeral flow persisted 'reading'. Readers map it
 * to 'summarizing'; with no stashed bytes left it degrades to 'failed',
 * which is the honest state for a summary that can never complete.
 */

/**
 * Fixed disclaimer rendered under every summary. Locked copy (Anuraj,
 * Sept 19, 2026): "This isn't medical advice." — inside the card, always
 * visible. The model never writes it. Used as the app-side fallback when
 * the function is unreachable.
 */
export const REPORT_SUMMARY_DISCLAIMER = "This isn't medical advice.";

/** The entire invoke body — file bytes inline, nothing else. */
export interface ReportSummaryInput {
  /** Base64 of the (possibly downscaled) document bytes. */
  dataBase64: string;
  /** MIME of the document, e.g. 'application/pdf' or 'image/jpeg'. */
  mimeType: string;
}

/** The validated summary returned by the function. */
export interface ReportSummaryResult {
  title: string;
  summary: string;
  attachmentName: string;
  needsAttention: boolean;
  disclaimer: string;
}

/** The lifecycle state persisted on `event.data.reportSummary`. */
export type ReportSummaryState =
  | { status: 'summarizing' }
  | {
      status: 'ready';
      title: string;
      summary: string;
      attachmentName: string;
      needsAttention: boolean;
      disclaimer: string;
    }
  | { status: 'failed' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Reads `event.data.reportSummary`, returning null when absent or
 * malformed. The legacy 'reading' status (pre-ephemeral flow) maps to
 * 'summarizing' — those entries have no stashed bytes left, so the flow
 * below degrades them to 'failed' rather than hanging forever.
 */
export function readReportSummaryState(data: Record<string, unknown>): ReportSummaryState | null {
  const raw = data.reportSummary;
  if (!isRecord(raw)) return null;
  if (raw.status === 'summarizing' || raw.status === 'reading') return { status: 'summarizing' };
  if (raw.status === 'failed') return { status: 'failed' };
  if (raw.status === 'ready') {
    if (
      typeof raw.title !== 'string' ||
      typeof raw.summary !== 'string' ||
      typeof raw.attachmentName !== 'string' ||
      typeof raw.needsAttention !== 'boolean'
    ) {
      return null;
    }
    return {
      status: 'ready',
      title: raw.title,
      summary: raw.summary,
      attachmentName: raw.attachmentName,
      needsAttention: raw.needsAttention,
      disclaimer:
        typeof raw.disclaimer === 'string' && raw.disclaimer.length > 0
          ? raw.disclaimer
          : REPORT_SUMMARY_DISCLAIMER,
    };
  }
  return null;
}

/**
 * Base64-encodes bytes without btoa/Buffer, so it runs on Hermes, web,
 * node, and Deno alike. Flushed in whole base64 groups (8192 groups per
 * chunk — group-aligned, so chunk boundaries can never split a triplet)
 * so a 10MB document never builds millions of single-char array elements
 * or one pathological concatenation.
 */
export function base64EncodeBytes(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const GROUPS_PER_CHUNK = 8192;
  const out: string[] = [];
  const parts: string[] = [];
  let groups = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    parts.push(
      alphabet[b0 >> 2] +
        alphabet[((b0 & 3) << 4) | (b1 >> 4)] +
        (i + 1 < bytes.length ? alphabet[((b1 & 15) << 2) | (b2 >> 6)] : '=') +
        (i + 2 < bytes.length ? alphabet[b2 & 63] : '='),
    );
    if (++groups === GROUPS_PER_CHUNK) {
      out.push(parts.join(''));
      parts.length = 0;
      groups = 0;
    }
  }
  if (parts.length > 0) out.push(parts.join(''));
  return out.join('');
}

/* ------------------------------------------------------------------ */
/* The flow.                                                           */
/* ------------------------------------------------------------------ */

/** Ephemeral in-memory bytes for one report (never persisted). */
export interface ReportBytes {
  dataBase64: string;
  mimeType: string;
}

/** The seams the flow needs; `client.ts` provides the real ones. */
export interface ReportFlowStore {
  readState(): ReportSummaryState | null;
  writeState(state: ReportSummaryState): void;
  /** Smart entry naming: the feed entry takes the LLM-derived name. */
  setEntryName?(name: string): void;
}

export interface ReportFlowDeps {
  eventId: string;
  store: ReportFlowStore;
  /** Returns the stashed bytes, or null when they're gone (stale entry). */
  takeBytes(): ReportBytes | null;
  /** Drops the stashed bytes after a successful summary (memory hygiene). */
  clearBytes(): void;
  summarize(input: ReportSummaryInput): Promise<ReportSummaryResult>;
  /**
   * Retry path: re-runs even from 'failed'. The normal path never
   * auto-retries a failure (the user taps Try again) and never re-runs a
   * completed summary.
   */
  force?: boolean;
}

/** Event ids with a summary request currently in flight (survives remounts). */
const inflightSummaries = new Set<string>();

/** True while a summary request for the event is in flight. */
export function isReportSummaryInflight(eventId: string): boolean {
  return inflightSummaries.has(eventId);
}

/**
 * Runs the ephemeral summary flow for one report event:
 *
 * 1. Writes 'summarizing' (the interim feed entry).
 * 2. Sends the stashed bytes inline to the edge function.
 * 3. On success writes 'ready' (+ smart entry name) and drops the bytes.
 * 4. On any failure writes 'failed' — the card offers Try again.
 *
 * When the bytes are gone (e.g. the app restarted mid-summary) the entry
 * is marked 'failed' immediately instead of hanging on "Summarizing…"
 * forever — the honest state, since the summary can never complete.
 *
 * Nothing here persists bytes: `takeBytes`/`clearBytes` are the only
 * byte touchpoints, and both are memory-only by contract.
 */
export async function runReportSummaryFlow(
  deps: ReportFlowDeps,
): Promise<'ready' | 'failed' | 'skipped'> {
  const { eventId, store, force } = deps;
  if (inflightSummaries.has(eventId)) return 'skipped';
  const current = store.readState();
  if (current?.status === 'ready') return 'skipped';
  if (current?.status === 'failed' && !force) return 'skipped';

  const bytes = deps.takeBytes();
  if (!bytes) {
    store.writeState({ status: 'failed' });
    return 'failed';
  }

  inflightSummaries.add(eventId);
  store.writeState({ status: 'summarizing' });
  try {
    const result = await deps.summarize({ dataBase64: bytes.dataBase64, mimeType: bytes.mimeType });
    deps.clearBytes();
    store.writeState({
      status: 'ready',
      title: result.title,
      summary: result.summary,
      attachmentName: result.attachmentName,
      needsAttention: result.needsAttention,
      disclaimer: result.disclaimer,
    });
    store.setEntryName?.(result.attachmentName);
    return 'ready';
  } catch {
    store.writeState({ status: 'failed' });
    return 'failed';
  } finally {
    inflightSummaries.delete(eventId);
  }
}
