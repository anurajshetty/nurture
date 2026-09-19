/**
 * Epic 6 deterministic tests: neutral lock-screen copy, appointment
 * scheduling decisions, snooze logic, and question-state transitions.
 * Pure modules only — no database, no notifications, no network. Run with:
 *
 *   npx tsc tests/epic6_reminders.test.ts --outDir /tmp/nurture-epic6-tests \
 *     --module commonjs --target es2022 --skipLibCheck --esModuleInterop \
 *     --ignoreConfig
 *   node /tmp/nurture-epic6-tests/tests/epic6_reminders.test.js
 *
 * (tsc follows the relative imports from the test file, so no other source
 * files need to be listed. TZ=UTC keeps the date math deterministic.)
 */

import {
  appointmentReminderCopy,
  appointmentTitle,
  appointmentWhere,
} from '../src/notifications/reminderCopy';
import {
  adjustForQuietHours,
  planAppointmentReminders,
  type PlanInput,
} from '../src/notifications/appointments';
import {
  describeReminderResponse,
  snoozeFireAtMs,
  PAUSE_UNTIL_FAR_FUTURE,
  SNOOZE_10_ACTION,
  SNOOZE_60_ACTION,
  PAUSE_ALL_ACTION,
  DISMISS_ACTION,
  SNOOZE_MINUTES,
  SNOOZE_LONG_MINUTES,
} from '../src/notifications/snooze';
import {
  appendQuestion,
  nextQuestionState,
  readQuestionsFromData,
  replaceQuestionState,
  QUESTION_STATE_LABELS,
} from '../src/plan/questions';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function checkTrue(name: string, actual: boolean): void {
  check(name, actual, true);
}

// Fixed "now": 2026-09-22 09:00 local. Tests run under TZ=UTC.
const NOW = new Date(2026, 8, 22, 9, 0, 0).getTime();
const isoAt = (h: number, m = 0, dayOffset = 0): string => {
  const d = new Date(NOW + dayOffset * 86_400_000);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const baseInput = (): PlanInput => ({
  appointments: [],
  leadMinutes: 60,
  remindersEnabled: true,
  paused: false,
  pregnancyActive: true,
  permissionGranted: true,
  quietStart: '21:00',
  quietEnd: '08:00',
  nowMs: NOW,
});

// ---------- neutral lock-screen copy ----------

{
  // The hostile appointment: note + symptom-y fields everywhere.
  const hostile = {
    title: 'Glucose test',
    note: 'feeling nauseous and anxious, spotting again',
    text: 'terrible heartburn since lunch',
    symptoms: ['nausea', 'spotting'],
    mood: 'anxious',
    provider: 'Dr. Izu',
    place: 'Providence Holy Cross',
  };
  const copy = appointmentReminderCopy(isoAt(10, 30), hostile, NOW);
  check('copy title is neutral', copy.title, 'Appointment today');
  checkTrue('copy omits note', !copy.body.includes('nauseous'));
  checkTrue('copy omits symptoms', !copy.body.includes('spotting'));
  checkTrue('copy omits mood', !copy.body.includes('anxious'));
  checkTrue('copy omits heartburn', !copy.body.includes('heartburn'));
  checkTrue('copy omits her free-form title', !copy.body.includes('Glucose'));
  checkTrue('copy keeps provider', copy.body.includes('Dr. Izu'));
  checkTrue('copy keeps place', copy.body.includes('Providence Holy Cross'));
  checkTrue('copy promises questions', copy.body.includes('Your questions are ready for the visit.'));
}

{
  const copy = appointmentReminderCopy(isoAt(10, 30), {}, NOW);
  check('copy without provider/place has no dangling separator', copy.body.includes('·'), false);
  checkTrue('copy still promises questions', copy.body.includes('Your questions are ready'));
}

{
  check('title tomorrow', appointmentTitle(isoAt(10, 30, 1), NOW), 'Appointment tomorrow');
  check('title today (later)', appointmentTitle(isoAt(14, 0), NOW), 'Appointment today');
  const wd = new Date(isoAt(10, 30, 3)).toLocaleDateString([], { weekday: 'long' });
  check('title weekday', appointmentTitle(isoAt(10, 30, 3), NOW), `Appointment ${wd}`);
}

{
  check('where() allowlist', appointmentWhere({ provider: 'Dr. Izu', place: 'Clinic', note: 'x' }), {
    provider: 'Dr. Izu',
    place: 'Clinic',
  });
  check('where() collapses whitespace', appointmentWhere({ provider: 'Dr.\nIzu' }).provider, 'Dr. Izu');
}

// ---------- appointment scheduling decisions ----------

{
  const input = baseInput();
  input.appointments = [{ id: 'a1', occurredAt: isoAt(14, 0), data: {} }];
  const plans = planAppointmentReminders(input);
  check('one upcoming appointment → one plan', plans.length, 1);
  check('fires at lead time', plans[0]?.fireAtMs, new Date(isoAt(13, 0)).getTime());
  check('plan carries event id', plans[0]?.eventId, 'a1');
}

{
  for (const [name, patch] of [
    ['disabled', { remindersEnabled: false }],
    ['paused', { paused: true }],
    ['stopped pregnancy', { pregnancyActive: false }],
    ['no permission', { permissionGranted: false }],
  ] as Array<[string, Partial<PlanInput>]>) {
    const input = { ...baseInput(), ...patch };
    input.appointments = [{ id: 'a1', occurredAt: isoAt(14, 0), data: {} }];
    check(`nothing scheduled when ${name}`, planAppointmentReminders(input).length, 0);
  }
}

{
  const input = baseInput();
  input.appointments = [{ id: 'past', occurredAt: isoAt(8, 0), data: {} }]; // 8 AM < 9 AM now
  check('past appointment → nothing', planAppointmentReminders(input).length, 0);
}

{
  // Appointment in 30 min with a 60-min lead: the window passed → gentle nudge 1 min out.
  const input = baseInput();
  input.appointments = [{ id: 'soon', occurredAt: isoAt(9, 30), data: {} }];
  const plans = planAppointmentReminders(input);
  check('late-logged appointment still reminds', plans.length, 1);
  check('fires one minute out', plans[0]?.fireAtMs, NOW + 60_000);
}

{
  // Appointment tomorrow 10:30 AM, 60-min lead → 9:30 AM, clear of quiet hours.
  const input = baseInput();
  input.appointments = [{ id: 't', occurredAt: isoAt(10, 30, 1), data: {} }];
  const plans = planAppointmentReminders(input);
  check('fire time outside quiet hours untouched', plans[0]?.fireAtMs, new Date(isoAt(9, 30, 1)).getTime());
}

{
  // Evening appointment 10 PM, 60-min lead → 9 PM is inside quiet hours.
  // Forward shift (8 AM) would land after the visit → moves to 8:59 PM instead.
  const input = baseInput();
  input.appointments = [{ id: 'eve', occurredAt: isoAt(22, 0, 1), data: {} }];
  const plans = planAppointmentReminders(input);
  check('quiet-hour fire time moves to just before quiet hours', plans[0]?.fireAtMs, new Date(isoAt(20, 59, 1)).getTime());
}

{
  // Early appointment 7:30 AM, 60-min lead → 6:30 AM in quiet hours; shifting
  // forward to 8 AM would land after the visit → reminds the evening before.
  const input = baseInput();
  input.appointments = [{ id: 'early', occurredAt: isoAt(7, 30, 1), data: {} }];
  const plans = planAppointmentReminders(input);
  check('early visit → evening before', plans[0]?.fireAtMs, new Date(isoAt(20, 59, 0)).getTime());
}

{
  // Two appointments → sorted by fire time.
  const input = baseInput();
  input.appointments = [
    { id: 'b', occurredAt: isoAt(16, 0), data: {} },
    { id: 'a', occurredAt: isoAt(11, 0), data: {} },
  ];
  const plans = planAppointmentReminders(input);
  check('plans sorted by fire time', plans.map((p) => p.eventId), ['a', 'b']);
}

{
  // adjustForQuietHours edge cases, direct.
  const appt = new Date(isoAt(10, 0, 1)).getTime();
  check(
    'outside quiet hours → unchanged',
    adjustForQuietHours(new Date(isoAt(9, 0, 1)).getTime(), appt, '21:00', '08:00', NOW),
    new Date(isoAt(9, 0, 1)).getTime(),
  );
  check(
    'inside quiet hours → quiet end next morning',
    adjustForQuietHours(new Date(isoAt(22, 30)).getTime(), appt, '21:00', '08:00', NOW),
    new Date(isoAt(8, 0, 1)).getTime(),
  );
  const eveningAppt = new Date(isoAt(22, 0, 1)).getTime();
  check(
    'forward shift past visit → just before quiet hours',
    adjustForQuietHours(new Date(isoAt(21, 0, 1)).getTime(), eveningAppt, '21:00', '08:00', NOW),
    new Date(isoAt(20, 59, 1)).getTime(),
  );
  const earlyAppt = new Date(isoAt(7, 0, 1)).getTime();
  check(
    'early visit → previous evening',
    adjustForQuietHours(new Date(isoAt(6, 0, 1)).getTime(), earlyAppt, '21:00', '08:00', NOW),
    new Date(isoAt(20, 59, 0)).getTime(),
  );
  check(
    'backward in the past → original kept',
    adjustForQuietHours(
      new Date(isoAt(6, 0, 1)).getTime(),
      earlyAppt,
      '21:00',
      '08:00',
      new Date(isoAt(21, 30, 0)).getTime(), // 9:30 PM: the evening-before slot already passed
    ),
    new Date(isoAt(6, 0, 1)).getTime(),
  );
}

// ---------- snooze logic ----------

{
  check('snooze +10 min', snoozeFireAtMs(NOW, 10), NOW + 600_000);
  check('snooze +60 min', snoozeFireAtMs(NOW, 60), NOW + 3_600_000);
  check('negative minutes clamp to now', snoozeFireAtMs(NOW, -5), NOW);
}

{
  const data = { kind: 'appointment', appointmentId: 'a1' };
  check('snooze 10 action', describeReminderResponse(SNOOZE_10_ACTION, data), {
    kind: 'snooze',
    appointmentId: 'a1',
    minutes: SNOOZE_MINUTES,
  });
  check('snooze 60 action', describeReminderResponse(SNOOZE_60_ACTION, data), {
    kind: 'snooze',
    appointmentId: 'a1',
    minutes: SNOOZE_LONG_MINUTES,
  });
  check('pause action', describeReminderResponse(PAUSE_ALL_ACTION, data), { kind: 'pause' });
  // The pause sentinel must read as "paused" under the end-of-day nudge's
  // convention (timestamp later than Date.now()).
  check(
    'pause sentinel is later than now',
    new Date(PAUSE_UNTIL_FAR_FUTURE).getTime() > Date.now(),
    true,
  );
  check('dismiss action', describeReminderResponse(DISMISS_ACTION, data), {
    kind: 'dismiss',
    appointmentId: 'a1',
  });
  check(
    'default action (body tap) → view',
    describeReminderResponse('expo.modules.notifications.actions.DEFAULT', data),
    { kind: 'view', appointmentId: 'a1' },
  );
  check('unknown action id → view for ours', describeReminderResponse('whatever', data), {
    kind: 'view',
    appointmentId: 'a1',
  });
  check('snooze on foreign notification → ignore', describeReminderResponse(SNOOZE_10_ACTION, { kind: 'end-of-day' }), {
    kind: 'ignore',
  });
  check('view on foreign notification → ignore', describeReminderResponse(undefined, { kind: 'end-of-day' }), {
    kind: 'ignore',
  });
  check('missing data → ignore', describeReminderResponse(undefined, undefined), { kind: 'ignore' });
  check('missing appointment id → ignore', describeReminderResponse(SNOOZE_10_ACTION, { kind: 'appointment' }), {
    kind: 'ignore',
  });
}

// ---------- question states ----------

{
  check('cycle order', [
    nextQuestionState('to_ask'),
    nextQuestionState('asked'),
    nextQuestionState('answered'),
    nextQuestionState('deferred'),
    nextQuestionState('dismissed'),
  ], ['asked', 'answered', 'deferred', 'dismissed', 'to_ask']);
  check('all five states have labels', Object.keys(QUESTION_STATE_LABELS).length, 5);
  check('labels', QUESTION_STATE_LABELS, {
    to_ask: 'To ask',
    asked: 'Asked ✓',
    answered: 'Answered',
    deferred: 'Deferred',
    dismissed: 'Dismissed',
  });
}

{
  check('missing key → []', readQuestionsFromData(undefined), []);
  check('non-array → []', readQuestionsFromData({ questions: 'nope' }), []);
  check('malformed entries skipped', readQuestionsFromData({
    questions: [
      { id: 'q1', text: 'Can we review the birth plan?', state: 'to_ask' },
      null,
      'junk',
      { id: '', text: 'no id', state: 'to_ask' },
      { id: 'q2', text: '   ', state: 'asked' },
      { id: 'q3', text: 'Bad state', state: 'someday' },
      { id: 'q4', text: '  Which class do you recommend?  ', state: 'answered' },
    ],
  }), [
    { id: 'q1', text: 'Can we review the birth plan?', state: 'to_ask' },
    { id: 'q4', text: 'Which class do you recommend?', state: 'answered' },
  ]);
}

{
  const qs = [
    { id: 'q1', text: 'One', state: 'to_ask' as const },
    { id: 'q2', text: 'Two', state: 'asked' as const },
  ];
  const moved = replaceQuestionState(qs, 'q1', 'answered');
  check('state replaced', moved[0]?.state, 'answered');
  check('others untouched', moved[1]?.state, 'asked');
  check('original not mutated', qs[0]?.state, 'to_ask');
  check('unknown id → unchanged', replaceQuestionState(qs, 'nope', 'answered'), qs);
}

{
  const added = appendQuestion([], 'Is daily walking still fine?', 'qid-1');
  check('append → to_ask', added, [{ id: 'qid-1', text: 'Is daily walking still fine?', state: 'to_ask' }]);
  check('blank text → unchanged', appendQuestion(added, '   ', 'qid-2'), added);
}

// ---------- summary ----------

if (failed > 0) {
  console.error(`\n${failed} FAILED, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\nAll ${passed} Epic 6 checks passed`);
}
