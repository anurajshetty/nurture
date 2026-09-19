/**
 * Epic 9 copy — every string the changed-outcome experience shows.
 *
 * Kept in one dependency-free module so the content guard unit test
 * (tests/epic9.test.ts) can scan it: when stopped, Home must hold zero
 * developmental content — no week numbers, no size comparisons, no tips,
 * no celebratory copy about the pregnancy.
 *
 * Tone: plain, direct, compassionate. Never asks why. Never requests
 * clinical details. Never described as clinician-reviewed.
 */

/** "It's done." — the plain list of everything that stopped. */
export const STOPPED_LIST_COPY: string[] = [
  'Weekly development updates — off',
  'Reminders and the end-of-day nudge — off',
  'Pregnancy notifications to your partner — off',
  'Celebratory messages — off, for good',
];

export const ITS_DONE_TITLE = "It's done.";
export const ITS_DONE_LEDE =
  'We’ve stopped all pregnancy updates, reminders, and partner notifications. Nothing else will change unless you ask.';

export const STORY_KICK = 'Your story is still yours';
export const STORY_LEDE =
  'Your timeline stays exactly as it is — private, and only yours. Choose what happens to it now, or decide later.';

export const DECIDE_LATER_LABEL = "I'll decide later";
export const DECIDE_LATER_TOAST = 'Whenever you’re ready — everything stays private.';

/** Afterwards Home (contract C3) — her memories and gentle support. */
export const AFTERWARDS_TITLE = 'Your story';
export const AFTERWARDS_LEDE_WITH_MEMORIES = 'Your memories, exactly as you left them.';
export const AFTERWARDS_LEDE_EMPTY = 'There’s nothing saved here — and that’s okay.';
export const AFTERWARDS_TIMELINE_SUB = 'Notes, photos, milestones — all yours';
export const AFTERWARDS_KICK = 'For the days ahead';
export const AFTERWARDS_QUIET_NOTE =
  'Pregnancy updates are off — the weekly briefing, reminders, and celebratory messages won’t return unless you ask.';
export const AFTERWARDS_SETTINGS_TITLE = 'App settings';
export const AFTERWARDS_SETTINGS_SUB = 'Notifications, privacy, your data';

/** The gentle delete guard — unhurried, with an explicit way back. */
export const DELETE_GUARD_TITLE = 'Delete everything?';
export const DELETE_GUARD_LEDE =
  'This permanently removes your timeline, photos, and files from the app and your account. There’s no undo — take all the time you need.';
export const DELETE_GUARD_KEEP = 'Keep my story';
export const DELETE_GUARD_CONFIRM = 'Yes, delete everything';
export const DELETE_GUARD_FINE = 'You can also export first, then delete.';
export const DELETE_GUARD_KEPT_TOAST = 'Your story stays.';
export const DELETE_GUARD_DELETED_TOAST = 'Your story has been deleted.';

/** Every user-visible string in the afterwards experience, for the guard test. */
export const ALL_AFTERWARDS_COPY: string[] = [
  ITS_DONE_TITLE,
  ITS_DONE_LEDE,
  STORY_KICK,
  STORY_LEDE,
  DECIDE_LATER_LABEL,
  AFTERWARDS_TITLE,
  AFTERWARDS_LEDE_WITH_MEMORIES,
  AFTERWARDS_LEDE_EMPTY,
  AFTERWARDS_TIMELINE_SUB,
  AFTERWARDS_KICK,
  AFTERWARDS_QUIET_NOTE,
  AFTERWARDS_SETTINGS_TITLE,
  AFTERWARDS_SETTINGS_SUB,
  DELETE_GUARD_TITLE,
  DELETE_GUARD_LEDE,
  DELETE_GUARD_KEEP,
  DELETE_GUARD_CONFIRM,
  DELETE_GUARD_FINE,
  ...STOPPED_LIST_COPY,
];
