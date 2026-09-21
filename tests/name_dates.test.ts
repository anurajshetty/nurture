/**
 * Name-and-dates regression tests (mockup 31 — Anuraj approved Sept 21, 2026).
 *
 * Locked rules:
 *  - Due date / last-period pickers start EMPTY: no pre-filled value, no
 *    default ever counts as chosen. The helper and the action enable only
 *    after a valid date is picked.
 *  - Attempting to continue/save without a valid date shows the inline
 *    error VERBATIM: "Pick a date to continue". It clears on pick.
 *  - Birthday is fully optional and never errors.
 *  - Her name is still required to proceed.
 *
 * These tests encode the rules against the pure gating module
 * (src/onboarding/profile.ts); the interactive Playwright suite
 * (tests/interactive/name_dates_test.py) drives the real screens and is the
 * guard that fails against the pre-fix build (pre-filled defaults,
 * disabled Continue with no inline error).
 *
 * Run with:
 *   npx tsc --ignoreConfig tests/name_dates.test.ts src/onboarding/profile.ts \
 *     src/onboarding/dates.ts --outDir /tmp/nurture-name-dates-tests \
 *     --module commonjs --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-name-dates-tests/tests/name_dates.test.js
 */

import { validateDob } from '../src/onboarding/dates';
import { nameDatesView, REQUIRED_DATE_ERROR, type NameDatesInput } from '../src/onboarding/profile';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

// Fixed "today" so week numbers are deterministic.
const AS_OF = '2026-09-19';

function input(over: Partial<NameDatesInput> = {}): NameDatesInput {
  return {
    mode: 'due',
    dueISO: null,
    lmpISO: null,
    ownerName: 'Anu',
    dateAttempted: false,
    asOfISO: AS_OF,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* The verbatim locked copy                                            */
/* ------------------------------------------------------------------ */

{
  ok(REQUIRED_DATE_ERROR === 'Pick a date to continue', 'error copy: verbatim, no rewording');
}

/* ------------------------------------------------------------------ */
/* Empty by default: nothing pre-filled, helper + action gated         */
/* ------------------------------------------------------------------ */

{
  const v = nameDatesView(input());
  ok(v.dateValid === false, 'empty: no date counts as valid');
  ok(v.dateError === null, 'empty: no error before she attempts the action');
  ok(v.helper === null, 'empty: week helper hidden until a date is picked');
  ok(v.actionMuted === true, 'empty: Continue/Save renders muted');
  ok(v.canProceed === false, 'empty: cannot proceed');
  ok(v.estimatedDue === null, 'empty: no derived due date from nothing');
  ok(v.nameMissing === false, 'empty: name present here, only the date gates');
}

/* ------------------------------------------------------------------ */
/* Attempting without a date -> verbatim inline error                  */
/* ------------------------------------------------------------------ */

{
  const v = nameDatesView(input({ dateAttempted: true }));
  ok(v.dateError === REQUIRED_DATE_ERROR, 'attempt: inline error is verbatim');
  ok(v.canProceed === false, 'attempt: still cannot proceed');
  ok(v.helper === null, 'attempt: helper still hidden');
}

/* ------------------------------------------------------------------ */
/* Picking a valid date clears the error, shows the helper, enables    */
/* ------------------------------------------------------------------ */

{
  const v = nameDatesView(input({ dueISO: '2026-10-08', dateAttempted: true }));
  ok(v.dateValid === true, 'picked: valid due date');
  ok(v.dateError === null, 'picked: error cleared on pick');
  ok(
    v.helper === 'That’s week 37, day 2 — your weekly reading will match.',
    `picked: helper copy exact (got ${JSON.stringify(v.helper)})`,
  );
  ok(v.actionMuted === false, 'picked: action no longer muted');
  ok(v.canProceed === true, 'picked: can proceed with name + date');
  ok(v.estimatedDue === '2026-10-08', 'picked: estimated due is the pick');
}

/* ------------------------------------------------------------------ */
/* Implausible date: still gated, attempt still shows the error        */
/* ------------------------------------------------------------------ */

{
  const v = nameDatesView(input({ dueISO: '2026-09-01', dateAttempted: true }));
  ok(v.dateValid === false, 'implausible: not valid');
  ok(v.dateError === REQUIRED_DATE_ERROR, 'implausible: attempt shows the verbatim error');
  ok(v.helper === null, 'implausible: no week helper');
  ok(v.canProceed === false, 'implausible: cannot proceed');
}

/* ------------------------------------------------------------------ */
/* Last-period mode: Naegele estimate + helper                         */
/* ------------------------------------------------------------------ */

{
  const v = nameDatesView(input({ mode: 'lmp', lmpISO: '2026-04-01' }));
  ok(v.dateValid === true, 'lmp: valid pick');
  ok(v.estimatedDue === '2027-01-06', 'lmp: Naegele estimate derived');
  ok(
    v.helper === 'That’s week 24, day 3 — your weekly reading will match.',
    `lmp: helper copy exact (got ${JSON.stringify(v.helper)})`,
  );
  ok(v.canProceed === true, 'lmp: can proceed');
}

{
  const v = nameDatesView(input({ mode: 'lmp', dateAttempted: true }));
  ok(v.estimatedDue === null, 'lmp empty: no estimate from nothing');
  ok(v.dateError === REQUIRED_DATE_ERROR, 'lmp empty: attempt shows the verbatim error');
}

/* ------------------------------------------------------------------ */
/* Name is still required                                              */
/* ------------------------------------------------------------------ */

{
  const v = nameDatesView(input({ dueISO: '2026-10-08', ownerName: '   ' }));
  ok(v.nameMissing === true, 'name: blank counts as missing');
  ok(v.dateValid === true, 'name: date still valid');
  ok(v.canProceed === false, 'name: cannot proceed without a name');
  ok(v.actionMuted === true, 'name: action muted until she types her name');
  ok(v.dateError === null, 'name: no date error when the date is fine');
}

/* ------------------------------------------------------------------ */
/* Birthday: optional, never errors                                    */
/* ------------------------------------------------------------------ */

{
  ok(validateDob(null, AS_OF) === null, 'birthday: unset never errors');
  ok(validateDob('', AS_OF) === null, 'birthday: blank never errors');
  ok(validateDob('1996-09-27', AS_OF) === null, 'birthday: ordinary pick is fine');
  ok(
    validateDob('2030-01-01', AS_OF) !== null,
    'birthday: a future pick is rejected (only when she picked one)',
  );
  // Opening the picker and closing it without picking leaves the value
  // unset — there is no birthday error element to show anywhere.
}

console.log(`\n=== name_dates: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
