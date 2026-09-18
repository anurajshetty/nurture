/**
 * Notification preferences for Nurture.
 *
 * Stored locally in SQLite (survives offline and reinstalls of the backend
 * config) and mirrored to the server's `notification_prefs` table when a
 * backend is configured and the user is signed in. Scheduling itself is a
 * later epic; this module owns only prefs + the permission request.
 * Plain-language rationale copy is left to the UI layer.
 *
 * Times are 'HH:MM' strings; `globalPauseUntil` is ISO 8601 or null.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { kvGet, kvSet } from '../lib/db';
import { supabase, isConfigured } from '../lib/supabase';
import type { Prefs } from '../lib/types';

export type { Prefs };

const PREFS_KEY = 'notif.prefs';

/** Defaults for a fresh install (match the server-side column defaults). */
export const DEFAULT_PREFS: Prefs = {
  endOfDayEnabled: true,
  endOfDayTime: '20:30',
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  appointmentReminders: true,
  appointmentLeadMinutes: 60,
  globalPauseUntil: null,
};

/** Reads local notification prefs, merged over defaults. Never throws. */
export async function getPrefs(): Promise<Prefs> {
  try {
    const raw = kvGet(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Updates local prefs and, when configured + signed in, mirrors them to the
 * server's notification_prefs table. Throws only when the server write fails.
 */
export async function updatePrefs(patch: Partial<Prefs>): Promise<void> {
  const next: Prefs = { ...(await getPrefs()), ...patch };
  kvSet(PREFS_KEY, JSON.stringify(next));
  if (!isConfigured || !supabase) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('notification_prefs').upsert(
    {
      user_id: user.id,
      end_of_day_enabled: next.endOfDayEnabled,
      end_of_day_time: next.endOfDayTime,
      quiet_hours_start: next.quietHoursStart,
      quiet_hours_end: next.quietHoursEnd,
      appointment_reminders: next.appointmentReminders,
      appointment_lead_minutes: next.appointmentLeadMinutes,
      global_pause_until: next.globalPauseUntil,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(`Could not save notification preferences: ${error.message}`);
}

/**
 * Requests OS notification permission. Returns true when granted.
 * Never throws; returns false when unavailable or denied.
 *
 * On web this is a silent no-op that returns true: there is no OS push to
 * grant, and the caller must not show the "off in system settings" warning
 * for a platform that simply has no notification channel. Her toggle choice
 * is still persisted via patchPrefs.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}
