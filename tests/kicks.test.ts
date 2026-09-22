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
  weekPatternNote,
} from '../src/kicks/pattern';
import {
  formatDurationLong,
  formatDurationShort,
  formatElapsed,
  formatMovementsLine,
  formatStrengthNote,
  formatWeekSummary,
  KICKS_MIN_WEEK,
  kicksVisibleForDisplayedWeek,
  readKickSession,
  readKickSessionFromData,
  sessionsInDisplayedWeek,
} from '../src/kicks/session';
import { addDaysISO, displayWeekRange, toISODate } from '../src/onboarding/dates';
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

/* ------------------------------------------------------------------ */
/* Round 4 — persistent Home card (mockup 21 rev2)                     */
/* ------------------------------------------------------------------ */

// Due 2026-10-08 → LMP 2026-01-01; displayed week 38 = [2026-09-17, 2026-09-24).
check(
  'displayWeekRange: week 38',
  displayWeekRange('2026-10-08', 38),
  { startISO: '2026-09-17', endISO: '2026-09-24' },
);
check(
  'displayWeekRange: week 1 starts on the LMP',
  displayWeekRange('2026-10-08', 1),
  { startISO: '2026-01-01', endISO: '2026-01-08' },
);
check(
  'displayWeekRange: bad due date → null',
  displayWeekRange('not-a-date', 38),
  null,
);
check(
  'displayWeekRange: week 0 → null',
  displayWeekRange('2026-10-08', 0),
  null,
);

const week38sessions = [
  kick('in1', 10, 900, 'strong', '2026-09-17T00:00:00'), // start, inclusive
  kick('in2', 10, 900, 'strong', '2026-09-23T23:59:00'),
  kick('out-end', 10, 900, 'strong', '2026-09-24T00:00:00'), // end, exclusive
  kick('out-start', 10, 900, 'strong', '2026-09-16T23:59:00'),
];
check(
  'sessionsInDisplayedWeek: only the week’s sessions (start-inclusive, end-exclusive)',
  sessionsInDisplayedWeek(week38sessions, '2026-10-08', 38).map((s) => s.id),
  ['in1', 'in2'],
);
check(
  'sessionsInDisplayedWeek: invalid week → []',
  sessionsInDisplayedWeek(week38sessions, '2026-10-08', 0),
  [],
);

// Device-local calendar: the week filter must use the LOCAL calendar day,
// not the UTC date embedded in the ISO string. (Under the harness's TZ=UTC
// the two agree and this is a trivial pass; on any other device timezone it
// discriminates: the old .slice(0, 10) compared the UTC date and dropped
// late-night sessions from their week.)
{
  const probe = new Date();
  const behindUtc = probe.getTimezoneOffset() > 0; // e.g. America/Los_Angeles
  const aheadOfUtc = probe.getTimezoneOffset() < 0;
  if (behindUtc || aheadOfUtc) {
    // An instant whose UTC date and local date fall on different days.
    const instant = new Date();
    if (behindUtc) instant.setUTCHours(0, 30, 0, 0); // 00:30 UTC → local "yesterday"
    else instant.setUTCHours(23, 30, 0, 0); // 23:30 UTC → local "tomorrow"
    const localDay = toISODate(instant);
    const utcDay = instant.toISOString().slice(0, 10);
    check(
      'sessionsInDisplayedWeek: setup — UTC and local days differ here',
      utcDay !== localDay,
      true,
    );
    const due =
      addDaysISO(localDay, behindUtc ? 22 : 14) ?? '2026-10-08';
    // behindUtc: week 38 = [localDay+1, localDay+8) → session EXCLUDED
    //   (old code saw utcDay = localDay+1 and kept it).
    // aheadOfUtc: week 38 = [localDay-7, localDay) → session EXCLUDED
    //   (old code saw utcDay = localDay-1 and kept it).
    check(
      'sessionsInDisplayedWeek: late-night session uses the local day, not UTC',
      sessionsInDisplayedWeek(
        [kick('late', 10, 900, 'strong', instant.toISOString())],
        due,
        38,
      ).map((s) => s.id),
      [],
    );
  } else {
    check(
      'sessionsInDisplayedWeek: UTC runner — local day is the UTC date',
      sessionsInDisplayedWeek(
        [kick('late', 10, 900, 'strong', '2026-09-23T23:30:00.000Z')],
        '2026-10-08',
        38,
      ).map((s) => s.id),
      ['late'],
    );
  }
}

check(
  'formatWeekSummary: 3 sessions',
  formatWeekSummary([
    kick('a', 10, 900, 'strong', '2026-09-19T19:00:00'),
    kick('b', 10, 900, 'strong', '2026-09-20T19:00:00'),
    kick('c', 10, 900, 'strong', '2026-09-21T19:00:00'),
  ]),
  '3 sessions this week · 30 movements',
);
check(
  'formatWeekSummary: 1 session, singular',
  formatWeekSummary([kick('a', 10, 900, 'strong', '2026-09-19T19:00:00')]),
  '1 session this week · 10 movements',
);
check(
  'formatWeekSummary: 1 movement, singular',
  formatWeekSummary([kick('a', 1, 60, null, '2026-09-19T19:00:00')]),
  '1 session this week · 1 movement',
);

check(
  'weekPatternNote: 2+ sessions, clear mode',
  weekPatternNote([
    kick('a', 10, 900, 'strong', '2026-09-19T19:00:00'),
    kick('b', 10, 900, 'strong', '2026-09-20T19:30:00'),
    kick('c', 10, 900, 'strong', '2026-09-21T08:00:00'),
  ]),
  "Your baby is most active in the evening.",
);
check(
  'weekPatternNote: <2 sessions → null',
  weekPatternNote([kick('a', 10, 900, 'strong', '2026-09-19T19:00:00')]),
  null,
);
check(
  'weekPatternNote: tied day-parts → null',
  weekPatternNote([
    kick('a', 10, 900, null, '2026-09-19T08:00:00'),
    kick('b', 10, 1200, null, '2026-09-19T20:00:00'),
  ]),
  null,
);
check(
  'weekPatternNote: morning mode',
  weekPatternNote([
    kick('a', 10, 900, null, '2026-09-19T08:00:00'),
    kick('b', 10, 900, null, '2026-09-20T09:00:00'),
  ]),
  "Your baby is most active in the morning.",
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
