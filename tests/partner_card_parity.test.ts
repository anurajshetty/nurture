/**
 * Partner-home card parity regression (Anuraj caught live on his iPhone,
 * Sept 22, 2026): partner-home cards must look EXACTLY like the
 * pregnant-user feed cards — same container, dimensions, radius, padding,
 * shadow, layout, typography, spacing, colors, per-type content — with the
 * ONLY partner-side difference being a heart in the TOP-RIGHT corner.
 *
 * The old partner home rendered its own divergent card (radius 24,
 * custom icon-tile/header/body, separate "When"/"With" table rows for
 * appointments, heart in a bottom row under a divider) and grouped
 * entries by occurredAt, so an appointment logged today but scheduled
 * tomorrow appeared under "Tuesday, Sep 22" while the rest said "Today".
 *
 * Guards:
 *  1. EventCard in partnerMode renders the SAME shared Card container
 *     as the feed's EventCard for every entry type (note, kick_session,
 *     appointment, activity, report). Without the fix the partner tree
 *     has no shared Card (it was a custom View surface).
 *  2. The heart is a top-right 44x44 corner control (position absolute,
 *     top 6, right 6 — the same corner pattern as the feed's delete x),
 *     testID `partner-heart-<id>`, and owner-only controls (delete x,
 *     share switch) never render in partnerMode.
 *  3. Appointment cards in partnerMode carry the appointment info in the
 *     feed appointment card's questions-line slot (same typography) —
 *     testID `event-card-apptinfo-<id>` — and never the partner-only
 *     When/With table layout.
 *  4. Source scans: PartnerHomeScreen renders EventCard with partnerMode,
 *     shares the feed's DayGroupHeader, groups via buildPartnerSections
 *     (the feed's buildDaySections), and defines no custom card surface
 *     (no `borderRadius: 24`, no reactRow, no When/With row markup).
 *
 * Run with:
 *
 *   npx tsc tests/partner_card_parity.test.ts --outDir /tmp/nurture-parity-tests \
 *     --module commonjs --target es2022 --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-parity-tests/tests/partner_card_parity.test.js
 */

const Module = require('module') as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};
const origLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request === 'react-native') {
    return {
      ScrollView: 'ScrollView',
      Pressable: 'Pressable',
      Text: 'Text',
      View: 'View',
      StyleSheet: { create: (s: unknown) => s },
    };
  }
  if (request === 'react-native-svg') {
    return { Path: 'Path', Svg: 'Svg', Circle: 'Circle', Text: 'Text' };
  }
  // EventCard's transitive chain needs these; module evaluation must not
  // touch native SQLite or crypto in the node test harness.
  if (request === 'expo-sqlite') return { openDatabaseSync: () => null };
  if (request === 'expo-crypto') return { digestStringAsync: async () => 'x' };
  return origLoad.call(this, request, ...rest);
};

declare const process: { exit(code: number): void; cwd(): string };
declare const require: any;

import { default as EventCard } from '../src/composer/EventCard';
import { default as Card } from '../src/components/Card';
import type { LocalEvent } from '../src/lib/types';

function makeEvent(type: string, overrides: Record<string, unknown> = {}): LocalEvent {
  return {
    id: 'evt-test-1',
    type: type as LocalEvent['type'],
    occurredAt: new Date('2026-09-22T14:00:00').toISOString(),
    createdAt: new Date('2026-09-21T19:00:00').toISOString(),
    userId: 'user-test',
    pregnancyId: 'preg-test',
    idempotencyKey: 'idem-test',
    deletedAt: null,
    visibility: 'shared',
    data: { title: 'Scan', ...(overrides.data as Record<string, unknown> | undefined) },
    ...overrides,
  } as unknown as LocalEvent;
}

type El = { type?: unknown; props?: Record<string, unknown> };

/** Depth-first walk of the returned JSX tree (function components are NOT invoked). */
function walk(el: unknown, visit: (e: El) => void): void {
  if (!el || typeof el !== 'object') return;
  const e = el as El;
  visit(e);
  const kids = (e.props?.children ?? []) as unknown;
  const list = Array.isArray(kids) ? kids : [kids];
  for (const k of list) walk(k, visit);
}

function findTestID(root: unknown, testID: string): El | null {
  let found: El | null = null;
  walk(root, (e) => {
    if (!found && e.props?.testID === testID) found = e;
  });
  return found;
}

/** Flatten a style prop (object, array, or style function) into one record. */
function flatStyle(style: unknown): Record<string, unknown> {
  const raw = typeof style === 'function' ? (style as (s: unknown) => unknown)({ pressed: false }) : style;
  const list = Array.isArray(raw) ? raw : [raw];
  const out: Record<string, unknown> = {};
  for (const s of list) {
    if (s && typeof s === 'object') Object.assign(out, s);
  }
  return out;
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    console.log(`FAIL - ${name}${detail === undefined ? '' : ' :: ' + String(detail).slice(0, 200)}`);
    failures++;
  }
}

const PARTNER = { partnerMode: true as const, loved: false, onToggleLove: () => {} };

/* --- 1. Every entry type renders the SAME shared Card container ------ */
const types: Array<{ type: string; data: Record<string, unknown> }> = [
  { type: 'note', data: { text: 'hello' } },
  { type: 'kick_session', data: {} },
  { type: 'appointment', data: { title: 'OB visit', when: 'Tuesday, Sep 22 · 2:00 PM', provider: 'Dr. Izu' } },
  { type: 'activity', data: { activityKind: 'breathing', sessionKey: 'b1' } },
  { type: 'report', data: { reportSummary: { status: 'ready', title: 'Week 33 summary', summary: 'rest up', attachmentName: 'scan.pdf', needsAttention: false } } },
];
for (const t of types) {
  const evt = makeEvent(t.type, { data: t.data, id: `evt-${t.type}` });
  const tree = EventCard({ event: evt, ...PARTNER }) as unknown as El;
  const body = findTestID(tree, `event-card-${evt.id}`);
  check(`${t.type} partner card renders inside the shared Card container`, !!body && body.type === Card);
  // Same Card TYPE the feed's own EventCard uses (owner mode, note).
  const ownerNote = EventCard({ event: makeEvent('note', { data: { text: 'x' }, id: 'evt-owner' }) }) as unknown as El;
  const ownerBody = findTestID(ownerNote, 'event-card-evt-owner');
  check(`${t.type} partner card uses the same Card component as the feed card`, !!ownerBody && !!body && body.type === ownerBody.type);
}

/* --- 2. The heart: top-right corner, 44x44, partnerMode only --------- */
{
  const evt = makeEvent('note', { data: { text: 'x' }, id: 'evt-heart' });
  const tree = EventCard({ event: evt, ...PARTNER }) as unknown as El;
  const heart = findTestID(tree, 'partner-heart-evt-heart');
  check('heart renders in partnerMode', !!heart && heart.type === 'Pressable');
  if (heart) {
    const s = flatStyle(heart.props?.style);
    check('heart is absolutely positioned', s.position === 'absolute');
    check('heart sits in the top-right corner', s.top === 6 && s.right === 6);
    check('heart has a 44x44 hit area', s.width === 44 && s.height === 44);
  }
  const owner = EventCard({ event: evt, onCardDelete: () => {} }) as unknown as El;
  check('owner cards have no partner heart', !findTestID(owner, 'partner-heart-evt-heart'));
  check('partnerMode has no delete x', !findTestID(tree, 'event-card-delete-evt-heart'));
  check('partnerMode has no share switch', !findTestID(tree, 'event-card-share-switch-evt-heart'));
  check('partnerMode appointment is not pressable', !findTestID(EventCard({ event: makeEvent('appointment', { id: 'evt-ap' }), ...PARTNER }) as unknown as El, 'event-card-pressable-evt-ap'));
}

/* --- 3. Appointment info in the questions-line slot, no When/With --- */
{
  const evt = makeEvent('appointment', {
    id: 'evt-apptinfo',
    data: { title: 'OB visit', provider: 'Dr. Izu' },
  });
  const tree = EventCard({ event: evt, ...PARTNER }) as unknown as El;
  const info = findTestID(tree, 'event-card-apptinfo-evt-apptinfo');
  check('appointment info line renders in partnerMode', !!info);
  if (info) {
    const text = (info.props?.children ?? '') as string;
    check('info line carries when + provider', typeof text === 'string' && text.includes('Dr. Izu') && /Sep 22/.test(text), text);
  }
  check('no feed questions line in partnerMode', !findTestID(tree, 'event-card-questions-evt-apptinfo'));
  // The partner-only When/With table rows must be gone: walk every Text.
  const texts: string[] = [];
  walk(tree, (e) => {
    if (e.type === 'Text' && typeof e.props?.children === 'string') texts.push(e.props.children as string);
  });
  check('no partner-only "When"/"With" row labels', !texts.includes('When') && !texts.includes('With'), texts.join(' | ').slice(0, 200));
}

/* --- 4. Source scans: reuse, not a divergent renderer ---------------- */
{
  const fs = require('fs');
  const path = require('path');
  const screen: string = fs.readFileSync(path.join(process.cwd(), 'src', 'partner', 'PartnerHomeScreen.tsx'), 'utf8');
  const card: string = fs.readFileSync(path.join(process.cwd(), 'src', 'composer', 'EventCard.tsx'), 'utf8');
  const feed: string = fs.readFileSync(path.join(process.cwd(), 'src', 'timeline', 'TimelineList.tsx'), 'utf8');
  check('PartnerHomeScreen renders EventCard with partnerMode', /<EventCard[\s\S]*?partnerMode/.test(screen));
  check('PartnerHomeScreen reuses the feed DayGroupHeader', /from '\.\.\/timeline\/DayGroupHeader'/.test(screen));
  check('TimelineList uses the same DayGroupHeader component', /from '\.\/DayGroupHeader'/.test(feed));
  check('PartnerHomeScreen groups via buildPartnerSections (feed grouping)', /buildPartnerSections\(events\)/.test(screen));
  check('no custom card surface in PartnerHomeScreen (no radius-24 card)', !/borderRadius: 24/.test(screen));
  check('no bottom heart reaction row in PartnerHomeScreen', !/reactRow/.test(screen));
  check('EventCard exposes partnerMode', /partnerMode\??: boolean/.test(card));
  check('partner heart is the top-right corner pattern', /heartBtn: \{[\s\S]*?position: 'absolute',[\s\S]*?top: 6,[\s\S]*?right: 6/.test(card));
}

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('partner-card-parity: all checks passed');
