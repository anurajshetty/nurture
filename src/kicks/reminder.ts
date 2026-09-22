/**
 * Kick counter — the opt-in evening reminder (Willow, Anuraj approved
 * Sept 20, 2026).
 *
 * Locked semantics: the reminder starts OFF and only "Yes, remind me"
 * turns it on — "Not now", the sheet close, and scrim dismissal all leave
 * it off. One gentle nudge a day around 8:00 PM, pausable in one tap, and
 * it stops on its own when the pregnancy ends. No health details on the
 * lock screen, per the backlog.
 *
 * On web this is a silent no-op for scheduling (browsers can't schedule
 * push, per the backlog) — her toggle choice is still persisted.
 *
 * Module shape follows src/plan/questions.ts: the native boundary is
 * lazy (`declare const require`) so the pure `decideKickReminderSchedule`
 * stays unit-testable under plain node. Never throws outward.
 */

type AnyModule = Record<string, any>;

declare const require: (id: string) => unknown;

function lazyNotifications(): AnyModule {
  return require('expo-notifications') as AnyModule;
}

function lazyPlatform(): { OS: string } {
  return (require('react-native') as AnyModule).Platform as { OS: string };
}

function lazyDb(): AnyModule {
  return require('../lib/db') as AnyModule;
}

function lazyStore(): AnyModule {
  return require('../sync/store') as AnyModule;
}

function lazyPrefs(): AnyModule {
  return require('../notifications/prefs') as AnyModule;
}

const ENABLED_KEY = 'kick.reminder.enabled';
const NOTIF_ID_KEY = 'kick.reminder.notifId';

/** 8:00 PM — "a quiet nudge around 8:00 PM". */
const REMINDER_HOUR = 20;
const REMINDER_MINUTE = 0;

let handlerInstalled = false;

function ensureHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  try {
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
    // Nicety only.
  }
}

export interface KickReminderDecision {
  enabled: boolean;
  hasActivePregnancy: boolean;
  permissionGranted: boolean;
  platformOS: string;
}

/**
 * Pure: should a kick reminder be (re)scheduled right now? The opt-in
 * flag alone isn't enough — no active pregnancy, no permission, or web
 * means nothing fires. Unit-tested.
 */
export function decideKickReminderSchedule(
  input: KickReminderDecision,
): boolean {
  return (
    input.enabled &&
    input.hasActivePregnancy &&
    input.permissionGranted &&
    input.platformOS !== 'web'
  );
}

/** Her opt-in choice, persisted. Defaults to off. Never throws. */
export function isKickReminderEnabled(): boolean {
  try {
    return lazyDb().kvGet(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

async function permissionGranted(): Promise<boolean> {
  try {
    const p = await lazyNotifications().getPermissionsAsync();
    return !!p.granted;
  } catch {
    return false;
  }
}

/**
 * Re-evaluates the evening reminder: cancels any pending nudge, then
 * schedules a daily 8:00 PM one only when she opted in, the pregnancy is
 * active, and permission is granted. Stops on its own when the pregnancy
 * ends. Never throws — a nudge is a nicety, never a crash.
 */
export async function refreshKickReminder(): Promise<void> {
  try {
    ensureHandler();
    const db = lazyDb();
    const N = lazyNotifications();

    const prevId = db.kvGet(NOTIF_ID_KEY) as string | null;
    if (prevId) {
      try {
        await N.cancelScheduledNotificationAsync(prevId);
      } catch {
        // Already fired or unknown id — harmless.
      }
      db.kvSet(NOTIF_ID_KEY, '');
    }

    const enabled = isKickReminderEnabled();
    let hasActivePregnancy = false;
    try {
      hasActivePregnancy = !!lazyStore().getActivePregnancy();
    } catch {
      hasActivePregnancy = false;
    }
    const granted = await permissionGranted();
    const platformOS = lazyPlatform().OS;

    if (
      !decideKickReminderSchedule({
        enabled,
        hasActivePregnancy,
        permissionGranted: granted,
        platformOS,
      })
    ) {
      return;
    }

    const id = await N.scheduleNotificationAsync({
      content: {
        title: 'Kick counting',
        // Warm and pressure-free, no health details on the lock screen.
        body: 'A quiet moment to notice your baby\u2019s movements.',
        data: { kind: 'kick-reminder' },
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DAILY,
        hour: REMINDER_HOUR,
        minute: REMINDER_MINUTE,
      },
    });
    db.kvSet(NOTIF_ID_KEY, id);
  } catch {
    // Notification scheduling must never break the app.
  }
}

/**
 * Records her opt-in choice and re-evaluates scheduling. "Yes, remind me"
 * is the right moment to request OS permission (explicit consent); a
 * denial simply means nothing fires until she grants it in settings —
 * the choice itself stays hers. Never throws.
 */
export async function setKickReminderEnabled(on: boolean): Promise<void> {
  try {
    const db = lazyDb();
    db.kvSet(ENABLED_KEY, on ? '1' : '0');
    if (on) {
      try {
        await lazyPrefs().requestNotificationPermissions();
      } catch {
        // Her choice is recorded; scheduling checks permission itself.
      }
    }
    await refreshKickReminder();
  } catch {
    // Never break the UI over a reminder toggle.
  }
}
