/**
 * Per-entry visibility (Epic 7, §7.1).
 *
 * Three states — Private / Shared / +Export — using the existing
 * `Visibility` type (`src/lib/types.ts`; the `events.visibility` column
 * already exists). Every entry is changeable any time from the entry
 * itself; health logs always default to private.
 *
 * - 'private': only she sees it. Never reaches the partner.
 * - 'shared': the partner can see it once connected.
 * - 'export': shared AND pre-selected when she builds a visit summary
 *   (Epic 8 reads this; it does not change these semantics — C4).
 */

import type { EventType, Visibility } from '../lib/types';
import { PARTNER_PLACEHOLDER_NAME } from './model';

declare const require: (id: string) => unknown;

/**
 * Health logs stay private by default — the partner never sees them
 * unless she changes the entry herself.
 */
const HEALTH_LOG_TYPES: ReadonlySet<string> = new Set([
  'symptom',
  'mood',
  'weight',
  'kick_session',
]);

/**
 * Keepsake moments default to shared once a partner is connected — the
 * journey she chose to share. Everything else (notes, appointments,
 * questions, files, and all health logs) defaults to private.
 */
const SHARED_BY_DEFAULT_TYPES: ReadonlySet<string> = new Set(['milestone', 'photo']);

/** Default visibility for a new entry of the given type. */
export function defaultVisibilityForType(type: EventType): Visibility {
  if (SHARED_BY_DEFAULT_TYPES.has(type)) return 'shared';
  // Health logs and everything unlisted default to private.
  return 'private';
}

/** True for the types that must never default to shared. */
export function isHealthLogType(type: EventType): boolean {
  return HEALTH_LOG_TYPES.has(type);
}

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: '🔒 Private',
  shared: '👥 Shared',
  export: '📄 + Export',
};

export const VISIBILITY_OPTIONS: readonly Visibility[] = ['private', 'shared', 'export'];

/**
 * The plain-language note shown under the visibility control (mockup
 * wording): exactly what each state means for her partner.
 */
export function visibilityNote(
  visibility: Visibility,
  partnerName: string = PARTNER_PLACEHOLDER_NAME,
): string {
  switch (visibility) {
    case 'shared':
      return `Shared — ${partnerName} can see this, but it stays out of visit summaries unless you add it there.`;
    case 'export':
      return `Shared + export — ${partnerName} can see this, and it\u2019s included when you build a visit summary.`;
    case 'private':
    default:
      return `Private — only you. ${partnerName} can\u2019t see this, and it stays out of exports.`;
  }
}

/** Minimal db surface needed to rewrite one entry's visibility. */
export interface VisibilityDb {
  runSync(sql: string, ...params: unknown[]): void;
}

function defaultDb(): VisibilityDb {
  const db = require('../lib/db') as { getDb(): VisibilityDb };
  return db.getDb();
}

/**
 * Changes an existing entry's visibility ("editable later" — §7.1).
 * Marks the row dirty so the next sync carries the change. Lets the
 * error propagate so the UI can say so plainly.
 */
export function setEntryVisibility(
  eventId: string,
  visibility: Visibility,
  db: VisibilityDb = defaultDb(),
): void {
  const now = new Date().toISOString();
  db.runSync(
    'UPDATE events SET visibility = ?, updated_at = ?, dirty = 1 WHERE id = ?',
    visibility,
    now,
    eventId,
  );
}
