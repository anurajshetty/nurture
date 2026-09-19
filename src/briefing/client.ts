/**
 * Edge-function caller for the morning briefing (track 4: refresh logic).
 *
 * `fetchBriefing(context)` invokes the Supabase `week-briefing` edge
 * function with the anonymized BriefingContext (built by track 3's
 * buildBriefingContext) as the ENTIRE body — nothing else is ever sent.
 * The response is validated strictly at runtime before it is trusted:
 * exactly 4 cards, ids baby → body → know → tips in order, and every
 * string field within the compact-card length caps.
 *
 * Failures surface as a typed BriefingError:
 * - 'not_configured' — no Supabase backend wired up (local-only mode).
 * - 'network'        — transport failure or the 15s timeout.
 * - 'invalid_response' — the function answered, but the shape was wrong.
 *
 * The supabase client is resolved lazily (and is injectable for tests) so
 * importing this module never touches native modules or the network.
 */

import type { Briefing, BriefingCard } from './types';
import type { BriefingContext } from './context';
import { todayISO } from '../onboarding/dates';

/** Name of the Supabase edge function that generates the briefing. */
export const BRIEFING_FUNCTION_NAME = 'week-briefing';

/** Hard timeout for the edge-function round trip. */
export const BRIEFING_FETCH_TIMEOUT_MS = 15_000;

/** Card ids, in the exact order the briefing must carry them. */
export const EXPECTED_CARD_IDS = ['baby', 'body', 'know', 'tips'] as const;

/* Compact-card caps (Anuraj's rule: no card becomes a wall of text). */
export const MAX_CARD_TITLE_CHARS = 60;
export const MAX_CARD_SUBTITLE_CHARS = 120;
export const MAX_BODY_LINES = 5;
export const MAX_BODY_LINE_CHARS = 220;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type BriefingErrorCode = 'not_configured' | 'network' | 'invalid_response';

/** Typed failure from fetchBriefing. `code` is stable for UI/telemetry branching. */
export class BriefingError extends Error {
  readonly code: BriefingErrorCode;
  constructor(code: BriefingErrorCode, message: string) {
    super(message);
    this.name = 'BriefingError';
    this.code = code;
  }
}

declare const require: (id: string) => unknown;

/** Injectable seam for unit tests: stub the transport, the config flag, the timeout, and "today". */
export interface FetchBriefingDeps {
  configured?: boolean;
  invoke?: (body: BriefingContext) => Promise<{ data: unknown; error: unknown }>;
  timeoutMs?: number;
  /**
   * Device-local YYYY-MM-DD stamped as `generatedForDate`. Defaults to
   * todayISO(); injectable so tests don't depend on the wall clock.
   */
  today?: string;
}

/**
 * The edge function's actual response contract: `{ cards, reviewDate }`
 * (plus an ignored `footer` string). Week/day/generatedForDate are NOT
 * sent back — the client already knows them from the request context.
 */
export interface BriefingResponse {
  cards: BriefingCard[];
  reviewDate: string;
}

function toBriefingError(e: unknown, fallback: string): BriefingError {
  if (e instanceof BriefingError) return e;
  const message = e instanceof Error ? e.message : fallback;
  return new BriefingError('network', message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function invalid(reason: string): BriefingError {
  return new BriefingError('invalid_response', `Bad briefing payload: ${reason}.`);
}

function checkCard(card: unknown, index: number): BriefingCard {
  const expectedId = EXPECTED_CARD_IDS[index];
  if (!isRecord(card)) throw invalid(`cards[${index}] is not an object`);
  if (card.id !== expectedId) {
    throw invalid(`cards[${index}].id is ${JSON.stringify(card.id)}, expected "${expectedId}"`);
  }
  if (typeof card.title !== 'string' || card.title.length === 0) {
    throw invalid(`cards[${index}].title is missing`);
  }
  if (card.title.length > MAX_CARD_TITLE_CHARS) {
    throw invalid(`cards[${index}].title exceeds ${MAX_CARD_TITLE_CHARS} chars`);
  }
  if (typeof card.subtitle !== 'string') {
    throw invalid(`cards[${index}].subtitle is not a string`);
  }
  if (card.subtitle.length > MAX_CARD_SUBTITLE_CHARS) {
    throw invalid(`cards[${index}].subtitle exceeds ${MAX_CARD_SUBTITLE_CHARS} chars`);
  }
  if (!Array.isArray(card.body) || card.body.length === 0 || card.body.length > MAX_BODY_LINES) {
    throw invalid(`cards[${index}].body must have 1–${MAX_BODY_LINES} lines`);
  }
  const body: string[] = card.body.map((line, li) => {
    if (typeof line !== 'string' || line.length === 0) {
      throw invalid(`cards[${index}].body[${li}] is not a non-empty string`);
    }
    if (line.length > MAX_BODY_LINE_CHARS) {
      throw invalid(`cards[${index}].body[${li}] exceeds ${MAX_BODY_LINE_CHARS} chars`);
    }
    return line;
  });
  return { id: expectedId, title: card.title, subtitle: card.subtitle, body };
}

/**
 * Strict runtime validation of the edge function's response contract
 * (`{ cards, reviewDate }`; extra keys such as `footer` are ignored).
 * Throws BriefingError('invalid_response').
 */
export function validateBriefingResponse(data: unknown): BriefingResponse {
  if (!isRecord(data)) throw invalid('top-level payload is not an object');
  const { cards, reviewDate } = data;
  if (typeof reviewDate !== 'string' || !ISO_DATE_RE.test(reviewDate)) {
    throw invalid('reviewDate must be YYYY-MM-DD');
  }
  if (!Array.isArray(cards) || cards.length !== EXPECTED_CARD_IDS.length) {
    throw invalid(`cards must be an array of exactly ${EXPECTED_CARD_IDS.length}`);
  }
  return {
    cards: cards.map(checkCard),
    reviewDate,
  };
}

function checkContext(context: BriefingContext): void {
  if (!Number.isInteger(context.week) || context.week < 4 || context.week > 42) {
    throw invalid('context.week must be an integer in 4..42');
  }
  if (!Number.isInteger(context.day) || context.day < 1 || context.day > 7) {
    throw invalid('context.day must be an integer in 1..7');
  }
}

/**
 * Calls the `week-briefing` edge function with `context` as the whole body.
 * Never sends anything beyond the BriefingContext fields.
 *
 * The function answers `{ cards, reviewDate }` — week/day/generatedForDate
 * are filled in on-device from the request context and the device-local
 * date, so a live response is never rejected as invalid.
 */
export async function fetchBriefing(
  context: BriefingContext,
  deps: FetchBriefingDeps = {},
): Promise<Briefing> {
  checkContext(context);
  let configured = deps.configured;
  let invoke = deps.invoke;
  if (configured === undefined || invoke === undefined) {
    // Lazy: keeps this module importable in test runners and in
    // local-only mode without touching SecureStore / the network.
    const sb = require('../lib/supabase') as {
      isConfigured: boolean;
      supabase: {
        functions: {
          invoke: (
            name: string,
            opts: { body: BriefingContext },
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
  if (!configured) {
    throw new BriefingError(
      'not_configured',
      'Nurture is not connected to a backend yet — the briefing is unavailable in local-only mode.',
    );
  }

  const timeoutMs = deps.timeoutMs ?? BRIEFING_FETCH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = await Promise.race([
      invoke!(context).then(
        (r) => ({ ok: true as const, result: r }),
        (e: unknown) => ({ ok: false as const, error: e }),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BriefingError('network', `Briefing request timed out after ${timeoutMs}ms.`),
            ),
          timeoutMs,
        );
      }),
    ]);
    if (!settled.ok) throw toBriefingError(settled.error, 'Briefing request failed.');
    if (settled.result.error) throw toBriefingError(settled.result.error, 'Briefing request failed.');
    const response = validateBriefingResponse(settled.result.data);
    const generatedForDate = deps.today ?? todayISO();
    if (!ISO_DATE_RE.test(generatedForDate)) {
      throw invalid('generatedForDate must be YYYY-MM-DD');
    }
    return {
      week: context.week,
      day: context.day,
      generatedForDate,
      cards: response.cards,
      reviewDate: response.reviewDate,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
