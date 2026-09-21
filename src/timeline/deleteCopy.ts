/**
 * Deletable feed cards (Willow, mockup 30 — Anuraj approved Sept 20, 2026).
 *
 * Every feed-backed card carries a small muted × (44×44, top-right). Tapping
 * it opens ONE shared centered confirmation dialog (the mockup-18 pattern);
 * only the named item and the consequence line change per card type:
 *
 * - appointment  → reminder is cancelled too
 * - report       → only the summary card goes away; source entries stay
 * - kick_session → removed from the story
 * - activity     → labor activity cards (mockup 32 rev 2); Anuraj's
 *                  Sept 21 call: use "log" for everything here
 * - log          → everything else: removed everywhere it appears
 *
 * Pure logic: no database, no expo, no react-native imports, so it is
 * unit-testable in plain node. The exact copy below is the approved
 * mockup-30 copy table — keep it verbatim.
 */

import type { LocalEvent } from '../lib/types';

/** Which confirmation copy a feed card gets. */
export type DeleteKind =
  | 'appointment'
  | 'report'
  | 'kick_session'
  | 'log'
  // Labor activities (mockup 32 rev 2 — Anuraj approved Sept 21, 2026):
  // one unified "Activity" card; delete copy uses "log" for everything
  // (his Sept 21 ~08:07 PDT call).
  | 'activity';

/**
 * A health-document upload: ReportSheet always saves type 'report'. Bare
 * 'file' events and events carrying `data.category = 'report'` are older
 * uploads from before the fixed typing — they get the report copy too.
 */
export function deleteKindFor(event: LocalEvent): DeleteKind {
  if (event.type === 'appointment') return 'appointment';
  if (event.type === 'kick_session') return 'kick_session';
  if (event.type === 'activity') return 'activity';
  if (event.type === 'report' || event.type === 'file' || event.data?.category === 'report') {
    return 'report';
  }
  return 'log';
}

/** All confirmation copy for one delete kind (mockup 30, verbatim). */
export interface DeleteCopy {
  /** × accessibility label, e.g. "Delete kick session". */
  xLabel: string;
  /** Dialog title, e.g. "Delete this summary?". */
  title: string;
  /** Dialog body naming the consequence. */
  body: string;
  /** Confirm-button label, e.g. "Delete entry". */
  confirmLabel: string;
  /** Toast after deletion, e.g. "Entry deleted". */
  toast: string;
}

export const DELETE_COPY: Record<DeleteKind, DeleteCopy> = {
  appointment: {
    xLabel: 'Delete appointment',
    title: 'Delete this appointment?',
    body: 'It leaves your story and your Week, and its reminder is cancelled too. This can\u2019t be undone.',
    confirmLabel: 'Delete appointment',
    toast: 'Appointment deleted',
  },
  report: {
    xLabel: 'Delete report summary',
    title: 'Delete this summary?',
    body: 'Only the summary card goes away \u2014 your entries stay in your story. This can\u2019t be undone.',
    confirmLabel: 'Delete summary',
    toast: 'Summary deleted',
  },
  kick_session: {
    xLabel: 'Delete kick session',
    title: 'Delete this kick session?',
    body: 'It leaves your story. This can\u2019t be undone.',
    confirmLabel: 'Delete session',
    toast: 'Kick session deleted',
  },
  // Labor activities (mockup 32 rev 2 — Anuraj approved Sept 21, 2026).
  // Verbatim "log for everything" copy (his Sept 21 ~08:07 PDT call).
  activity: {
    xLabel: 'Delete log',
    title: 'Delete this log?',
    body: 'This log leaves your story. This can\u2019t be undone.',
    confirmLabel: 'Delete log',
    toast: 'Log deleted',
  },
  log: {
    xLabel: 'Delete log entry',
    title: 'Delete this entry?',
    body: 'It leaves your story everywhere it appears. This can\u2019t be undone.',
    confirmLabel: 'Delete entry',
    toast: 'Entry deleted',
  },
};

/** The exact confirmation copy for a feed event. */
export function deleteCopyFor(event: LocalEvent): DeleteCopy {
  return DELETE_COPY[deleteKindFor(event)];
}
