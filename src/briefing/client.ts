/**
 * Edge-function caller for the morning briefing (v1.1: LLM-as-phraser).
 *
 * `phrasePlan(request)` invokes the Supabase `week-briefing` edge function
 * with the anonymized context + the engine's curated plan (only the slots
 * flagged `phrase: true`, verbatim) as the ENTIRE body — nothing else is
 * ever sent. The response is validated strictly at runtime before it is
 * trusted: the same slotIds in the same order, every string field within
 * the compact-card length caps.
 *
 * Failures surface as a typed BriefingError:
 * - 'not_configured' — no Supabase backend wired up (local-only mode).
 * - 'network'        — transport failure or the 15s timeout.
 * - 'invalid_response' — the function answered, but the shape was wrong.
 *
 * The supabase client is resolved lazily (and is injectable for tests) so
 * importing this module never touches native modules or the network.
 *
 * The phraser is polish, never a dependency: on any failure the caller
 * renders the engine's curated copy directly.
 */

import type { PlanSlot } from './types';

/** Name of the Supabase edge function that phrases the briefing. */
export const BRIEFING_FUNCTION_NAME = 'week-briefing';

/** Hard timeout for the edge-function round trip. */
export const BRIEFING_FETCH_TIMEOUT_MS = 15_000;

/* Compact-card caps (Anuraj's rule: no card becomes a wall of text). */
export const MAX_CARD_SUBTITLE_CHARS = 120;
export const MAX_BODY_LINES = 5;
export const MAX_BODY_LINE_CHARS = 220;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type BriefingErrorCode = 'not_configured' | 'network' | 'invalid_response';

/** Typed failure from phrasePlan. `code` is stable for UI/telemetry branching. */
export class BriefingError extends Error {
  readonly code: BriefingErrorCode;
  constructor(code: BriefingErrorCode, message: string) {
    super(message);
    this.name = 'BriefingError';
    this.code = code;
  }
}

declare const require: (id: string) => unknown;

function toBriefingError(e: unknown, fallback: string): BriefingError {
  if (e instanceof BriefingError) return e;
  const message = e instanceof Error ? e.message : fallback;
  return new BriefingError('network', message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/* ------------------------------------------------------------------ */
/* v1.1 LLM-as-phraser.                                                */
/*                                                                     */
/* `phrasePlan()` sends the engine's plan (only the slots flagged       */
/* `phrase: true`, with their verbatim curated text) to the            */
/* `week-briefing` edge function, which rewords them warmly and        */
/* returns the same slotIds in the same order. The app merges the      */
/* phrased text back into the plan; any failure → the caller renders   */
/* the curated copy directly (the phraser is polish, not a dependency). */
/* ------------------------------------------------------------------ */

/** One curated slot sent to the phraser. */
export interface PhraseSlotInput {
  slotId: string;
  preview: string;
  body: string[];
}

/** The whole phraser request body — anonymized context + engine plan. */
export interface PhraseRequestBody {
  week: number;
  day: number;
  firstTimeMom: boolean;
  ageBand?: string;
  symptomThemes: string[];
  planHash: string;
  freshAngles: string[];
  slots: PhraseSlotInput[];
}

/** One phrased slot returned by the function. */
export interface PhraseSlotOutput {
  slotId: string;
  preview: string;
  body: string[];
}

/** Phrased text keyed by slotId, ready to merge into the plan. */
export type PhrasedSlots = Record<string, { preview: string; body: string[] }>;

function phraseInvalid(reason: string): BriefingError {
  return new BriefingError('invalid_response', `Bad phrasing payload: ${reason}.`);
}

/**
 * Strict validation of the phraser's `{ slots, reviewDate }` response:
 * the same slotIds in the same order as the request, non-empty preview
 * and the same body-line count per slot. Length overruns are clamped —
 * the function already clamps, this is defense in depth.
 * Throws BriefingError('invalid_response').
 */
export function validatePhraseResponse(
  data: unknown,
  request: PhraseRequestBody,
): { slots: PhraseSlotOutput[]; reviewDate: string } {
  if (!isRecord(data)) throw phraseInvalid('top-level payload is not an object');
  const { slots, reviewDate } = data;
  if (typeof reviewDate !== 'string' || !ISO_DATE_RE.test(reviewDate)) {
    throw phraseInvalid('reviewDate must be YYYY-MM-DD');
  }
  if (!Array.isArray(slots) || slots.length !== request.slots.length) {
    throw phraseInvalid(`slots must be an array of exactly ${request.slots.length}`);
  }
  const out: PhraseSlotOutput[] = slots.map((raw, i) => {
    const expected = request.slots[i];
    if (!isRecord(raw)) throw phraseInvalid(`slots[${i}] is not an object`);
    if (raw.slotId !== expected.slotId) {
      throw phraseInvalid(
        `slots[${i}].slotId is ${JSON.stringify(raw.slotId)}, expected "${expected.slotId}"`,
      );
    }
    if (typeof raw.preview !== 'string' || raw.preview.length === 0) {
      throw phraseInvalid(`slots[${i}].preview is missing`);
    }
    if (
      !Array.isArray(raw.body) ||
      raw.body.length !== expected.body.length ||
      raw.body.some((l) => typeof l !== 'string' || l.length === 0)
    ) {
      throw phraseInvalid(`slots[${i}].body must have exactly ${expected.body.length} lines`);
    }
    return {
      slotId: expected.slotId,
      preview: clampLen(raw.preview, MAX_CARD_SUBTITLE_CHARS),
      body: (raw.body as string[]).map((l) => clampLen(l, MAX_BODY_LINE_CHARS)),
    };
  });
  return { slots: out, reviewDate };
}

/** Truncates to max chars, preferring a word boundary. */
function clampLen(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1).replace(/\s+\S*$/, '');
  return `${cut || s.slice(0, max - 1)}…`;
}

/** Injectable seam for unit tests (same shape as fetchBriefing's). */
export interface PhrasePlanDeps {
  configured?: boolean;
  invoke?: (body: PhraseRequestBody) => Promise<{ data: unknown; error: unknown }>;
  timeoutMs?: number;
}

/** Resolve the supabase transport (shared with fetchBriefing). */
function resolveTransport(deps: PhrasePlanDeps): {
  configured: boolean;
  invoke: (body: PhraseRequestBody) => Promise<{ data: unknown; error: unknown }>;
} {
  let configured = deps.configured;
  let invoke = deps.invoke;
  if (configured === undefined || invoke === undefined) {
    const sb = require('../lib/supabase') as {
      isConfigured: boolean;
      supabase: {
        functions: {
          invoke: (
            name: string,
            opts: { body: PhraseRequestBody },
          ) => Promise<{ data: unknown; error: unknown }>;
        };
      } | null;
    };
    if (configured === undefined) configured = sb.isConfigured;
    if (invoke === undefined) {
      const client = sb.supabase;
      invoke = async (body) => {
        const { data, error } = await client!.functions.invoke(BRIEFING_FUNCTION_NAME, { body });
        return { data, error };
      };
    }
  }
  return { configured: configured ?? false, invoke: invoke! };
}

/**
 * Phrases the engine's plan via the `week-briefing` edge function.
 * Returns the phrased text keyed by slotId plus the function's reviewDate.
 *
 * Never sends anything beyond the anonymized context + the curated plan
 * text + freshAngles. Throws BriefingError on any failure — the caller
 * falls back to the curated copy.
 */
export async function phrasePlan(
  request: PhraseRequestBody,
  deps: PhrasePlanDeps = {},
): Promise<{ phrased: PhrasedSlots; reviewDate: string }> {
  if (
    !Number.isInteger(request.week) ||
    request.week < 4 ||
    request.week > 42
  ) {
    throw phraseInvalid('request.week must be an integer in 4..42');
  }
  if (!Number.isInteger(request.day) || request.day < 1 || request.day > 7) {
    throw phraseInvalid('request.day must be an integer in 1..7');
  }
  if (!Array.isArray(request.slots) || request.slots.length === 0) {
    throw phraseInvalid('request.slots must be non-empty');
  }
  const { configured, invoke } = resolveTransport(deps);
  if (!configured) {
    throw new BriefingError(
      'not_configured',
      'Nurture is not connected to a backend yet — the phraser is unavailable in local-only mode.',
    );
  }

  const timeoutMs = deps.timeoutMs ?? BRIEFING_FETCH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = await Promise.race([
      invoke(request).then(
        (r) => ({ ok: true as const, result: r }),
        (e: unknown) => ({ ok: false as const, error: e }),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BriefingError('network', `Phrasing request timed out after ${timeoutMs}ms.`),
            ),
          timeoutMs,
        );
      }),
    ]);
    if (!settled.ok) throw toBriefingError(settled.error, 'Phrasing request failed.');
    if (settled.result.error) throw toBriefingError(settled.result.error, 'Phrasing request failed.');
    const response = validatePhraseResponse(settled.result.data, request);
    const phrased: PhrasedSlots = {};
    for (const s of response.slots) {
      phrased[s.slotId] = { preview: s.preview, body: s.body };
    }
    return { phrased, reviewDate: response.reviewDate };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Merge phrased text back into the engine plan: only `phrase: true` slots
 * with a matching phrasing are touched; everything else keeps curated copy.
 * Pure — returns a new slots array.
 */
export function mergePhrasedSlots(slots: PlanSlot[], phrased: PhrasedSlots): PlanSlot[] {
  return slots.map((s) => {
    if (!s.phrase) return s;
    const p = phrased[s.slotId];
    if (!p) return s;
    return {
      ...s,
      preview: p.preview,
      body: p.body.map((line) => [{ text: line }]),
    };
  });
}
