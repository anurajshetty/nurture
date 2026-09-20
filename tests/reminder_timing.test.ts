/**
 * Reminder timing editor tests (Anuraj-approved mockup 14, Sept 2026).
 *
 * Covers the pure timing module behind the appointment Reminder row's
 * editor sheet: preset labels, the "N hours/days before" label fallback
 * for custom values, the toast/preview copy, and the conversion between
 * stored lead-minutes and the custom stepper's { n, unit } value.
 *
 * Run with:
 *
 *   npx tsc --ignoreConfig tests/reminder_timing.test.ts src/notifications/reminderTiming.ts \
 *     --outDir /tmp/nurture-tests-rt --module commonjs --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-rt/tests/reminder_timing.test.js
 */

import {
  CUSTOM_MAX,
  CUSTOM_MIN,
  DEFAULT_REMINDER_MINUTES,
  REMINDER_PRESETS,
  clampCustomN,
  customToMinutes,
  formatLeadLabel,
  formatReminderPreview,
  formatReminderSetToast,
  minutesToCustom,
} from '../src/notifications/reminderTiming';

declare const process: { exit(code: number): void };

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Presets: the approved five, in order, 2 days the default.
check('five presets', REMINDER_PRESETS.length === 5);
check(
  'preset minutes',
  REMINDER_PRESETS.map((p) => p.minutes).join(',') === '60,180,1440,2880,10080',
);
check(
  'preset labels',
  REMINDER_PRESETS.map((p) => p.label).join(' | ') ===
    '1 hour before | 3 hours before | 1 day before | 2 days before | 1 week before',
);
check('default is 2 days', DEFAULT_REMINDER_MINUTES === 2880);

// formatLeadLabel: presets verbatim, sensible shapes otherwise.
check('label 60', formatLeadLabel(60) === '1 hour before');
check('label 180', formatLeadLabel(180) === '3 hours before');
check('label 1440', formatLeadLabel(1440) === '1 day before');
check('label 2880', formatLeadLabel(2880) === '2 days before');
check('label 10080', formatLeadLabel(10080) === '1 week before');
check('label 1 day custom', formatLeadLabel(1440) === '1 day before');
check('label 5 days', formatLeadLabel(7200) === '5 days before');
check('label 1 day singular', formatLeadLabel(1440) === '1 day before');
check('label 12 hours', formatLeadLabel(720) === '12 hours before');
check('label 1 hour singular', formatLeadLabel(60) === '1 hour before');
check('label 45 min', formatLeadLabel(45) === '45 min before');
check('label 15 min (legacy You option)', formatLeadLabel(15) === '15 min before');
check('label garbage falls back to default', formatLeadLabel(NaN) === '2 days before');
check('label zero falls back to default', formatLeadLabel(0) === '2 days before');

// Toast + preview copy.
check(
  'toast copy',
  formatReminderSetToast(180) === 'Reminder set — 3 hours before',
  formatReminderSetToast(180),
);
check(
  'preview days',
  formatReminderPreview(2, 'day') === 'We’ll remind you 2 days before.',
  formatReminderPreview(2, 'day'),
);
check(
  'preview hour singular',
  formatReminderPreview(1, 'hour') === 'We’ll remind you 1 hour before.',
  formatReminderPreview(1, 'hour'),
);
check(
  'preview hours plural',
  formatReminderPreview(12, 'hour') === 'We’ll remind you 12 hours before.',
);

// Custom stepper conversions round-trip through the presets.
const c2880 = minutesToCustom(2880);
check('2880 -> {2, day}', c2880.n === 2 && c2880.unit === 'day', JSON.stringify(c2880));
const c60 = minutesToCustom(60);
check('60 -> {1, hour}', c60.n === 1 && c60.unit === 'hour', JSON.stringify(c60));
const c10080 = minutesToCustom(10080);
check('10080 -> {7, day}', c10080.n === 7 && c10080.unit === 'day', JSON.stringify(c10080));
const c720 = minutesToCustom(720);
check('720 -> {12, hour}', c720.n === 12 && c720.unit === 'hour', JSON.stringify(c720));
check('customToMinutes 2 days', customToMinutes(2, 'day') === 2880);
check('customToMinutes 12 hours', customToMinutes(12, 'hour') === 720);
check('customToMinutes 1 hour', customToMinutes(1, 'hour') === 60);

// Clamping: 1–99, non-numeric → 1.
check('clamp 0 -> 1', clampCustomN(0) === CUSTOM_MIN);
check('clamp 100 -> 99', clampCustomN(100) === CUSTOM_MAX);
check('clamp NaN -> 1', clampCustomN(NaN) === 1);
check('clamp 5 -> 5', clampCustomN(5) === 5);
check('customToMinutes clamps', customToMinutes(0, 'day') === 1440);
check('minutesToCustom garbage -> {2, day}', JSON.stringify(minutesToCustom(NaN)) === JSON.stringify({ n: 2, unit: 'day' }));

if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
console.log('reminder_timing: all green');
