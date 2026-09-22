/**
 * Regression test: local-timezone timestamps (Anuraj, Sept 2026).
 *
 * Requirement: every timestamp renders in the viewer's local device
 * timezone, on both surfaces (her feed and the partner home). If she's in
 * PST and the partner is in EST, each sees the correct local time for the
 * same event — and if the device timezone changes while the app is open
 * (PST → EST flight), times and day-group boundaries switch automatically,
 * not just on next cold start.
 *
 * Root cause of the travel bug: day-group sections and time labels are
 * memoized on the event list only. A timezone change mid-session left the
 * cached PST groups on screen in EST. The fix (src/time/timezone.ts):
 * `checkTimezoneNow()` detects the zone change and bumps a version counter
 * that the memoized computations key on; the check runs on
 * foreground/focus and on a slow interval (wired in SyncContext).
 *
 * The test:
 *  1. The same UTC instant renders as the correct local wall-clock time
 *     AND lands in the correct local day group under PST and under EST.
 *  2. Simulates the app's memoization: after a zone flip WITHOUT the
 *     check, cached sections stay stale (the bug — asserted as the
 *     control); after `checkTimezoneNow()` (the fix's wiring), the
 *     version bumps, subscribers fire, and recomputed sections show the
 *     new zone's times and day groups.
 *
 * Run with:
 *   npx tsc tests/local_timezone.test.ts src/time/timezone.ts src/time/localFormat.ts \
 *     src/timeline/timeline.ts src/onboarding/dates.ts src/lib/types.ts \
 *     --ignoreConfig --outDir /tmp/nurture-localtz-tests --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-localtz-tests/tests/local_timezone.test.js
 */

import {
  checkTimezoneNow,
  getDeviceTimeZone,
  getTimezoneVersion,
  subscribeToTimezoneChanges,
  __resetTimezoneForTests,
} from '../src/time/timezone';
/** The REAL production formatter — not a mirror. If this drifts from what
 * EventCard renders, the test breaks, which is the point. */
import { formatLocalTime } from '../src/time/localFormat';
import {
  buildDaySections,
  formatDayGroupLabel,
  localDayISO,
} from '../src/timeline/timeline';
import type { LocalEvent } from '../src/lib/types';

declare const process: { exit(code: number): void; env: Record<string, string | undefined> };

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, extra?: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

/** Wall-clock portion of the real card timestamp. The day prefix ("Today" /
 * "Yesterday" / "Sep 21") follows the machine's real "now", which the test
 * does not pin — only the zone-discriminating wall-clock part is asserted. */
function wallClock(iso: string): string {
  return formatLocalTime(iso);
}

function noteEvent(occurredAt: string): LocalEvent {
  return {
    id: 'e1',
    type: 'note',
    occurredAt,
    createdAt: occurredAt,
    text: 'test',
    mood: null,
    attachments: [],
    shared: true,
    deletedAt: null,
  } as unknown as LocalEvent;
}

// The instant both viewers see: 2026-09-22T06:30:00Z.
//  → PST (America/Los_Angeles): Mon Sep 21, 11:30 PM
//  → EST (America/New_York):    Tue Sep 22,  2:30 AM
const INSTANT = '2026-09-22T06:30:00Z';

// --- 1. Same instant, correct local render in both zones ----------------
process.env.TZ = 'America/Los_Angeles';
assert(localDayISO(INSTANT) === '2026-09-21', 'PST local day', localDayISO(INSTANT) ?? 'null');
assert(wallClock(INSTANT).includes('11:30 PM'), 'PST wall-clock time', wallClock(INSTANT));
const pstSections = buildDaySections([noteEvent(INSTANT)], '2026-09-21');
assert(pstSections.length === 1 && pstSections[0].key === 'day-2026-09-21', 'PST day group');
assert(pstSections[0].title === 'Today', 'PST group label is Today', pstSections[0].title);

process.env.TZ = 'America/New_York';
assert(localDayISO(INSTANT) === '2026-09-22', 'EST local day', localDayISO(INSTANT) ?? 'null');
assert(wallClock(INSTANT).includes('2:30 AM'), 'EST wall-clock time', wallClock(INSTANT));
const estSections = buildDaySections([noteEvent(INSTANT)], '2026-09-22');
assert(estSections.length === 1 && estSections[0].key === 'day-2026-09-22', 'EST day group');
assert(estSections[0].title === 'Today', 'EST group label is Today', estSections[0].title);
assert(
  formatDayGroupLabel('2026-09-21', '2026-09-22') === 'Yesterday',
  'relative label stays consistent',
);

// --- 2. Timezone change while the app is "open" --------------------------
// Simulates the app's memoization: sections recompute only when the
// timezone version changes (the fix), not on every render.
__resetTimezoneForTests();
process.env.TZ = 'America/Los_Angeles';
let pstReader = 'America/Los_Angeles';
const reader = (): string => pstReader;

assert(getDeviceTimeZone(reader) === 'America/Los_Angeles', 'device zone read');
assert(checkTimezoneNow(reader) === false, 'first check initializes, no change');
assert(getTimezoneVersion() === 0, 'version starts at 0');
assert(checkTimezoneNow(reader) === false, 'same zone is a no-op');

let notified = 0;
const unsub = subscribeToTimezoneChanges(() => {
  notified += 1;
});

// The app's cached sections, keyed the way logs.tsx / PartnerHomeScreen do.
let cached: { version: number; key: string } | null = null;
function appSections(): { version: number; key: string } {
  if (cached && cached.version === getTimezoneVersion()) return cached;
  const sections = buildDaySections([noteEvent(INSTANT)], '2026-09-21');
  cached = { version: getTimezoneVersion(), key: sections[0]?.key ?? '' };
  return cached;
}

assert(appSections().key === 'day-2026-09-21', 'app shows PST group while in PST');

// She lands in EST. The zone flips, but nothing has run the check yet.
pstReader = 'America/New_York';
process.env.TZ = 'America/New_York';
assert(
  appSections().key === 'day-2026-09-21',
  'control: without the check, cached sections stay stale (the bug)',
);
assert(notified === 0, 'control: no notification before the check runs');

// The fix's wiring: the foreground/focus/interval check runs.
assert(checkTimezoneNow(reader) === true, 'check detects the zone change');
assert(getTimezoneVersion() === 1, 'version bumps on zone change');
assert(notified === 1, 'subscribers are notified of the change');
assert(
  appSections().key === 'day-2026-09-22',
  'after the check, sections recompute in the new zone',
  appSections().key,
);
assert(
  wallClock(INSTANT).includes('2:30 AM'),
  'after the check, wall-clock renders in the new zone',
  wallClock(INSTANT),
);
assert(checkTimezoneNow(reader) === false, 'second check after change is a no-op');
assert(getTimezoneVersion() === 1, 'version does not bump twice');
unsub();

// --- 3. Robustness -------------------------------------------------------
__resetTimezoneForTests();
assert(
  checkTimezoneNow(() => {
    throw new Error('no Intl');
  }) === false,
  'throwing reader never throws',
);
assert(getTimezoneVersion() === 0, 'throwing reader does not bump version');

// First read returns undefined (platform exposes no zone): that must be
// the initialization, not a "seen zone" — a later valid zone is a real
// change and must bump the version. (Sentinel regression: the old code
// used `lastZone === undefined` as the uninitialized sentinel, so a valid
// zone arriving after an undefined first read was swallowed as another
// initialization and the recompute never fired.)
__resetTimezoneForTests();
let flipReader: string | undefined;
assert(checkTimezoneNow(() => flipReader) === false, 'undefined first read initializes');
assert(getTimezoneVersion() === 0, 'undefined first read does not bump version');
let sentinelNotified = 0;
const unsub2 = subscribeToTimezoneChanges(() => {
  sentinelNotified += 1;
});
flipReader = 'America/New_York';
assert(checkTimezoneNow(() => flipReader) === true, 'valid zone after undefined read is a change');
assert(getTimezoneVersion() === 1, 'version bumps on the late-arriving zone');
assert(sentinelNotified === 1, 'subscribers fire for the late-arriving zone');
unsub2();
assert(
  typeof getDeviceTimeZone() === 'string' || getDeviceTimeZone() === undefined,
  'default reader returns a zone name or undefined, never throws',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
