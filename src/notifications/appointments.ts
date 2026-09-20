/**
 * Appointment reminders (Epic 6, §6.1).
 *
 * Schedules one local notification per upcoming appointment, firing at the
 * appointment's OWN lead time (`data.reminderLeadMinutes` on the event),
 * falling back to the global default (`Prefs.appointmentLeadMinutes`,
 * 2 days) for appointments that never set one. Copy is neutral by
 * construction (see ./reminderCopy.ts). Deep-link data carries
 * `{ kind: 'appointment', appointmentId }` so "View" lands on the
 * appointment detail in the Plan tab.
 *
 * Module shape (repo convention for node-testability, cf. src/briefing/context.ts):
 * - Module scope is dependency-free: every native import (expo-notifications,
 *   react-native, expo-crypto, sqlite) is lazy-required inside the impure
 *   functions, so the node unit-test runner can import this file without a
 *   device. The impure paths (`refreshAppointmentReminders`, category setup)
 *   are no-ops on web — browsers can't schedule push, per the backlog.
 * - Pure, unit-tested core: `planAppointmentReminders`, `adjustForQuietHours`.
 *
 * Scheduling rules (pure planner):
 * - Nothing when: reminders disabled, globally paused, pregnancy stopped
 *   (contract C3), no OS permission, or no future appointments.
 * - Fire time = appointment start − lead minutes, where each appointment's
 *   own `data.reminderLeadMinutes` overrides the global default. If the
 *   lead window already
 *   passed (she logged the appointment late), fire gently one minute out
 *   rather than nagging about a missed window.
 * - Quiet hours (9 PM – 8 AM default, fixed): a reminder that would land
 *   inside them moves to the end of quiet hours — unless that would push it
 *   past the visit start, in which case it moves to just before quiet hours
 *   start (e.g. 8:59 PM for a 10 PM visit). If neither alternative is usable,
 *   the original slot stands: a late reminder beats a useless one.
 * - "Paused" follows the You tab's convention: `globalPauseUntil !== null`
 *   means paused (same flag the pause-all button sets), not just future
 *   timestamps.
 *
 * Refresh triggers: `refreshAppointmentReminders()` reconciles the whole set
 * (cancels tracked ids, reschedules from the current event list). It is
 * called when the Plan tab gains focus — the surface that owns appointments —
 * and after any snooze/dismiss/pause action. Never throws: reminders are a
 * nicety, never a crash.
 */

import type { Prefs } from '../lib/types';
import { appointmentReminderCopy } from './reminderCopy';
import { appointmentLeadMinutes } from './reminderTiming';
import { inQuietHours, parseHM } from './nudgeLogic';

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

/** True on web (or any non-native runtime): scheduling is a silent no-op there. */
function isWeb(): boolean {
  try {
    const rn = require('react-native') as { Platform?: { OS?: string } };
    return rn.Platform?.OS !== 'android' && rn.Platform?.OS !== 'ios';
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Pure scheduling core (unit-tested)                                  */
/* ------------------------------------------------------------------ */

/** One upcoming appointment, as read from the local event store. */
export interface UpcomingAppointment {
  id: string;
  occurredAt: string; // ISO 8601
  data: Record<string, unknown>;
}

/** One reminder the planner decided to schedule. */
export interface ReminderPlan {
  eventId: string;
  fireAtMs: number;
  title: string;
  body: string;
}

export interface PlanInput {
  appointments: UpcomingAppointment[];
  /** The global default lead (Prefs.appointmentLeadMinutes); each
   * appointment's own `data.reminderLeadMinutes` overrides it. */
  leadMinutes: number;
  remindersEnabled: boolean;
  /** You-tab convention: any non-null globalPauseUntil = paused. */
  paused: boolean;
  /** Contract C3: false when pregnancy.status === 'stopped'. */
  pregnancyActive: boolean;
  permissionGranted: boolean;
  quietStart: string; // 'HH:MM'
  quietEnd: string; // 'HH:MM'
  nowMs: number;
}

const LATE_APPOINTMENT_GRACE_MS = 60_000; // lead window missed → nudge one minute out

/**
 * Moves a fire time out of quiet hours. Prefers the end of the quiet window
 * (forward); when that would land at or after the visit start, falls back to
 * just before quiet hours start (backward) — e.g. 8:59 PM for a 10 PM visit.
 * Keeps the original slot only when neither alternative is usable (backward
 * would be in the past or past the visit): a late reminder beats a useless
 * one. Pure.
 */
export function adjustForQuietHours(
  fireAtMs: number,
  occurredAtMs: number,
  quietStart: string,
  quietEnd: string,
  nowMs: number,
): number {
  const d = new Date(fireAtMs);
  if (!inQuietHours({ h: d.getHours(), m: d.getMinutes() }, quietStart, quietEnd)) return fireAtMs;
  const start = parseHM(quietStart);
  const end = parseHM(quietEnd);
  if (!start || !end) return fireAtMs;
  // Forward: the next end-of-quiet-hours after the fire time.
  const fwd = new Date(fireAtMs);
  fwd.setHours(end.h, end.m, 0, 0);
  if (fwd.getTime() <= fireAtMs) fwd.setDate(fwd.getDate() + 1);
  if (fwd.getTime() < occurredAtMs) return fwd.getTime();
  // Backward: one minute before quiet hours start. For overnight windows
  // where the fire time is in the morning half, quiet-start belongs to the
  // previous evening.
  const bwd = new Date(fireAtMs);
  bwd.setHours(start.h, start.m, 0, 0);
  bwd.setMinutes(bwd.getMinutes() - 1);
  if (bwd.getTime() >= fireAtMs) bwd.setDate(bwd.getDate() - 1);
  if (bwd.getTime() > nowMs && bwd.getTime() < occurredAtMs) return bwd.getTime();
  return fireAtMs;
}

/**
 * Decides which appointment reminders to schedule. Pure — no DB, no OS.
 * Returns plans sorted by fire time (earliest first).
 */
export function planAppointmentReminders(input: PlanInput): ReminderPlan[] {
  if (!input.remindersEnabled) return [];
  if (input.paused) return [];
  if (!input.pregnancyActive) return [];
  if (!input.permissionGranted) return [];
  const plans: ReminderPlan[] = [];
  for (const appt of input.appointments) {
    const at = new Date(appt.occurredAt).getTime();
    if (Number.isNaN(at) || at <= input.nowMs) continue; // past visit — nothing to schedule
    // Per-appointment timing: the event's own value wins, the global
    // default (input.leadMinutes) applies when it never set one.
    const leadMs = Math.max(0, appointmentLeadMinutes(appt.data ?? {}, input.leadMinutes)) * 60_000;
    let fireAt = at - leadMs;
    if (fireAt <= input.nowMs) fireAt = input.nowMs + LATE_APPOINTMENT_GRACE_MS;
    fireAt = adjustForQuietHours(fireAt, at, input.quietStart, input.quietEnd, input.nowMs);
    if (fireAt <= input.nowMs) continue; // never schedule in the past
    const copy = appointmentReminderCopy(appt.occurredAt, appt.data, input.nowMs);
    plans.push({ eventId: appt.id, fireAtMs: fireAt, title: copy.title, body: copy.body });
  }
  plans.sort((a, b) => a.fireAtMs - b.fireAtMs);
  return plans;
}

/* ------------------------------------------------------------------ */
/* Impure scheduling (device only)                                     */
/* ------------------------------------------------------------------ */

const APPT_IDS_KEY = 'notif.appointmentReminderIds'; // kv JSON: Record<eventId, notificationId>
/** Category id — expo-notifications forbids ':' and '-' in category identifiers. */
export const APPOINTMENT_CATEGORY = 'nurture_appointment';

/** Reads the scheduled-notification ids we are tracking, tolerant of corruption. */
function readTrackedIds(): Record<string, string> {
  try {
    const raw = lazyDb().kvGet(APPT_IDS_KEY) as string | null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeTrackedIds(map: Record<string, string>): void {
  try {
    lazyDb().kvSet(APPT_IDS_KEY, JSON.stringify(map));
  } catch {
    // Tracking is best-effort; a lost map just means orphans we can't cancel.
  }
}

/** Upcoming (future, non-deleted) appointment events, soonest first. */
export function listUpcomingAppointments(limit = 20): UpcomingAppointment[] {
  const rows = lazyDb().getDb().getAllSync(
    `SELECT id, occurred_at, data FROM events
     WHERE type = 'appointment' AND deleted_at IS NULL AND occurred_at > ?
     ORDER BY occurred_at ASC LIMIT ?`,
    new Date().toISOString(),
    limit,
  ) as Array<{ id: string; occurred_at: string; data: string }>;
  const out: UpcomingAppointment[] = [];
  for (const row of rows ?? []) {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      data = {};
    }
    out.push({ id: row.id, occurredAt: row.occurred_at, data });
  }
  return out;
}

/**
 * Persists ONE appointment's own reminder lead time
 * (`data.reminderLeadMinutes`, minutes): rewrites the event's data bag,
 * marks the row dirty, and queues an upsert so the next text sync carries
 * the change (same pattern as `setEventAttachments` in ../sync/store).
 * Appointments that never get a value keep falling back to the global
 * default (`Prefs.appointmentLeadMinutes`) at read time — this never
 * touches the global pref. No-op when the event doesn't exist.
 * Never throws.
 */
export function saveReminderLeadMinutes(eventId: string, minutes: number): boolean {
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
    data.reminderLeadMinutes = Math.max(1, Math.round(minutes));
    const now = new Date().toISOString();
    db.getDb().withTransactionSync(() => {
      db
        .getDb()
        .runSync(
          'UPDATE events SET data = ?, updated_at = ?, dirty = 1 WHERE id = ?',
          JSON.stringify(data),
          now,
          eventId,
        );
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

async function permissionGranted(): Promise<boolean> {
  try {
    const p = await lazyNotifications().getPermissionsAsync();
    return !!p?.granted;
  } catch {
    return false;
  }
}

/** Cancels every appointment reminder we have scheduled. Never throws. */
export async function cancelAppointmentReminders(): Promise<void> {
  try {
    if (isWeb()) return;
    const N = lazyNotifications();
    for (const id of Object.values(readTrackedIds())) {
      try {
        await N.cancelScheduledNotificationAsync(id);
      } catch {
        // Already fired or unknown id — harmless.
      }
    }
    writeTrackedIds({});
  } catch {
    // Reminders are a nicety, never a crash.
  }
}

/**
 * Reconciles scheduled appointment reminders with the current event list:
 * cancels everything tracked, then (re)schedules per the pure planner.
 * Never throws; on web it is a silent no-op.
 */
export async function refreshAppointmentReminders(): Promise<void> {
  try {
    if (isWeb()) return;
    await cancelAppointmentReminders();
    const prefs = (await lazyPrefs().getPrefs()) as Prefs;
    const pregnancy = lazyStore().getActivePregnancy() as { status?: string } | null;
    const plans = planAppointmentReminders({
      appointments: listUpcomingAppointments(),
      leadMinutes: prefs.appointmentLeadMinutes,
      remindersEnabled: prefs.appointmentReminders,
      paused: prefs.globalPauseUntil !== null,
      pregnancyActive: !!pregnancy && pregnancy.status === 'active',
      permissionGranted: await permissionGranted(),
      quietStart: prefs.quietHoursStart,
      quietEnd: prefs.quietHoursEnd,
      nowMs: Date.now(),
    });
    if (plans.length === 0) return;
    const N = lazyNotifications();
    const tracked: Record<string, string> = {};
    for (const plan of plans) {
      try {
        const id = (await N.scheduleNotificationAsync({
          content: {
            title: plan.title,
            body: plan.body,
            // Deep-link target for the tap: a root-layout observer (Expo
            // Router pattern) can read data.url without knowing our kinds.
            data: { kind: 'appointment', appointmentId: plan.eventId, url: `/plan?appointment=${plan.eventId}` },
            categoryIdentifier: APPOINTMENT_CATEGORY,
          },
          trigger: {
            type: N.SchedulableTriggerInputTypes.DATE,
            date: new Date(plan.fireAtMs),
          },
        })) as string;
        tracked[plan.eventId] = id;
      } catch {
        // One bad schedule must not block the rest.
      }
    }
    writeTrackedIds(tracked);
  } catch {
    // Scheduling must never break the app.
  }
}

/**
 * Registers the iOS/Android action buttons for appointment reminders:
 * one-tap Snooze (10 min), and the long-press sheet's Snooze 1 hour,
 * Pause all, Dismiss. The plain body tap (default action) opens the app
 * and is deep-linked by the response handler in ./snooze.ts.
 */
export async function installAppointmentCategories(): Promise<void> {
  try {
    if (isWeb()) return;
    const N = lazyNotifications();
    await N.setNotificationCategoryAsync(APPOINTMENT_CATEGORY, [
      {
        identifier: 'snooze_10',
        buttonTitle: 'Snooze 10 min',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'snooze_60',
        buttonTitle: 'Snooze 1 hour',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'pause_all',
        buttonTitle: 'Pause all',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'dismiss',
        buttonTitle: 'Dismiss',
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);
  } catch {
    // Categories are a nicety; the reminder still fires without buttons.
  }
}

/** Foreground banner config shared with the end-of-day nudge (idempotent). */
export function ensureReminderHandler(): void {
  try {
    if (isWeb()) return;
    lazyNotifications().setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    // Non-fatal.
  }
}
