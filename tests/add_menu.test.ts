/**
 * Unit tests: Logs-tab Add button appointment intake helpers (Anuraj, Sept 2026).
 *
 * Pure logic only — no network, no SQLite. Run with:
 *
 *   npx tsc tests/add_menu.test.ts src/logs/appointmentInput.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-addmenu-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   env TZ=UTC node /tmp/nurture-addmenu-tests/tests/add_menu.test.js
 */
import {
  buildAppointmentInput,
  combineDateTime,
  formatTime,
  parseTimeInputValue,
  toTimeInputValue,
} from '../src/logs/appointmentInput';

declare const process: { exit(code: number): void };

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`FAIL - ${name}`);
  }
}

// combineDateTime: merges the calendar day with the time-of-day.
{
  const date = new Date(2026, 8, 25, 15, 44, 12); // time ignored
  const time = new Date(2026, 0, 2, 10, 30, 55); // day ignored
  const merged = combineDateTime(date, time);
  check('combineDateTime takes the calendar day', merged.getFullYear() === 2026 && merged.getMonth() === 8 && merged.getDate() === 25);
  check('combineDateTime takes the time-of-day', merged.getHours() === 10 && merged.getMinutes() === 30);
  check('combineDateTime zeroes seconds', merged.getSeconds() === 0 && merged.getMilliseconds() === 0);
}

// buildAppointmentInput: same contract as the Composer's appointment proposal.
{
  const date = new Date(2026, 8, 25);
  const time = new Date(2026, 8, 25, 14, 30);
  const input = buildAppointmentInput({ what: 'Growth scan', date, time, where: 'Dr. Izu · Holy Cross' });
  check('appointment type', input.type === 'appointment');
  check('appointment is private', input.visibility === 'private');
  const data = input.data as Record<string, unknown>;
  check('appointment title', data.title === 'Growth scan');
  check('appointment where becomes note + provider', data.note === 'Dr. Izu · Holy Cross' && data.provider === 'Dr. Izu · Holy Cross');
  const occurred = new Date(input.occurredAt!);
  check('appointment occurredAt merges date+time', occurred.getHours() === 14 && occurred.getMinutes() === 30 && occurred.getDate() === 25);
}
{
  // Warm defaults: untitled + no where still saves cleanly.
  const input = buildAppointmentInput({ what: '  ', date: new Date(2026, 8, 25), time: new Date(2026, 8, 25, 10, 30), where: '' });
  const data = input.data as Record<string, unknown>;
  check('blank what defaults to "Appointment"', data.title === 'Appointment');
  check('blank where is an empty note', data.note === '');
}

// toTimeInputValue / parseTimeInputValue: the web <input type="time"> seam.
{
  const d = new Date(2026, 8, 25, 9, 5);
  check('toTimeInputValue pads', toTimeInputValue(d) === '09:05');
  const base = new Date(2026, 8, 25, 0, 0);
  const parsed = parseTimeInputValue('14:30', base);
  check('parseTimeInputValue keeps the calendar day', !!parsed && parsed.getDate() === 25 && parsed.getHours() === 14 && parsed.getMinutes() === 30);
  check('parseTimeInputValue rejects garbage', parseTimeInputValue('nope', base) === null);
  check('parseTimeInputValue rejects out-of-range', parseTimeInputValue('25:99', base) === null);
}

// formatTime: human pill label, locale-proof shape.
{
  const label = formatTime(new Date(2026, 8, 25, 10, 30));
  check('formatTime looks like a time', /\d{1,2}:\d{2}/.test(label));
}

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('add_menu: all green');
