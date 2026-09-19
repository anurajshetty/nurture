/**
 * Visit questions for appointments (Epic 6, Plan deep-link target).
 *
 * STORAGE DECISION (contract C1): questions live on the appointment event's
 * `data.questions` array — `[{ id, text, state }]`, where `state` is a
 * `QuestionState` ('to_ask' | 'asked' | 'answered' | 'deferred' | 'dismissed').
 *
 * Why the event's `data` blob instead of a new table:
 * - A question is inseparable from its visit: it is created, read, and
 *   decided in the appointment detail, and it travels with the event
 *   through the existing sync outbox — no migration, no new sync path.
 * - `data` is already a versioned JSON blob mirrored to the server;
 *   `questions` is one more key, exactly like `attachments` (Epic 2.3
 *   precedent: `setEventAttachments` rewrites `data.attachments` the same way).
 * - Visibility stays with the appointment event (contract C4: Epic 8 reads
 *   `event.visibility` to preselect export entries — questions inherit it).
 * - Epic 6 owns `data.questions`; no other epic writes it (contract C1).
 *
 * Module shape follows src/briefing/context.ts: module scope is
 * dependency-free (only erased type imports) so the pure core —
 * `readQuestionsFromData`, `nextQuestionState`, `replaceQuestionState`,
 * `appendQuestion` — is unit-testable under node. The one impure writer,
 * `saveQuestions`, lazy-requires the database. Never throws outward.
 */

import type { LocalEvent, QuestionState } from '../lib/types';

export type { QuestionState };

/* ------------------------------------------------------------------ */
/* Lazy native boundary                                               */
/* ------------------------------------------------------------------ */

type AnyModule = Record<string, any>;

declare const require: (id: string) => unknown;

function lazyDb(): AnyModule {
  return require('../lib/db') as AnyModule;
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/** One question for the visit, as stored in `data.questions`. */
export interface AppointmentQuestion {
  id: string;
  text: string;
  state: QuestionState;
}

export const QUESTION_STATES: readonly QuestionState[] = [
  'to_ask',
  'asked',
  'answered',
  'deferred',
  'dismissed',
];

/** Chip labels, matching approved mockup 11 (device ③). */
export const QUESTION_STATE_LABELS: Record<QuestionState, string> = {
  to_ask: 'To ask',
  asked: 'Asked ✓',
  answered: 'Answered',
  deferred: 'Deferred',
  dismissed: 'Dismissed',
};

/**
 * Tap-cycle order for the question chip (mockup 11):
 * To ask → Asked ✓ → Answered → Deferred → Dismissed → To ask …
 */
const QUESTION_CYCLE: readonly QuestionState[] = [
  'to_ask',
  'asked',
  'answered',
  'deferred',
  'dismissed',
];

/** Next state when she taps a question chip. Pure. */
export function nextQuestionState(state: QuestionState): QuestionState {
  const i = QUESTION_CYCLE.indexOf(state);
  return QUESTION_CYCLE[(i + 1) % QUESTION_CYCLE.length];
}

function isQuestionState(value: unknown): value is QuestionState {
  return (
    typeof value === 'string' &&
    (QUESTION_STATES as readonly string[]).includes(value)
  );
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/* ------------------------------------------------------------------ */
/* Pure core (unit-tested)                                             */
/* ------------------------------------------------------------------ */

/**
 * Reads the question list from a raw `data` payload. Tolerates anything:
 * missing key, non-array, or malformed entries are skipped, never thrown on.
 */
export function readQuestionsFromData(data: Record<string, unknown> | undefined): AppointmentQuestion[] {
  if (!data || !Array.isArray(data.questions)) return [];
  const out: AppointmentQuestion[] = [];
  for (const raw of data.questions) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { id, text, state } = raw as Record<string, unknown>;
    const cleanId = typeof id === 'string' && id.length > 0 ? id : null;
    const cleanQ = cleanText(text);
    if (!cleanId || !cleanQ || !isQuestionState(state)) continue;
    out.push({ id: cleanId, text: cleanQ, state });
  }
  return out;
}

/** Reads the question list off an event. Pure. */
export function readQuestions(event: LocalEvent): AppointmentQuestion[] {
  return readQuestionsFromData(event.data);
}

/**
 * Returns a new question list with one question's state replaced.
 * Unknown ids return the list unchanged. Pure.
 */
export function replaceQuestionState(
  questions: readonly AppointmentQuestion[],
  questionId: string,
  state: QuestionState,
): AppointmentQuestion[] {
  return questions.map((q) => (q.id === questionId ? { ...q, state } : q));
}

/**
 * Returns a new question list with `text` appended as a fresh 'to_ask'
 * question. Blank text returns the list unchanged. The id is generated
 * here so the pure function stays deterministic-friendly (callers may
 * pass `id` explicitly in tests). Pure.
 */
export function appendQuestion(
  questions: readonly AppointmentQuestion[],
  text: string,
  id?: string,
): AppointmentQuestion[] {
  const clean = cleanText(text);
  if (!clean) return [...questions];
  const newId =
    id ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return [...questions, { id: newId, text: clean, state: 'to_ask' as QuestionState }];
}

/* ------------------------------------------------------------------ */
/* Impure writer (device only)                                         */
/* ------------------------------------------------------------------ */

/**
 * Persists a rewritten question list for one appointment event: replaces
 * `data.questions`, marks the row dirty, and queues an upsert so the next
 * text sync carries the change to the server (same pattern as
 * `setEventAttachments`). No-op when the event doesn't exist. Never throws.
 */
export function saveQuestions(eventId: string, questions: readonly AppointmentQuestion[]): boolean {
  try {
    const db = lazyDb();
    const row = db.getDb().getFirstSync('SELECT data FROM events WHERE id = ?', eventId) as {
      data: string;
    } | null;
    if (!row) return false;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      data = {};
    }
    data.questions = questions.map((q) => ({ id: q.id, text: q.text, state: q.state }));
    const now = new Date().toISOString();
    db.getDb().withTransactionSync(() => {
      db.getDb().runSync('UPDATE events SET data = ?, updated_at = ?, dirty = 1 WHERE id = ?', JSON.stringify(data), now, eventId);
      db.getDb().runSync(
        `INSERT INTO outbox (id, event_id, op, attempts, created_at) VALUES (?, ?, 'upsert', 0, ?)`,
        `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`,
        eventId,
        now,
      );
    });
    return true;
  } catch {
    return false;
  }
}
