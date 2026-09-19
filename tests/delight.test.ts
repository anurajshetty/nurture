/**
 * Unit tests: delight content selection for the enriched Home briefing.
 *
 * Pure logic only — in-memory store, injected "today". No network, no
 * SQLite, no Gemini. Run with:
 *
 *   npx tsc --ignoreConfig tests/delight.test.ts src/briefing/delight.ts \
 *     src/theme/tokens.ts \
 *     --outDir /tmp/nurture-delight-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-delight-tests/tests/delight.test.js
 */

import {
  FACTS,
  PARTNER_TIPS,
  ROTATION_ORDER,
  SIZE_BY_WEEK,
  STORIES,
  TRADITIONS,
  buildDelightCards,
  dayOfYear,
  type DelightBody,
  type DelightKind,
  type DelightStore,
} from '../src/briefing/delight';

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

function checkTrue(name: string, v: boolean, detail = ''): void {
  if (v) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function memStore(): DelightStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    get: (k: string) => (k in data ? data[k] : null),
    set: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

/** Effective rotation order: 'name' is only eligible when a baby name is set. */
function effectiveOrder(hasBabyName: boolean): DelightKind[] {
  return hasBabyName ? [...ROTATION_ORDER] : ROTATION_ORDER.filter((k) => k !== 'name');
}

/** Find a YYYY-MM-DD date in Jan 2026 whose rotating kind is `kind`. */
function dateForKind(kind: DelightKind, hasBabyName = false): string {
  const order = effectiveOrder(hasBabyName);
  for (let d = 1; d <= 31; d++) {
    const iso = `2026-01-${String(d).padStart(2, '0')}`;
    if (order[dayOfYear(iso) % order.length] === kind) {
      return iso;
    }
  }
  throw new Error(`no date found for kind ${kind} (hasBabyName=${hasBabyName})`);
}

function bodyText(body: DelightBody): string {
  return body.map((para) => para.map((run) => run.text).join('')).join('\n');
}

// --- shape: always [fact, size, rotating] ---------------------------------
{
  const cards = buildDelightCards(28, memStore(), '2026-09-18');
  check('three cards returned', cards.length, 3);
  check('first card is the fact', cards[0].kind, 'fact');
  check('second card is the size', cards[1].kind, 'size');
  checkTrue('third card is one of the rotating kinds', (ROTATION_ORDER as string[]).includes(cards[2].kind), cards[2].kind);
  check('fact title', cards[0].title, 'Did you know?');
  check('size title carries the name token', cards[1].title, 'How big is {name}?');
  check('every card has a non-empty preview', cards.every((c) => c.preview.length > 0), true);
  check('every card has body paragraphs', cards.every((c) => c.body.length > 0 && bodyText(c.body).length > 0), true);
  check('every card has tile styling', cards.every((c) => !!c.tint && !!c.glyph && !!c.glyphColor), true);
}

// --- fact is week-anchored ---------------------------------------------------
{
  const cards = buildDelightCards(28, memStore(), '2026-09-18');
  const previews = FACTS.filter(
    (f) => f.weeks && 28 >= f.weeks[0] && 28 <= f.weeks[1],
  ).map((f) => f.preview);
  checkTrue(
    'week-28 fact comes from the week-28-anchored pool',
    previews.includes(cards[0].preview),
    `preview=${cards[0].preview}`,
  );
}

// --- size mapping + clamping --------------------------------------------------
{
  const size28 = buildDelightCards(28, memStore(), '2026-09-18')[1];
  checkTrue('week 28 size is the bowling pin', size28.preview.includes('bowling pin'), size28.preview);
  const sizeLow = buildDelightCards(8, memStore(), '2026-09-18')[1];
  check('week 8 clamps to week 12', sizeLow.preview, buildDelightCards(12, memStore(), '2026-09-18')[1].preview);
  const sizeHigh = buildDelightCards(44, memStore(), '2026-09-18')[1];
  check('week 44 clamps to week 40', sizeHigh.preview, buildDelightCards(40, memStore(), '2026-09-18')[1].preview);
  checkTrue('every size week 12-40 has an entry', Object.keys(SIZE_BY_WEEK).length === 29, String(Object.keys(SIZE_BY_WEEK).length));
}

// --- rotation: without a name, the 4 non-name kinds take turns ---------------
// --- ('name' is gated out); with a name, all 5 kinds rotate ------------------
{
  const kinds = new Set<DelightKind>();
  for (let d = 1; d <= 4; d++) {
    const iso = `2026-01-${String(d).padStart(2, '0')}`;
    kinds.add(buildDelightCards(28, memStore(), iso)[2].kind);
  }
  check(
    '4 consecutive days cover the 4 non-name kinds when no name is set',
    [...kinds].sort(),
    [...effectiveOrder(false)].sort(),
  );
  checkTrue('no name card without a name', ![...kinds].includes('name'));
  const named = new Set<DelightKind>();
  for (let d = 1; d <= 5; d++) {
    const iso = `2026-01-${String(d).padStart(2, '0')}`;
    named.add(buildDelightCards(28, memStore(), iso, { hasBabyName: true })[2].kind);
  }
  check(
    '5 consecutive days cover all 5 kinds when a name is set',
    [...named].sort(),
    [...ROTATION_ORDER].sort(),
  );
}

// --- rotation: same day is idempotent (no double-advance) -----------------------
{
  const store = memStore();
  const first = buildDelightCards(28, store, '2026-03-10');
  const second = buildDelightCards(28, store, '2026-03-10');
  check('same day returns the same rotating card', second[2].id, first[2].id);
  check('same day returns the same preview', second[2].preview, first[2].preview);
}

// --- rotation: per-kind cursor advances without immediate repeats --------------
{
  const store = memStore();
  const kind = 'tradition';
  const d1 = dateForKind(kind);
  // The same kind recurs every effectiveOrder.length days (dayOfYear % N).
  const period = effectiveOrder(false).length;
  const dt = new Date(2026, 0, Number(d1.slice(8)) + period);
  const d2 = `2026-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const first = buildDelightCards(28, store, d1)[2];
  const second = buildDelightCards(28, store, d2)[2];
  check(`kind repeats every ${period} days without a name set`, second.kind, kind);
  checkTrue(
    'item advances — no immediate repeat within the bank',
    second.preview !== first.preview,
    `both=${first.preview}`,
  );
  checkTrue('tradition bank has depth', TRADITIONS.length >= 8, String(TRADITIONS.length));
  checkTrue('story bank has depth', STORIES.length >= 6, String(STORIES.length));
}

// --- partner tip: per-week, neutral voice ---------------------------------------
{
  const iso = dateForKind('partner');
  const card = buildDelightCards(28, memStore(), iso)[2];
  check('partner card title', card.title, 'For the partner');
  checkTrue('partner tip is the week-28 tip', card.preview === PARTNER_TIPS[28].preview, card.preview);
  checkTrue('partner bank covers every week 12-40', Object.keys(PARTNER_TIPS).length === 29, String(Object.keys(PARTNER_TIPS).length));
}

// --- milestone: computed from the week -------------------------------------------
{
  const iso = dateForKind('milestone');
  const m30 = buildDelightCards(30, memStore(), iso)[2];
  check('milestone title', m30.title, 'Milestone ahead');
  checkTrue('week 30 looks ahead to week 32', m30.preview.includes('week 32'), m30.preview);
  const m38 = buildDelightCards(38, memStore(), iso)[2];
  checkTrue('week 38 looks ahead to full term', m38.preview.includes('full term'), m38.preview);
  const m20 = buildDelightCards(20, memStore(), iso)[2];
  checkTrue('week 20 looks ahead to week 24', m20.preview.includes('Week 24'), m20.preview);
}

// --- corrupt store recovers -------------------------------------------------------
{
  const store = memStore();
  store.set('delight.v1', 'not-json{{{');
  const cards = buildDelightCards(28, store, '2026-09-18');
  check('corrupt rotation state still returns 3 cards', cards.length, 3);
}

// --- content guard: hard rules ----------------------------------------------------
{
  const banned = ['diagnos', 'prescrib', 'warning sign', 'you must', 'you should not', 'risk of'];
  const texts: string[] = [];
  for (const f of FACTS) texts.push(f.preview, bodyText(f.body));
  for (const t of TRADITIONS) texts.push(t.preview, bodyText(t.body));
  for (const s of STORIES) texts.push(s.preview, bodyText(s.body));
  for (const w of Object.keys(PARTNER_TIPS)) {
    const tip = PARTNER_TIPS[Number(w)];
    texts.push(tip.preview, bodyText(tip.body));
  }
  const hits = texts.filter((t) => banned.some((b) => t.toLowerCase().includes(b)));
  check('no bank entry breaks the medical-boundary rules', hits, []);
  checkTrue('fact bank has depth', FACTS.length >= 15, String(FACTS.length));
}

// --- name celebration: only with a name; celebrates, never invents a meaning --
{
  // Sweep many days without a name: the 'name' kind must never appear.
  let sawName = false;
  for (let d = 1; d <= 31; d++) {
    const iso = `2026-03-${String(d).padStart(2, '0')}`;
    if (buildDelightCards(28, memStore(), iso)[2].kind === 'name') sawName = true;
  }
  check('no name kind across 31 days without a name', sawName, false);

  // With a name: the celebration card appears, carries tokens, invents nothing.
  const iso = dateForKind('name', true);
  const card = buildDelightCards(28, memStore(), iso, { hasBabyName: true })[2];
  check('name card kind', card.kind, 'name');
  check('name card title', card.title, "Your baby's name");
  check('name card preview carries the token', card.preview, 'You chose {name} ♥…');
  const body = bodyText(card.body);
  checkTrue('name card body carries the token', body.includes('{Name}'), body);
  checkTrue(
    'name card invents no meaning',
    !/means|meaning|for “|for "/.test(body),
    body,
  );
  // Built from parts so the literal never appears in this repo; still fails
  // if the former hardcoded name is reintroduced into curated copy.
  checkTrue('name card has no hardcoded name', !new RegExp('\\b' + 'mi' + 'ra' + '\\b', 'i').test(body), body);
}

// --- dayOfYear sanity ---------------------------------------------------------------
{
  check('dayOfYear jan 1', dayOfYear('2026-01-01'), 1);
  check('dayOfYear dec 31 (non-leap)', dayOfYear('2026-12-31'), 365);
  check('dayOfYear garbage', dayOfYear('nope'), 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
