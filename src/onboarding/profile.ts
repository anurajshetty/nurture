/**
 * Name-and-dates gating logic (mockup 31 — Anuraj approved Sept 21, 2026).
 *
 * Pure functions behind the onboarding "A little about you" screen and the
 * You-tab profile editors. The rules, locked by Anuraj:
 *
 * - The name label is "YOUR NAME" / "Your name"; the full name is stored.
 * - Due date and last-period pickers start EMPTY — no pre-filled value, no
 *   default is ever treated as chosen. A date counts only when she picks it.
 * - The week-preview helper and the Continue/Save action enable only after
 *   a valid date is picked.
 * - Due date / last period are MANDATORY: attempting to continue/save
 *   without a valid date shows the inline error verbatim:
 *   "Pick a date to continue". It clears as soon as a date is picked.
 * - Birthday is fully optional and never errors — not even when the picker
 *   was opened and closed without picking.
 *
 * Kept pure (no React, no native modules) so the unit suite can assert the
 * exact rules. The screens own the widgets; this owns the decisions.
 */
import { naegele, validateDueDate, validateLmp, weekOf } from './dates';

/** Verbatim locked copy — do not reword (Anuraj, Sept 21 2026). */
export const REQUIRED_DATE_ERROR = 'Pick a date to continue';

export type NameDatesMode = 'due' | 'lmp';

export interface NameDatesInput {
  mode: NameDatesMode;
  /** ISO date she picked for "due date", or null when nothing picked yet. */
  dueISO: string | null;
  /** ISO date she picked for "last period", or null when nothing picked yet. */
  lmpISO: string | null;
  ownerName: string;
  /** True once she attempted the action without a valid date. */
  dateAttempted: boolean;
  asOfISO?: string;
}

export interface NameDatesView {
  /** A real, valid date is picked for the active mode. */
  dateValid: boolean;
  /** Inline error under the picker — verbatim REQUIRED_DATE_ERROR — or null. */
  dateError: string | null;
  /** Week-preview helper, shown only once a valid date is picked. */
  helper: string | null;
  /** Her name field is still blank. */
  nameMissing: boolean;
  /** Continue/Save renders muted (but stays tappable) while gating is unmet. */
  actionMuted: boolean;
  /** The action may proceed. */
  canProceed: boolean;
  /** The resolved due date for saving — null until a valid date is picked. */
  estimatedDue: string | null;
}

export function nameDatesView(input: NameDatesInput): NameDatesView {
  const { mode, dueISO, lmpISO, ownerName, dateAttempted, asOfISO } = input;
  const activeISO = mode === 'due' ? dueISO : lmpISO;
  const validation =
    mode === 'due' ? validateDueDate(activeISO, asOfISO) : validateLmp(activeISO, asOfISO);
  const dateValid = validation === null;
  const dateError = !dateValid && dateAttempted ? REQUIRED_DATE_ERROR : null;

  // Naegele for the last-period mode; the raw pick for due-date mode.
  // Never derives a date from nothing — null stays null.
  const estimatedDue = mode === 'lmp' ? (lmpISO ? naegele(lmpISO) : null) : dueISO;
  const week = estimatedDue && dateValid ? weekOf(estimatedDue, asOfISO) : null;
  const helper = week
    ? `That’s week ${week.week}, day ${week.day} — your weekly reading will match.`
    : null;

  const nameMissing = ownerName.trim().length === 0;
  const canProceed = dateValid && !nameMissing;

  return {
    dateValid,
    dateError,
    helper,
    nameMissing,
    actionMuted: !canProceed,
    canProceed,
    estimatedDue,
  };
}
