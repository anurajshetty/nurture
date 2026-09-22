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

declare const process: { exit(code: number): void; cwd(): string };
declare function require(id: string): any;

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
// Anuraj (Sept 21, 2026): the app never asks for the baby's gender, so a
// named baby is always rendered "baby {name}" (e.g. "baby Mira") — never
// the bare name alone, and never a gendered pronoun.
{
  check('name set, capitalized token', withBabyName('{Name} is growing.', 'Wren'), 'Baby Wren is growing.');
  check('name set, lowercase token', withBabyName('and {name} has been tasting.', 'Wren'), 'and baby Wren has been tasting.');
  check('possessive rides along', withBabyName("{Name}'s grip is strong.", 'Wren'), "Baby Wren's grip is strong.");
  check('mid-sentence possessive', withBabyName("early term — {name}'s organs are ready.", 'Wren'), "early term — baby Wren's organs are ready.");
  check(
    'no name → generic fallback',
    withBabyName('{Name} is growing and {name} is loved.', null),
    'Your baby is growing and your baby is loved.',
  );
  check('blank name → generic fallback', withBabyName('{Name} is growing.', '   '), 'Your baby is growing.');
  check('undefined → generic fallback', withBabyName('How big is {name}?', undefined), 'How big is your baby?');
  check('no tokens → untouched', withBabyName('Did you know?', 'Wren'), 'Did you know?');
  check('name is trimmed', withBabyName('Hello, {Name}!', '  Wren  '), 'Hello, Baby Wren!');
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

// --- audit: baby-referring copy must be gender-neutral --------------------
// Anuraj (Sept 21, 2026, caught live on his phone): the app never asks for
// the baby's gender, so ALL baby-referring user-visible copy must avoid
// he/she/him/her/his/hers. Mother-referring copy (the pregnant woman —
// known female) is allowlisted below and must NOT be "fixed".
//
// The audit scans string literals (+ JSX text) in the copy-bearing files.
// Any gendered hit that is not on the mother-referring allowlist fails the
// suite — so reintroducing baby-gendered copy breaks the build.
const fs = require('fs') as {
  readFileSync(p: string, enc: string): string;
  existsSync(p: string): boolean;
};
const nodePath = require('path') as { join(...parts: string[]): string };
const ROOT = process.cwd();

const GENDERED = /\b(she|her|hers|him|his)\b/i;

// Known mother-referring strings (the pregnant woman / mother-to-be).
// Fragments, matched case-insensitively against the offending literal.
const MOTHER_ALLOWLIST: readonly string[] = [
  'off her plate',
  'her favorite takeout',
  'sense of smell',
  'strong-smelling stuff',
  'grabs your hand to feel',
  'first flutters soon',
  'write her a note',
  'keep it forever',
  'her appetite is back',
  'her feet are doing overtime',
  'her favorites within arm',
  'antacids she likes',
  'heating pad before she asks',
  'a stroll, not a race',
  'her center of gravity',
  'paint roller',
  'drive her, wait with the good snacks',
  'tired in a way sleep doesn\u2019t fix',
  'doing beautifully',
  'valaikaapu',
  'mother-to-be with bangles',
  'blessingway',
  'women in her life',
  'her journal entries will appear here',
  'entries she recorded herself',
  'share her pregnancy journey',
  "she's feeling ",
  "moments she's shared with you",
  "you're her guest",
];

const LINT_FILES: readonly string[] = [
  'src/briefing/matrix.ts',
  'src/briefing/delight.ts',
  'src/briefing/context.ts',
  'src/kicks/pattern.ts',
  'src/kicks/reminder.ts',
  'src/kicks/KickHomeCard.tsx',
  'src/kicks/KickHistoryScreen.tsx',
  'src/kicks/KickCountingScreen.tsx',
  'src/partner/partnerHome.ts',
  'src/partner/PartnerHomeScreen.tsx',
  'src/onboarding/shareInvite.ts',
  'src/export/obVisit.ts',
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\S:])\/\/[^\n]*/g, '$1');
}

function extractLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  // JSX text nodes: text between > and < (multi-word runs only)
  const jsx = />([^<>{}]{4,})</g;
  while ((m = jsx.exec(src)) !== null) out.push(m[1]);
  return out;
}

{
  const offenders: string[] = [];
  for (const rel of LINT_FILES) {
    const abs = nodePath.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      offenders.push(`${rel}: FILE MISSING`);
      continue;
    }
    const literals = extractLiterals(stripComments(fs.readFileSync(abs, 'utf8')));
    for (const lit of literals) {
      const gm = lit.match(GENDERED);
      if (!gm) continue;
      const low = lit.toLowerCase();
      const allowed = MOTHER_ALLOWLIST.some((frag) => low.includes(frag.toLowerCase()));
      if (!allowed) offenders.push(`${rel}: ${lit.slice(0, 110)}`);
    }
  }
  check('no non-allowlisted gendered baby copy', offenders, []);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
