/**
 * Screen wake lock for the breathing pacer (Willow, Sept 2026).
 *
 * Uses the Web Wake Lock API (`navigator.wakeLock.request('screen')`) while a
 * round is active — the same API the design mockup names. On platforms
 * without it (native iOS/Android builds) this is a safe no-op; the native
 * equivalent would be expo-keep-awake (not a dependency — coordinator call
 * if the native app needs a hard wake lock).
 *
 * Returns a release function; call it when the round ends or unmounts.
 */
export function requestScreenWakeLock(): () => void {
  let sentinel: { release?: () => void } | null = null;
  let released = false;

  try {
    const nav =
      typeof navigator !== 'undefined'
        ? (navigator as unknown as { wakeLock?: { request: (kind: string) => Promise<unknown> } })
        : null;
    if (nav?.wakeLock?.request) {
      nav.wakeLock
        .request('screen')
        .then((s) => {
          sentinel = s as { release?: () => void };
          if (released) {
            try {
              sentinel?.release?.();
            } catch {
              /* never break the pacer */
            }
          }
        })
        .catch(() => {
          /* unsupported or denied — practice continues without the lock */
        });
    }
  } catch {
    /* never break the pacer */
  }

  return () => {
    released = true;
    try {
      sentinel?.release?.();
    } catch {
      /* never break the pacer */
    }
  };
}
