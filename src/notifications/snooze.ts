/**
 * Snooze / pause / dismiss for Nurture reminders (Epic 6).
 *
 * From an appointment reminder she can, without opening the app:
 * - "Snooze" (one tap) → the reminder returns in 10 minutes;
 * - long-press ··· → "Snooze 1 hour", "Pause all until I return", "Dismiss".
 *
 * Semantics:
 * - Snooze cancels the pending reminder for that appointment and schedules
 *   a fresh one `minutes` out with the same neutral copy. It is a single
 *   re-fire, not a repeating schedule: after it fires, the appointment's
 *   original slot is gone (the visit is presumably underway).
 * - "Pause all until I return" sets `Prefs.globalPauseUntil` to now and
 *   cancels every pending appointment reminder. This matches the You tab's
 *   existing pause convention (any non-null value = paused; she resumes
 *   from You → Notifications, "see mockup 06 to resume"). The end-of-day
 *   nudge re-evaluates on its own refresh triggers and honors the same flag.
 * - "Dismiss" cancels the pending reminder for that appointment. Nothing
 *   is deleted; the appointment stays on her timeline.
 *
 * Module shape follows src/briefing/context.ts: module scope is
 * dependency-free so the pure core (`snoozeFireAtMs`,
 * `describeReminderResponse`) is unit-testable under node; native access
 * is lazy-required inside the impure functions. Impure paths are no-ops on
 * web. Never throws outward: a failed snooze degrades to the reminder
 * simply not re-firing.
 */

import type { LocalEvent } from '../lib/types';
import { appointmentReminderCopy } from './reminderCopy';
import {
  cancelAppointmentReminders,
  ensureReminderHandler,
  installAppointmentCategories,
  refreshAppointmentReminders,
} from './appointments';

/* ------------------------------------------------------------------ */
/* Lazy native boundary                                               */
/* ------------------------------------------------------------------ */

type AnyModule = Record<string, any>;

declare const require: (id: string) => unknown;

function lazyNotifications(): AnyModule {
  return require('expo-notifications') as AnyModule;
}

function lazyDb(): AnyModule {
  return require('../lib/db') as AnyModule;
}

function lazyPrefs(): AnyModule {
  return require('./prefs') as AnyModule;
}

function lazyStore(): AnyModule {
  return require('../sync/store') as AnyModule;
}

function isWeb(): boolean {
  try {
    const rn = require('react-native') as { Platform?: { OS?: string } };
    return rn.Platform?.OS !== 'android' && rn.Platform?.OS !== 'ios';
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Action identifiers (must avoid ':' and '-' per expo-notifications)   */
/* ------------------------------------------------------------------ */

export const SNOOZE_10_ACTION = 'snooze_10';
export const SNOOZE_60_ACTION = 'snooze_60';
export const PAUSE_ALL_ACTION = 'pause_all';
export const DISMISS_ACTION = 'dismiss';

/** One-tap snooze length, minutes (mockup 11: "Snooze" = +10 min). */
export const SNOOZE_MINUTES = 10;
/** Long-press sheet snooze length, minutes. */
export const SNOOZE_LONG_MINUTES = 60;

/* ------------------------------------------------------------------ */
/* Pure core (unit-tested)                                             */
/* ------------------------------------------------------------------ */

/** When a snooze of `minutes` requested at `nowMs` should re-fire. Pure. */
export function snoozeFireAtMs(nowMs: number, minutes: number): number {
  return nowMs + Math.max(0, minutes) * 60_000;
}

export type ReminderAction =
  | { kind: 'view'; appointmentId: string }
  | { kind: 'snooze'; appointmentId: string; minutes: number }
  | { kind: 'pause' }
  | { kind: 'dismiss'; appointmentId: string }
  | { kind: 'ignore' };

/**
 * Maps a notification response (action button id + notification data) to
 * the action it means. The default action id (body tap, "View") deep-links
 * to the appointment when the notification is one of ours. Pure.
 */
export function describeReminderResponse(
  actionId: string | undefined,
  data: Record<string, unknown> | undefined,
): ReminderAction {
  const appointmentId =
    typeof data?.appointmentId === 'string' ? (data.appointmentId as string) : '';
  const isOurs = data?.kind === 'appointment' && appointmentId.length > 0;
  switch (actionId) {
    case SNOOZE_10_ACTION:
      return isOurs ? { kind: 'snooze', appointmentId, minutes: SNOOZE_MINUTES } : { kind: 'ignore' };
    case SNOOZE_60_ACTION:
      return isOurs ? { kind: 'snooze', appointmentId, minutes: SNOOZE_LONG_MINUTES } : { kind: 'ignore' };
    case PAUSE_ALL_ACTION:
      return { kind: 'pause' };
    case DISMISS_ACTION:
      return isOurs ? { kind: 'dismiss', appointmentId } : { kind: 'ignore' };
    default:
      // Body tap / default action → deep-link to the appointment detail.
      return isOurs ? { kind: 'view', appointmentId } : { kind: 'ignore' };
  }
}

/* ------------------------------------------------------------------ */
/* Impure actions (device only)                                        */
/* ------------------------------------------------------------------ */

const APPT_IDS_KEY = 'notif.appointmentReminderIds';

function removeTrackedId(eventId: string): void {
  try {
    const raw = lazyDb().kvGet(APPT_IDS_KEY) as string | null;
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, string>;
    if (map[eventId]) {
      delete map[eventId];
      lazyDb().kvSet(APPT_IDS_KEY, JSON.stringify(map));
    }
  } catch {
    // Best-effort.
  }
}

async function cancelTrackedFor(eventId: string): Promise<void> {
  try {
    const raw = lazyDb().kvGet(APPT_IDS_KEY) as string | null;
    const id = raw ? (JSON.parse(raw) as Record<string, string>)[eventId] : undefined;
    if (id) {
      try {
        await lazyNotifications().cancelScheduledNotificationAsync(id);
      } catch {
        // Already fired — harmless.
      }
    }
  } catch {
    // Best-effort.
  } finally {
    removeTrackedId(eventId);
  }
}

/**
 * Re-fires one appointment reminder `minutes` from now with the same
 * neutral copy. No-op on web; when the appointment no longer exists it
 * just clears the stale schedule. Never throws.
 */
export async function snoozeReminder(eventId: string, minutes: number): Promise<void> {
  try {
    if (isWeb()) return;
    const event = lazyStore().getEvent(eventId) as LocalEvent | null;
    await cancelTrackedFor(eventId);
    if (!event || event.deletedAt) return;
    const copy = appointmentReminderCopy(event.occurredAt, event.data);
    const N = lazyNotifications();
    const id = (await N.scheduleNotificationAsync({
      content: {
        title: copy.title,
        body: copy.body,
        data: { kind: 'appointment', appointmentId: eventId },
        categoryIdentifier: 'nurture_appointment',
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DATE,
        date: new Date(snoozeFireAtMs(Date.now(), minutes)),
      },
    })) as string;
    try {
      const raw = lazyDb().kvGet(APPT_IDS_KEY) as string | null;
      const map = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
      map[eventId] = id;
      lazyDb().kvSet(APPT_IDS_KEY, JSON.stringify(map));
    } catch {
      // Scheduled but untracked — it still fires; the next refresh reconciles.
    }
  } catch {
    // A failed snooze degrades to "the reminder doesn't re-fire".
  }
}

/** Dismisses one appointment reminder. Never throws. */
export async function dismissReminder(eventId: string): Promise<void> {
  try {
    if (isWeb()) return;
    await cancelTrackedFor(eventId);
  } catch {
    // Best-effort.
  }
}

/**
 * "Pause all until I return": sets the global pause flag (same convention
 * as the You tab's pause-all button — any non-null value reads as paused)
 * and cancels every pending appointment reminder. Never throws.
 *
 * The value is a far-future sentinel rather than "now": the existing
 * end-of-day nudge treats pause as active only while the timestamp is
 * later than Date.now(), so a far-future sentinel keeps BOTH the
 * appointment scheduler and the nudge paused until she resumes.
 */
export const PAUSE_UNTIL_FAR_FUTURE = '9999-12-31T23:59:59.999Z';

export async function pauseAllNotifications(): Promise<void> {
  try {
    if (isWeb()) return;
    try {
      await lazyPrefs().updatePrefs({ globalPauseUntil: PAUSE_UNTIL_FAR_FUTURE });
    } catch {
      // updatePrefs writes local kv before the server mirror; the pause
      // holds locally even when the mirror fails.
    }
    await cancelAppointmentReminders();
  } catch {
    // Best-effort.
  }
}

/* ------------------------------------------------------------------ */
/* Response wiring                                                     */
/* ------------------------------------------------------------------ */

export interface ReminderSurfaceCallbacks {
  /** Deep-link target: show the appointment detail for this event id. */
  onViewAppointment: (appointmentId: string) => void;
  /** Fired after "Pause all" so the UI can reflect the paused state. */
  onPaused?: () => void;
}

async function executeAction(action: ReminderAction, cb: ReminderSurfaceCallbacks): Promise<void> {
  switch (action.kind) {
    case 'view':
      cb.onViewAppointment(action.appointmentId);
      break;
    case 'snooze':
      await snoozeReminder(action.appointmentId, action.minutes);
      break;
    case 'pause':
      await pauseAllNotifications();
      cb.onPaused?.();
      break;
    case 'dismiss':
      await dismissReminder(action.appointmentId);
      break;
    case 'ignore':
      break;
  }
}

/**
 * Installs everything the reminder surfaces need while the app is running:
 * foreground banner config, action-button categories, and the response
 * listener that turns taps into view / snooze / pause / dismiss. Returns a
 * cleanup function. Safe to call once per mount; no-op on web.
 */
export function installReminderSurfaces(cb: ReminderSurfaceCallbacks): () => void {
  try {
    if (isWeb()) return () => {};
    ensureReminderHandler();
    void installAppointmentCategories();
    void refreshAppointmentReminders();
    const N = lazyNotifications();
    const sub = N.addNotificationResponseReceivedListener((response: AnyModule) => {
      try {
        const action = describeReminderResponse(
          response?.actionIdentifier as string | undefined,
          response?.notification?.request?.content?.data as Record<string, unknown> | undefined,
        );
        void executeAction(action, cb);
      } catch {
        // A bad response must never crash the listener.
      }
    });
    return () => {
      try {
        sub?.remove();
      } catch {
        // Best-effort.
      }
    };
  } catch {
    return () => {};
  }
}

/**
 * Cold-start deep link: when the OS launched the app from an appointment
 * reminder tap, returns that appointment's event id (and clears the stored
 * response so it doesn't re-trigger). Null otherwise / on web. Never throws.
 */
export async function takeColdStartAppointmentResponse(): Promise<string | null> {
  try {
    if (isWeb()) return null;
    const N = lazyNotifications();
    const response = (await N.getLastNotificationResponseAsync()) as AnyModule | null;
    if (!response) return null;
    const action = describeReminderResponse(
      response.actionIdentifier as string | undefined,
      response.notification?.request?.content?.data as Record<string, unknown> | undefined,
    );
    try {
      await N.clearLastNotificationResponseAsync();
    } catch {
      // Best-effort.
    }
    return action.kind === 'view' ? action.appointmentId : null;
  } catch {
    return null;
  }
}
