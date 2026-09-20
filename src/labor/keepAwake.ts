/**
 * Shared screen wake lock for the labor-readiness sections (Willow, Sept 2026).
 *
 * One shape for every call site (contraction timer, breathing pacer,
 * pelvic-floor session): `requestScreenWakeLock()` returns a release function.
 * Call it when the session/round ends or the screen unmounts.
 *
 * Best-effort only — never throws.
 *
 * - Web (`Platform.OS === 'web'`): the exact Web Wake Lock API code path the
 *   sections previously used inline (`navigator.wakeLock.request('screen')`),
 *   re-requested when the tab becomes visible again (browsers drop the lock
 *   while the page is hidden).
 * - Native (iOS/Android): `expo-keep-awake`'s `activateKeepAwakeAsync` with a
 *   unique tag per request, so locks held by different sections release
 *   independently.
 */
import { Platform } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

type WakeSentinel = { release?: () => void } | null;

/**
 * Web Wake Lock API path — the behavior the sections used inline before this
 * module existed (request, settle-after-release guard, re-request on
 * visibility return, release on cleanup).
 */
function requestWebWakeLock(): () => void {
  let sentinel: WakeSentinel = null;
  let released = false;

  const nav =
    typeof navigator !== 'undefined'
      ? (navigator as unknown as {
          wakeLock?: { request: (kind: string) => Promise<unknown> };
        })
      : null;
  const doc = typeof document !== 'undefined' ? document : null;

  const request = () => {
    if (released) return;
    try {
      if (nav?.wakeLock?.request) {
        nav.wakeLock
          .request('screen')
          .then((s) => {
            sentinel = s as { release?: () => void };
            if (released) {
              // Release arrived before the grant settled.
              try {
                sentinel?.release?.();
              } catch {
                /* never break the session */
              }
            }
          })
          .catch(() => {
            /* unsupported or denied — session continues without the lock */
          });
      }
    } catch {
      /* never break the session */
    }
  };

  request();
  const onVisibility = () => {
    if (doc && doc.visibilityState === 'visible') request();
  };
  if (doc) {
    try {
      doc.addEventListener('visibilitychange', onVisibility);
    } catch {
      /* ignore */
    }
  }

  return () => {
    released = true;
    if (doc) {
      try {
        doc.removeEventListener('visibilitychange', onVisibility);
      } catch {
        /* ignore */
      }
    }
    try {
      sentinel?.release?.();
    } catch {
      /* ignore */
    }
    sentinel = null;
  };
}

let tagSeq = 0;

/** Hold the screen awake; returns the release function. Never throws. */
export function requestScreenWakeLock(): () => void {
  if (Platform.OS === 'web') return requestWebWakeLock();

  // Native: expo-keep-awake, best-effort. A unique tag per request so two
  // sections holding the lock at once release independently.
  const tag = `willow-labor-${(tagSeq += 1)}`;
  let released = false;
  try {
    void activateKeepAwakeAsync(tag).catch(() => {
      /* unavailable — the session continues without the lock */
    });
  } catch {
    /* never break the session */
  }
  return () => {
    if (released) return;
    released = true;
    try {
      void deactivateKeepAwake(tag).catch(() => {
        /* ignore */
      });
    } catch {
      /* ignore */
    }
  };
}
