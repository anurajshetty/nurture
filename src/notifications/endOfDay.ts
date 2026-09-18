/**
 * End-of-day nudge (Epic 2.2).
 *
 * Fires ONLY when she logged nothing that day — the app never schedules
 * a logging time and there are no streaks, badges, or shame language
 * anywhere. Default 8:30 PM, quiet hours respected, one-tap global pause
 * honored.
 *
 * How the "only if nothing logged" check works with a daily trigger:
 * every time the app boots, an entry is saved, or an entry is undone, we
 * cancel the pending nudge and re-evaluate. Entry logged today → no nudge
 * scheduled. Nothing logged → a daily 8:30 PM trigger is (re)scheduled,
 * so it still fires on days she never opens the app.
 *
 * On web this is a silent no-op: browsers can't schedule push, per the
 * backlog. Her toggle choice is still persisted via prefs.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getDb, kvGet, kvSet } from '../lib/db';
import { getPrefs } from './prefs';
import { decideNudge } from './nudgeLogic';

const NUDGE_ID_KEY = 'notif.endOfDayId';

let handlerInstalled = false;

/** Shows the nudge as a banner when the app happens to be foregrounded. */
function ensureHandler(): void {
  if (handlerInstalled || Platform.OS === 'web') return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/** True when at least one non-deleted event occurred today (local day). */
function hasEntryToday(): boolean {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = getDb().getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM events WHERE deleted_at IS NULL AND occurred_at >= ?',
    start.toISOString(),
  );
  return (row?.n ?? 0) > 0;
}

async function permissionGranted(): Promise<boolean> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted;
  } catch {
    return false;
  }
}

/**
 * Re-evaluates the end-of-day nudge and schedules/cancels accordingly.
 * Never throws — a nudge is a nicety, never a crash.
 */
export async function refreshEndOfDayNudge(): Promise<void> {
  try {
    ensureHandler();
    if (Platform.OS === 'web') return;

    const prevId = kvGet(NUDGE_ID_KEY);
    if (prevId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(prevId);
      } catch {
        // Already fired or unknown id — harmless.
      }
      kvSet(NUDGE_ID_KEY, '');
    }

    const prefs = await getPrefs();
    const plan = decideNudge({
      enabled: prefs.endOfDayEnabled,
      paused:
        !!prefs.globalPauseUntil &&
        new Date(prefs.globalPauseUntil).getTime() > Date.now(),
      hasEntryToday: hasEntryToday(),
      time: prefs.endOfDayTime,
      quietStart: prefs.quietHoursStart,
      quietEnd: prefs.quietHoursEnd,
      permissionGranted: await permissionGranted(),
    });
    if (!plan) return;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your story is waiting ✎',
        // Warm and pressure-free: an invitation, never a guilt trip.
        // No health details on the lock screen, per the backlog.
        body: 'Save a moment from today — one tap, no pressure.',
        data: { kind: 'end-of-day' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: plan.hour,
        minute: plan.minute,
      },
    });
    kvSet(NUDGE_ID_KEY, id);
  } catch {
    // Notification scheduling must never break the app.
  }
}
