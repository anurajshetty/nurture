/**
 * Unit tests: the optional baby name (Anuraj, Sept 2026).
 *
 * - withBabyName: pure {Name}/{name} token substitution.
 * - Curated-content audit: no delight bank, size entry, or matrix row may
 *   contain a hardcoded personal name — the name (or the generic fallback) is
 *   substituted on-device at briefing assembly.
 *
 * Pure logic only — no network, no SQLite. Run with:
 *
 *   npx tsc tests/baby_name.test.ts src/briefing/context.ts src/briefing/delight.ts \
 *     src/briefing/matrix.ts src/theme/tokens.ts src/lib/types.ts src/onboarding/dates.ts \
 *     --outDir /tmp/nurture-babyname-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-babyname-tests/tests/baby_name.test.js
 */

import {
  BABY_NAME_TOKEN,
  BABY_NAME_TOKEN_CAP,
  withBabyName,
} from '../src/briefing/context';
import {
  FACTS,
  PARTNER_TIPS,
  ROTATING_TITLES,
  SIZE_BY_WEEK,
  STORIES,
  TRADITIONS,
  type DelightBody,
} from '../src/briefing/delight';
import {
  CURATED_WEEKS,
  FALLBACK_ROW,
  getMatrixRow,
} from '../src/briefing/matrix';

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
    console.log(`FAIL ${name}\n  actual:   ${a}\n  expected: ${e}`);
  }
}

function bodyText(body: DelightBody): string {
  return body.map((para) => para.map((run) => run.text).join('')).join('\n');
}

// --- withBabyName ---------------------------------------------------------
{
  check('name set, capitalized token', withBabyName('{Name} is growing.', 'Wren'), 'Wren is growing.');
  check('name set, lowercase token', withBabyName('and {name} has been tasting.', 'Wren'), 'and Wren has been tasting.');
  check('possessive rides along', withBabyName("{Name}'s grip is strong.", 'Wren'), "Wren's grip is strong.");
  check('mid-sentence possessive', withBabyName("early term — {name}'s organs are ready.", 'Wren'), "early term — Wren's organs are ready.");
  check(
    'no name → generic fallback',
    withBabyName('{Name} is growing and {name} is loved.', null),
    'Your baby is growing and your baby is loved.',
  );
  check('blank name → generic fallback', withBabyName('{Name} is growing.', '   '), 'Your baby is growing.');
  check('undefined → generic fallback', withBabyName('How big is {name}?', undefined), 'How big is your baby?');
  check('no tokens → untouched', withBabyName('Did you know?', 'Wren'), 'Did you know?');
  check('name is trimmed', withBabyName('Hello, {Name}!', '  Wren  '), 'Hello, Wren!');
  check(
    'token constants are the documented pair',
    [BABY_NAME_TOKEN_CAP, BABY_NAME_TOKEN],
    ['{Name}', '{name}'],
  );
}

// --- audit: no hardcoded personal name in curated copy --------------------
// The searched name is built from parts so the literal never appears in this
// repo — the audit still fails if the former hardcoded name is reintroduced.
const FORMER_NAME_PATTERN = new RegExp('\\b' + 'mi' + 'ra' + '\\b', 'i');
{
  const texts: string[] = [];
  for (const f of FACTS) texts.push(f.preview, bodyText(f.body));
  for (const t of TRADITIONS) texts.push(t.preview, bodyText(t.body));
  for (const s of STORIES) texts.push(s.preview, bodyText(s.body));
  for (const k of Object.keys(SIZE_BY_WEEK)) {
    const e = SIZE_BY_WEEK[Number(k)];
    texts.push(e.staple, e.delight, e.length, e.weight);
  }
  for (const t of Object.values(ROTATING_TITLES)) texts.push(t);
  for (const w of Object.keys(PARTNER_TIPS)) {
    const tip = PARTNER_TIPS[Number(w)];
    texts.push(tip.preview, bodyText(tip.body));
  }
  const rows = [...CURATED_WEEKS.map(getMatrixRow), FALLBACK_ROW];
  for (const r of rows) {
    texts.push(
      r.anchors.baby,
      r.anchors.body,
      ...r.milestones.map((m) => m.label + ' ' + m.copy),
      ...r.prep.map((p) => p.copy),
      ...(r.routineSeeds.baby ?? []),
      ...(r.routineSeeds.body ?? []),
      ...(r.routineSeeds.know ?? []),
      ...(r.routineSeeds.tips ?? []),
      r.firstTimeNote ?? '',
      r.experiencedNote ?? '',
      ...(r.delight.freshAngles ?? []),
    );
  }
  const hits = texts.filter((t) => FORMER_NAME_PATTERN.test(t));
  check('no curated string hardcodes a personal name', hits, []);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
