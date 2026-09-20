/**
 * Onboarding profile tests (Sept 2026): her name + birthday storage and
 * the partner-invite share handoff from onboarding Screen 2.
 *
 * - validateDob(): birthday bounds (real date, not future, not ancient).
 * - detectContactKind(): email-or-phone auto-detect heuristic.
 * - buildInviteMessage()/buildInviteSubject()/buildMailtoUrl()/buildSmsUrl():
 *   the exact warm message and handoff targets (the screen fires them
 *   through Share / Linking; the interactive suite asserts the boundary).
 * - applySchema(): the v4 migration adds owner_name + dob to the
 *   pregnancies table on legacy databases and leaves fresh ones alone.
 *
 * Pure modules only; no native modules, no network.
 *
 * Run with:
 *   npx tsc tests/onboarding_profile.test.ts src/onboarding/dates.ts \
 *     src/onboarding/shareInvite.ts src/lib/schema.ts \
 *     --outDir /tmp/nurture-onboarding-profile-tests --module commonjs \
 *     --target es2022 --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-onboarding-profile-tests/tests/onboarding_profile.test.js
 */

import { validateDob } from '../src/onboarding/dates';
import {
  buildInviteMessage,
  buildInviteSubject,
  buildMailtoUrl,
  buildSmsUrl,
  detectContactKind,
} from '../src/onboarding/shareInvite';
import { applySchema, type SyncDbHandle } from '../src/lib/schema';

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

/* ------------------------------------------------------------------ */
/* validateDob                                                         */
/* ------------------------------------------------------------------ */

{
  // Fixed "today" so the bounds are deterministic.
  const TODAY = '2026-09-19';
  ok(validateDob('1990-04-12', TODAY) === null, 'dob: ordinary birthday is fine');
  ok(validateDob('2026-09-19', TODAY) === null, 'dob: born today is fine');
  ok(
    validateDob('2026-09-20', TODAY)?.message !== undefined,
    'dob: future date is rejected kindly',
  );
  ok(
    validateDob('1900-01-01', TODAY)?.message !== undefined,
    'dob: implausibly old date is rejected kindly',
  );
  ok(
    validateDob('not-a-date', TODAY)?.message !== undefined,
    'dob: garbage is rejected kindly',
  );
  ok(validateDob(null, TODAY) === null, 'dob: null stays null (optional everywhere)');
  ok(validateDob('1990-02-30', TODAY) !== null, 'dob: impossible calendar date is rejected');
}

/* ------------------------------------------------------------------ */
/* detectContactKind                                                   */
/* ------------------------------------------------------------------ */

{
  ok(detectContactKind('  ') === null, 'contact: blank is null (optional field)');
  ok(detectContactKind('') === null, 'contact: empty is null');
  ok(detectContactKind('ana@example.com') === 'email', 'contact: plain email detected');
  ok(
    detectContactKind('  Ana@Example.COM  ') === 'email',
    'contact: email with case/whitespace detected',
  );
  ok(detectContactKind('not-an-email@') === null, 'contact: broken email is invalid');
  ok(detectContactKind('+1 (415) 555-0132') === 'phone', 'contact: formatted phone detected');
  ok(detectContactKind('4155550132') === 'phone', 'contact: bare digits detected');
  ok(detectContactKind('12345') === null, 'contact: too few digits is invalid');
  ok(detectContactKind('hello') === null, 'contact: plain word is invalid');
}

/* ------------------------------------------------------------------ */
/* Invite message + handoff targets                                    */
/* ------------------------------------------------------------------ */

const URL = 'https://nurture.app/join/8f3k-29dx-qw';

{
  const withName = buildInviteMessage('Priya', URL);
  ok(withName.includes('Priya'), 'invite message: uses her name when set');
  ok(withName.includes(URL), 'invite message: carries the invite link');
  ok(!withName.includes('{') && !withName.includes('}'), 'invite message: no template tokens leak');
  ok(!withName.includes(';'), 'invite message: no semicolons');

  const noName = buildInviteMessage(null, URL);
  ok(noName.includes(URL), 'invite message: nameless fallback still carries the link');
  ok(!noName.includes('null') && !noName.includes('undefined'), 'invite message: nameless fallback is clean');

  const blankName = buildInviteMessage('   ', URL);
  ok(blankName === noName, 'invite message: blank name falls back');

  ok(
    buildInviteSubject('Priya') === 'Priya invited you to share her pregnancy journey',
    'invite subject: warm, with her name',
  );
  ok(
    buildInviteSubject(null) === 'An invitation to share a pregnancy journey',
    'invite subject: nameless fallback',
  );

  const mailto = buildMailtoUrl('ana@example.com', 'Hello there', 'Line one & two');
  ok(
    mailto ===
      'mailto:ana@example.com?subject=Hello%20there&body=Line%20one%20%26%20two',
    'mailto: exact target with encoding',
  );

  const smsIos = buildSmsUrl('+14155550132', 'Hi! Join me', 'ios');
  ok(smsIos === 'sms:+14155550132&body=Hi!%20Join%20me', 'sms: iOS uses &body=');
  const smsAndroid = buildSmsUrl('+14155550132', 'Hi! Join me', 'android');
  ok(smsAndroid === 'sms:+14155550132?body=Hi!%20Join%20me', 'sms: android uses ?body=');

  // The full composed handoff a real submit produces.
  const full = buildMailtoUrl('ana@example.com', buildInviteSubject('Priya'), buildInviteMessage('Priya', URL));
  ok(full.includes(encodeURIComponent(URL)), 'composed mailto: carries the invite link');
}

/* ------------------------------------------------------------------ */
/* Schema v4 migration: owner_name + dob on pregnancies                */
/* ------------------------------------------------------------------ */

/** Minimal in-memory SyncDbHandle supporting exactly what applySchema issues. */
function fakeHandle(legacy: boolean): SyncDbHandle & { columns: string[]; meta: Map<string, string> } {
  const columns = legacy
    ? ['id', 'user_id', 'due_date', 'lmp_date', 'pregnancy_type', 'parity', 'status', 'updated_at', 'dirty']
    : ['id', 'user_id', 'due_date', 'lmp_date', 'owner_name', 'dob', 'pregnancy_type', 'parity', 'status', 'updated_at', 'dirty'];
  const meta = new Map<string, string>(legacy ? [['schema_version', '3']] : []);
  const api = {
    columns,
    meta,
    getFirstSync<T>(source: string): T | null {
      if (source.includes("key = 'schema_version'")) {
        const v = meta.get('schema_version');
        return (v === undefined ? null : ({ value: v } as unknown as T));
      }
      return null;
    },
    getAllSync<T>(source: string): T[] {
      if (source.startsWith('PRAGMA table_info(pregnancies)')) {
        return columns.map((name) => ({ name }) as unknown as T);
      }
      return [];
    },
    runSync(source: string, ...params: unknown[]): { changes: number; lastInsertRowId: number } {
      // applySchema issues INSERT OR IGNORE with a ? param; runMigrations
      // issues INSERT OR REPLACE with the version inlined as '4'.
      const m = /INSERT OR (REPLACE|IGNORE) INTO meta \(key, value\) VALUES \('schema_version', (?:\?|'4')\)/.exec(source);
      if (m) {
        const value = source.includes("'4'") ? '4' : String(params[0]);
        if (m[1] === 'REPLACE' || !meta.has('schema_version')) {
          meta.set('schema_version', value);
        }
      }
      return { changes: 0, lastInsertRowId: 0 };
    },
    execSync(source: string): void {
      const alter = /ALTER TABLE pregnancies ADD COLUMN (\w+)/.exec(source);
      if (alter && !columns.includes(alter[1])) columns.push(alter[1]);
      // CREATE TABLE IF NOT EXISTS on a fresh handle: columns already seeded.
    },
    withTransactionSync(task: () => void): void {
      task();
    },
  };
  return api;
}

{
  // Fresh database: CREATE TABLE carries the new columns, version lands on 4.
  const fresh = fakeHandle(false);
  applySchema(fresh);
  ok(fresh.columns.includes('owner_name'), 'schema: fresh db has owner_name');
  ok(fresh.columns.includes('dob'), 'schema: fresh db has dob');
  ok(fresh.meta.get('schema_version') === '5', 'schema: fresh db version is 5');

  // Legacy v3 database: migration adds both columns, bumps to 4.
  const legacy = fakeHandle(true);
  ok(!legacy.columns.includes('dob'), 'schema: legacy db starts without dob');
  applySchema(legacy);
  ok(legacy.columns.includes('owner_name'), 'schema: migration adds owner_name');
  ok(legacy.columns.includes('dob'), 'schema: migration adds dob');
  ok(legacy.meta.get('schema_version') === '4', 'schema: legacy db version becomes 4');

  // Idempotent: a second run changes nothing.
  const before = legacy.columns.length;
  applySchema(legacy);
  ok(legacy.columns.length === before, 'schema: migration is idempotent');
  ok(legacy.meta.get('schema_version') === '4', 'schema: version stays 4');
}

console.log(`\n=== onboarding_profile: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
