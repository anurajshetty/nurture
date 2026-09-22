/**
 * Device-timezone change detection (Anuraj, Sept 2026).
 *
 * Every timestamp in the app is an absolute instant rendered device-local at
 * render time, so the same event shows the right wall-clock time for a
 * viewer in PST and a viewer in EST. But day-group sections and other time
 * labels are memoized — if the device timezone changes while the app is
 * open (she flies PST → EST), the cached groups keep the old zone's
 * boundaries until something recomputes them.
 *
 * This module tracks the IANA zone and bumps a monotonic version counter
 * whenever it changes. Memoized time computations key on the version via
 * `useTimezoneVersion()`; the check runs on foreground/focus (wired in
 * SyncContext's backstop effect) and on a slow interval, so the switch
 * happens automatically with no user action — not just on next cold start.
 *
 * Pure logic except the React hook; safe to unit-test with node.
 */

import { useEffect, useState } from 'react';

/** Reads the device's IANA timezone name, e.g. "America/Los_Angeles". */
export type ZoneReader = () => string | undefined;

const defaultReader: ZoneReader = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

let lastZone: string | undefined;
/** True once the module has taken its first zone reading. Separate from
 * lastZone because the first platform read itself may legitimately return
 * undefined — that must not be mistaken for "a zone we already saw". */
let initialized = false;
let version = 0;
const listeners = new Set<() => void>();

/** The device's current IANA timezone, when the platform exposes one. */
export function getDeviceTimeZone(reader: ZoneReader = defaultReader): string | undefined {
  try {
    return reader();
  } catch {
    return undefined;
  }
}

/**
 * Monotonic counter. Bumps exactly when the detected device timezone
 * changes; memoized day-groups and time labels key on it.
 */
export function getTimezoneVersion(): number {
  return version;
}

/**
 * Compare the current device zone against the last-seen zone. Returns true
 * when the zone changed (subscribers are notified). Cheap and safe to call
 * often — a no-op until the zone actually changes. Never throws.
 *
 * The reader is injectable so tests can simulate a zone change without
 * touching the real device clock.
 */
export function checkTimezoneNow(reader: ZoneReader = defaultReader): boolean {
  let zone: string | undefined;
  try {
    zone = reader();
  } catch {
    return false;
  }
  if (!initialized) {
    initialized = true;
    lastZone = zone;
    return false;
  }
  if (zone === lastZone) return false;
  lastZone = zone;
  version += 1;
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // A listener must never break the UI.
    }
  }
  return true;
}

/** Re-render the subscriber when the device timezone changes. */
export function subscribeToTimezoneChanges(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook: re-renders the component when the device timezone changes. */
export function useTimezoneVersion(): number {
  const [v, setV] = useState(() => getTimezoneVersion());
  useEffect(() => subscribeToTimezoneChanges(() => setV(getTimezoneVersion())), []);
  return v;
}

/** Test-only reset. Not for production use. */
export function __resetTimezoneForTests(): void {
  lastZone = undefined;
  initialized = false;
  version = 0;
  listeners.clear();
}
