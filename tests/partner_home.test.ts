// tests/partner_home.test.ts — partner home pure logic (mockup 34).
// Run: npx tsc --ignoreConfig tests/partner_home.test.ts src/partner/partnerHome.ts src/partner/inviteCodes.ts --outDir /tmp/ph --module commonjs --target es2022 --skipLibCheck --esModuleInterop && env TZ=America/Los_Angeles node /tmp/ph/tests/partner_home.test.js
// (Also covered by tests/run_unit.sh.)
import {
  buildAtAGlance,
  contractionSummaryLine,
  contractionWave,
  getPartnerOwnerName,
  glanceDayWord,
  lovedByLabel,
  mapSharedEventRow,
  myLoveLabel,
  PARTNER_OWNER_NAME_FALLBACK,
  sortSharedNewest,
  type PartnerSharedEvent,
} from '../src/partner/partnerHome';

declare const process: { cwd(): string; exit(code: number): void };
declare const require: any;

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${detail === undefined ? '' : JSON.stringify(detail)}`);
  }
}

function ev(over: Partial<PartnerSharedEvent> = {}): PartnerSharedEvent {
  return {
    id: `e${Math.random()}`,
    type: 'note',
    occurredAt: '2026-09-21T19:00:00-07:00',
    data: {},
    lovedByMe: false,
    ...over,
  };
}

/* --- mapSharedEventRow ------------------------------------------------ */
{
  check('row maps', mapSharedEventRow({ id: 'a', type: 'note', occurred_at: '2026-09-21T19:00:00Z', data: { mood: 'tired' } })?.data.mood === 'tired');
  check('JSON-string data parses', mapSharedEventRow({ id: 'a', type: 'note', occurred_at: '2026-09-21T19:00:00Z', data: '{"mood":"tired"}' })?.data.mood === 'tired');
  check('missing id -> null', mapSharedEventRow({ type: 'note', occurred_at: 'x' }) === null);
  check('missing type -> null', mapSharedEventRow({ id: 'a', occurred_at: 'x' }) === null);
  check('garbage -> null', mapSharedEventRow(null) === null && mapSharedEventRow(42) === null);
}

/* --- sortSharedNewest ------------------------------------------------- */
{
  const a = ev({ id: 'a', occurredAt: '2026-09-20T10:00:00Z' });
  const b = ev({ id: 'b', occurredAt: '2026-09-21T10:00:00Z' });
  const c = ev({ id: 'c', occurredAt: '2026-09-19T10:00:00Z' });
  check('newest first', sortSharedNewest([a, b, c]).map((e) => e.id).join(',') === 'b,a,c');
}

/* --- glanceDayWord ---------------------------------------------------- */
{
  check('today -> tonight', glanceDayWord('2026-09-21', '2026-09-21') === 'tonight');
  check('yesterday -> last night', glanceDayWord('2026-09-20', '2026-09-21') === 'last night');
  check('older -> on Friday', glanceDayWord('2026-09-18', '2026-09-21') === 'on Friday');
}

/* --- buildAtAGlance --------------------------------------------------- */
{
  const now = new Date('2026-09-21T21:00:00-07:00');
  // Mockup shape: a mood log, an appointment tomorrow, a kick session.
  const events = [
    ev({ id: 'm1', type: 'note', occurredAt: '2026-09-21T19:00:00-07:00', data: { mood: 'heavy but happy', text: 'hello' } }),
    ev({ id: 'a1', type: 'appointment', occurredAt: '2026-09-22T14:00:00-07:00', data: { title: 'OB visit' } }),
    ev({ id: 'k1', type: 'kick_session', occurredAt: '2026-09-21T18:00:00-07:00', data: { movements: 10, durationMin: 12 } }),
  ];
  const g = buildAtAGlance(events, 'Sushmitha', now);
  check('mood line', g.moodLine === "She's feeling heavy but happy tonight. A slower evening — worth an extra bit of love.", g.moodLine);
  check('next-up line', g.nextUpLine === 'Next up: OB visit, tomorrow at 2:00 PM', g.nextUpLine);
  check('highlight line', g.highlightLine === '10 little kicks tonight', g.highlightLine);
}
{
  const now = new Date('2026-09-21T21:00:00-07:00');
  const g = buildAtAGlance([], 'Sushmitha', now);
  check('quiet-day fallback', g.moodLine === "A quiet day in Sushmitha's world.", g.moodLine);
  check('no-calendar fallback', g.nextUpLine === 'Nothing on the calendar — just the everyday', g.nextUpLine);
  check('no highlight', g.highlightLine === null);
}
{
  // Only shared entries feed the glance: the nearest FUTURE appointment.
  const now = new Date('2026-09-21T21:00:00-07:00');
  const g = buildAtAGlance(
    [
      ev({ id: 'past', type: 'appointment', occurredAt: '2026-09-20T14:00:00-07:00', data: { title: 'Old' } }),
      ev({ id: 'fut', type: 'appointment', occurredAt: '2026-09-25T10:00:00-07:00', data: { title: 'Growth scan' } }),
    ],
    'Sushmitha',
    now,
  );
  check('nearest future appointment', g.nextUpLine === 'Next up: Growth scan, Friday at 10:00 AM', g.nextUpLine);
}
{
  // Yesterday's mood gets the "last night" word.
  const now = new Date('2026-09-21T21:00:00-07:00');
  const g = buildAtAGlance(
    [ev({ type: 'note', occurredAt: '2026-09-20T22:00:00-07:00', data: { mood: 'sleepy' } })],
    'Sushmitha',
    now,
  );
  check('last-night mood', g.moodLine === "She's feeling sleepy last night.", g.moodLine);
}
{
  // Hard-day moods earn the tender suffix; bright ones don't.
  const now = new Date('2026-09-21T21:00:00-07:00');
  const mk = (mood: string) =>
    buildAtAGlance([ev({ type: 'note', occurredAt: '2026-09-21T19:00:00-07:00', data: { mood } })], 'Sushmitha', now).moodLine;
  check('rough -> tender suffix', mk('Rough').endsWith('worth an extra bit of love.'), mk('Rough'));
  check('radiant -> no suffix', !mk('Radiant').includes('extra bit of love'), mk('Radiant'));
}

/* --- contraction wave -------------------------------------------------- */
{
  const w = contractionWave(12, 3600, '2026-09-21T19:00:00-07:00');
  check('12 bumps', w?.bumps.length === 12);
  check('end label', w?.endLabel === '7:00 PM', w?.endLabel);
  check('start label', w?.startLabel === '6:00 PM', w?.startLabel);
  check('summary', contractionSummaryLine(12, 300) === '12 contractions, most about 5 minutes apart.');
  check('single', contractionSummaryLine(1, 90) === '1 contraction, most about 2 minutes apart.');
  check('no interval', contractionSummaryLine(6, null) === '6 contractions this time.');
  check('zero count -> null', contractionWave(0, 60, '2026-09-21T19:00:00-07:00') === null);
}

/* --- loved-by copy ----------------------------------------------------- */
{
  check('one', lovedByLabel(['Sam']) === 'Loved by Sam');
  check('two', lovedByLabel(['Sam', 'Noor']) === 'Loved by Sam and Noor');
  check('three', lovedByLabel(['Sam', 'Noor', 'Raj']) === 'Loved by Sam, Noor and one other');
  check('none', lovedByLabel([]) === '');
  check('my label', myLoveLabel('Sam') === 'Loved by Sam');
  check('my label unnamed', myLoveLabel('  ') === 'Loved');
}

/* --- partner names ------------------------------------------------------ */
{
  const store = new Map<string, string>();
  const kv = { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) };
  check('fallback owner name', getPartnerOwnerName(kv) === PARTNER_OWNER_NAME_FALLBACK);
}

/* --- wave label anchoring (visual regression guard) ----------------------
 * The wave's start/end time labels sit at the SVG's left/right edges. With
 * textAnchor="middle" the start label's first glyphs render left of x=0 and
 * get clipped by the viewport (caught on a real 390pt render: "10:02 PM"
 * showed as "0:02 PM"). The start label must anchor "start", the end
 * label "end", so both stay fully inside the visible area.
 * ------------------------------------------------------------------------ */
{
  const fs = require('fs');
  const path = require('path');
  const src: string = fs.readFileSync(path.join(process.cwd(), 'src', 'partner', 'PartnerHomeScreen.tsx'), 'utf8');
  const waveBlock = src.slice(src.indexOf('function ContractionWave'), src.indexOf('function CardBody'));
  check('wave start label anchors start (not middle)', /textAnchor="start"/.test(waveBlock) && !/textAnchor="middle"/.test(waveBlock));
  check('wave end label anchors end', /textAnchor="end"/.test(waveBlock));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
