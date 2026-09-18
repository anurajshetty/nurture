/**
 * Pure end-of-day nudge decision logic (Epic 2.2). Zero dependencies so
 * the rules are unit-testable without notifications or the database.
 *
 * The product rules, restated: the nudge fires ONLY when she logged
 * nothing that calendar day. No streaks, no guilt, no shame language.
 * Default 8:30 PM, quiet hours respected, global pause honored.
 */

export interface NudgeInput {
  /** prefs.endOfDayEnabled */
  enabled: boolean;
  /** true when a global pause is currently in effect */
  paused: boolean;
  /** true when at least one event was logged today */
  hasEntryToday: boolean;
  /** prefs.endOfDayTime, "HH:MM" */
  time: string;
  /** prefs.quietHoursStart / prefs.quietHoursEnd, "HH:MM" */
  quietStart: string;
  quietEnd: string;
  /** OS notification permission */
  permissionGranted: boolean;
}

export interface NudgePlan {
  hour: number;
  minute: number;
}

export function parseHM(hm: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/** True when `t` falls inside the quiet-hours window (handles overnight wrap). */
export function inQuietHours(
  t: { h: number; m: number },
  startHM: string,
  endHM: string,
): boolean {
  const start = parseHM(startHM);
  const end = parseHM(endHM);
  if (!start || !end) return false;
  const mins = t.h * 60 + t.m;
  const s = start.h * 60 + start.m;
  const e = end.h * 60 + end.m;
  if (s <= e) return mins >= s && mins < e;
  return mins >= s || mins < e;
}

/**
 * Returns the daily trigger time when a nudge should be scheduled, or
 * null when it must not be (disabled, paused, already logged today,
 * bad time, inside quiet hours, or no permission).
 */
export function decideNudge(input: NudgeInput): NudgePlan | null {
  if (!input.enabled) return null;
  if (input.paused) return null;
  if (input.hasEntryToday) return null;
  const at = parseHM(input.time);
  if (!at) return null;
  if (inQuietHours(at, input.quietStart, input.quietEnd)) return null;
  if (!input.permissionGranted) return null;
  return { hour: at.h, minute: at.m };
}
