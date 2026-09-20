/**
 * Kick counter unit tests (Willow, Anuraj approved Sept 20, 2026).
 *
 * Pins the locked kick-counter rules at the pure-logic level:
 * - Week gate: the pill + Home card appear only at displayed week 19+.
 * - Session parsing/formatting tolerates malformed payloads.
 * - Deviation: the feed card's "Save to my next appointment" link shows
 *   ONLY for sessions that deviate from her usual pattern (notably
 *   longer or notably weaker) — never for ordinary sessions.
 * - Attachment: immediate next appointment only, max 5 per appointment,
 *   hidden when already attached or when no future appointment exists.
 * - Reminder: opt-in only — nothing schedules without her explicit "Yes".
 *
 * Pure modules only — no database, no notifications, no network. Run with:
 *
 *   npx tsc tests/kicks.test.ts --outDir /tmp/nurture-kicks-tests \
 *     --module commonjs --target es2022 --skipLibCheck --esModuleInterop \
 *     --ignoreConfig
 *   node /tmp/nurture-kicks-tests/tests/kicks.test.js
 *
 * (tsc follows the relative imports from the test file, so no other source
 * files need to be listed. TZ=UTC keeps the date math deterministic.)
 */

import {
  decideKickReminderSchedule,
} from '../src/kicks/reminder';
import {
  attachConfirmation,
  attachKick,
  detachKick,
  doctorNameFromTitle,
  isKickAttached,
  MAX_KICKS_PER_APPOINTMENT,
  nextFutureAppointment,
  readAttachedKicks,
  saveLinkVisible,
  toAttachedKick,
} from '../src/kicks/appointments';
import {
  averageDurationSec,
  deviationReason,
  isDeviating,
  MIN_PRIOR_SESSIONS,
  patternSummaryLine,
  recentKickSessions,
  usualStrength,
} from '../src/kicks/pattern';
import {
  formatDurationLong,
  formatDurationShort,
  formatElapsed,
  formatMovementsLine,
  formatStrengthNote,
  KICKS_MIN_WEEK,
  kicksVisibleForDisplayedWeek,
  readKickSession,
  readKickSessionFromData,
} from '../src/kicks/session';
import type { KickSession } from '../src/kicks/types';
import type { LocalEvent } from '../src/lib/types';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function kick(
  id: string,
  movements: number,
  durationSec: number,
  strength: KickSession['strength'],
  occurredAt: string,
): KickSession {
  return { id, movements, durationSec, strength, occurredAt };
}

function appt(id: string, occurredAt: string, data: Record<string, unknown> = {}): LocalEvent {
  return {
    id,
    userId: null,
    pregnancyId: null,
    type: 'appointment',
    occurredAt,
    visibility: 'private',
    data,
    idempotencyKey: 'k',
    deletedAt: null,
    updatedAt: occurredAt,
    createdAt: occurredAt,
    dirty: false,
  };
}

/* ------------------------------------------------------------------ */
/* Week gate                                                           */
/* ------------------------------------------------------------------ */

check('gate: week 18 hidden', kicksVisibleForDisplayedWeek(18), false);
check('gate: week 19 visible', kicksVisibleForDisplayedWeek(19), true);
check('gate: week 40 visible', kicksVisibleForDisplayedWeek(40), true);
check('gate: min week constant is 19', KICKS_MIN_WEEK, 19);

/* ------------------------------------------------------------------ */
/* Session parsing                                                     */
/* ------------------------------------------------------------------ */

const parsed = readKickSessionFromData(
  's1',
  { movements: 10, durationSec: 1080, strength: 'strong' },
  '2026-09-20T19:42:00',
);
check('parse: full payload', parsed, {
  id: 's1',
  movements: 10,
  durationSec: 1080,
  strength: 'strong',
  occurredAt: '2026-09-20T19:42:00',
});

check(
  'parse: alt spellings (count/durationMin)',
  readKickSessionFromData(
    's2',
    { count: 6, durationMin: 35 },
    '2026-09-20T19:42:00',
  ),
  {
    id: 's2',
    movements: 6,
    durationSec: 2100,
    strength: null,
    occurredAt: '2026-09-20T19:42:00',
  },
);

check('parse: missing movements → null', readKickSessionFromData('s3', {}, '2026-09-20T19:42:00'), null);
check('parse: bad strength → null strength, session survives',
  readKickSessionFromData('s4', { movements: 3, durationSec: 60, strength: 'mega' }, '2026-09-20T19:42:00')?.strength,
  null);
check('parse: non-kick event → null',
  readKickSession({ ...appt('a1', '2026-09-20T19:42:00'), type: 'note' } as LocalEvent),
  null);

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

check('fmt long: 18 minutes', formatDurationLong(1080), '18 minutes');
check('fmt long: 1 minute', formatDurationLong(60), '1 minute');
check('fmt long: 45 seconds', formatDurationLong(45), '45 seconds');
check('fmt short: 8 min', formatDurationShort(480), '8 min');
check('fmt short: 45 sec', formatDurationShort(45), '45 sec');
check(
  'fmt movements line',
  formatMovementsLine({ movements: 10, durationSec: 2400 }),
  '10 movements in 40 minutes',
);
check(
  'fmt movements line singular',
  formatMovementsLine({ movements: 1, durationSec: 30 }),
  '1 movement in 30 seconds',
);
check('fmt strength note', formatStrengthNote('fluttery'), 'Mostly fluttery.');
check('fmt strength note skipped', formatStrengthNote(null), null);
check('fmt elapsed', formatElapsed(65), '1:05');
check('fmt elapsed zero', formatElapsed(0), '0:00');

/* ------------------------------------------------------------------ */
/* Pattern math                                                        */
/* ------------------------------------------------------------------ */

const prior3 = [
  kick('p1', 10, 900, 'strong', '2026-09-18T20:00:00'),
  kick('p2', 10, 1080, 'strong', '2026-09-19T20:00:00'),
  kick('p3', 8, 1200, 'usual', '2026-09-19T08:00:00'),
];

check('average duration', averageDurationSec(prior3), 1060);
check('average duration empty', averageDurationSec([]), null);
check('usual strength (mode)', usualStrength(prior3), 'strong');
check(
  'usual strength tie → most recent wins',
  usualStrength([
    kick('a', 10, 900, 'usual', '2026-09-19T20:00:00'),
    kick('b', 10, 900, 'strong', '2026-09-18T20:00:00'),
  ]),
  'usual',
);
check('usual strength none given', usualStrength([kick('a', 10, 900, null, '2026-09-19T20:00:00')]), null);

const longSession = kick('cur', 10, 2400, 'strong', '2026-09-20T20:00:00'); // 40 min vs ~17.7 avg
const normalSession = kick('cur', 10, 1100, 'strong', '2026-09-20T20:00:00');
const weakSession = kick('cur', 6, 1000, 'fluttery', '2026-09-20T20:00:00');
const bothSession = kick('cur', 6, 2400, 'fluttery', '2026-09-20T20:00:00');

check('deviation: notably longer', deviationReason(longSession, prior3), 'longer');
check('deviation: ordinary → null', deviationReason(normalSession, prior3), null);
check('deviation: notably weaker', deviationReason(weakSession, prior3), 'weaker');
check('deviation: both → longer wins', deviationReason(bothSession, prior3), 'longer');
check('isDeviating true', isDeviating(longSession, prior3), true);
check('isDeviating false', isDeviating(normalSession, prior3), false);

check(
  'deviation: needs 2+ prior sessions',
  deviationReason(longSession, [prior3[0]]),
  null,
);
check('min prior constant is 2', MIN_PRIOR_SESSIONS, 2);

check(
  'deviation: weaker requires a known usual',
  deviationReason(
    kick('cur', 6, 1000, 'fluttery', '2026-09-20T20:00:00'),
    [
      kick('p1', 10, 900, null, '2026-09-18T20:00:00'),
      kick('p2', 10, 900, null, '2026-09-19T20:00:00'),
    ],
  ),
  null,
);

check(
  'deviation: weaker also needs 2+ prior sessions',
  deviationReason(
    kick('cur', 6, 1000, 'fluttery', '2026-09-20T20:00:00'),
    [kick('p1', 10, 900, 'strong', '2026-09-18T20:00:00')],
  ),
  null,
);

check(
  'recentKickSessions: excludes id, newest first, limited',
  recentKickSessions([...prior3, longSession], 'cur', 2).map((s) => s.id),
  ['p2', 'p3'],
);
check(
  'recentKickSessions: beforeOccurredAt scopes out newer sessions',
  recentKickSessions(
    [...prior3, longSession],
    'cur',
    5,
    '2026-09-19T08:00:00',
  ).map((s) => s.id),
  ['p3', 'p1'],
);
check(
  'recentKickSessions: beforeOccurredAt includes same-time others',
  recentKickSessions(
    [
      kick('a', 10, 900, 'strong', '2026-09-19T08:00:00'),
      kick('b', 10, 900, 'strong', '2026-09-19T08:00:00'),
    ],
    'a',
    5,
    '2026-09-19T08:00:00',
  ).map((s) => s.id),
  ['b'],
);

/* ------------------------------------------------------------------ */
/* Pattern summary line                                                */
/* ------------------------------------------------------------------ */

check(
  'pattern line',
  patternSummaryLine(prior3),
  'Usually about 15–20 minutes, most evenings.',
);
check('pattern line: <2 sessions → null', patternSummaryLine([prior3[0]]), null);
check('pattern line: empty → null', patternSummaryLine([]), null);
check(
  'pattern line: tied day-parts omit the time phrase',
  patternSummaryLine([
    kick('a', 10, 900, null, '2026-09-19T08:00:00'),
    kick('b', 10, 1200, null, '2026-09-19T20:00:00'),
  ]),
  'Usually about 15–20 minutes.',
);

/* ------------------------------------------------------------------ */
/* Appointment selection + attachment                                  */
/* ------------------------------------------------------------------ */

const NOW = new Date('2026-09-20T12:00:00').getTime();
const events: LocalEvent[] = [
  appt('past', '2026-09-10T10:00:00'),
  appt('next', '2026-10-02T10:00:00', { title: 'Appointment with Dr. Izu' }),
  appt('later', '2026-11-05T14:30:00'),
];

check('next: immediate next only', nextFutureAppointment(events, NOW)?.id, 'next');
check('next: none future → null', nextFutureAppointment([appt('past', '2026-09-10T10:00:00')], NOW), null);
check('next: empty → null', nextFutureAppointment([], NOW), null);

check('readAttachedKicks: missing → []', readAttachedKicks({}), []);
check(
  'readAttachedKicks: skips malformed',
  readAttachedKicks({ kickSessions: [{ id: 'k1' }, null, 'x'] }),
  [],
);

const attached = toAttachedKick(longSession);
check('attach: appends', attachKick([], longSession), [attached]);
check('attach: dedupes', attachKick([attached], longSession), [attached]);

const five = [0, 1, 2, 3, 4].map((i) =>
  toAttachedKick(kick(`k${i}`, 10, 900, null, '2026-09-19T20:00:00')),
);
check('cap constant is 5', MAX_KICKS_PER_APPOINTMENT, 5);
check('attach: at cap → unchanged', attachKick(five, longSession), five);
check('detach: removes', detachKick(five, 'k2').map((k) => k.id), ['k0', 'k1', 'k3', 'k4']);

const withAttached = appt('next', '2026-10-02T10:00:00', {
  kickSessions: [attached],
});
check('isKickAttached: true', isKickAttached([withAttached], longSession.id), true);
check('isKickAttached: false', isKickAttached(events, longSession.id), false);

/* saveLinkVisible — the deviation-only rule */
const linkBase = { prior: prior3, nowMs: NOW };
check(
  'link: deviating + next with room → visible',
  saveLinkVisible({ session: longSession, events, ...linkBase }),
  true,
);
check(
  'link: ordinary session → hidden',
  saveLinkVisible({ session: normalSession, events, ...linkBase }),
  false,
);
check(
  'link: no future appointment → hidden',
  saveLinkVisible({
    session: longSession,
    prior: prior3,
    events: [appt('past', '2026-09-10T10:00:00')],
    nowMs: NOW,
  }),
  false,
);
check(
  'link: next full (5) → hidden',
  saveLinkVisible({
    session: longSession,
    prior: prior3,
    events: [
      appt('next', '2026-10-02T10:00:00', { kickSessions: five }),
      appt('later', '2026-11-05T14:30:00'),
    ],
    nowMs: NOW,
  }),
  false,
);
check(
  'link: already attached → hidden',
  saveLinkVisible({
    session: longSession,
    prior: prior3,
    events: [withAttached, appt('later', '2026-11-05T14:30:00')],
    nowMs: NOW,
  }),
  false,
);
check(
  'link: weaker deviation also qualifies',
  saveLinkVisible({ session: weakSession, events, ...linkBase }),
  true,
);

/* Confirmation copy */
check(
  'confirm: with doctor',
  attachConfirmation(events[1], 'Oct 2'),
  'Added to your Oct 2 appointment with Dr. Izu',
);
check(
  'confirm: no doctor named → no invented name',
  attachConfirmation(appt('x', '2026-10-02T10:00:00', { title: 'Ultrasound' }), 'Oct 2'),
  'Added to your Oct 2 appointment',
);
check('doctor from title', doctorNameFromTitle('Appointment with Dr. Izu'), 'Dr. Izu');
check('doctor from title: none', doctorNameFromTitle('Ultrasound'), null);
check('doctor from title: missing', doctorNameFromTitle(undefined), null);

/* ------------------------------------------------------------------ */
/* Reminder consent semantics                                          */
/* ------------------------------------------------------------------ */

const decideBase = {
  enabled: true,
  hasActivePregnancy: true,
  permissionGranted: true,
  platformOS: 'ios',
};
check('reminder: opted in → schedule', decideKickReminderSchedule(decideBase), true);
check(
  'reminder: not opted in → never',
  decideKickReminderSchedule({ ...decideBase, enabled: false }),
  false,
);
check(
  'reminder: pregnancy ended → stops on its own',
  decideKickReminderSchedule({ ...decideBase, hasActivePregnancy: false }),
  false,
);
check(
  'reminder: permission denied → nothing fires',
  decideKickReminderSchedule({ ...decideBase, permissionGranted: false }),
  false,
);
check(
  'reminder: web → no-op',
  decideKickReminderSchedule({ ...decideBase, platformOS: 'web' }),
  false,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
