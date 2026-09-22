/**
 * Feed-card sharing revision regression (mockup 33B, Anuraj approved
 * Sept 21, 2026; final family-icon art — option C "ink on blush" —
 * picked Sept 21, 2026):
 *
 *  1. No per-card sharing controls render anywhere: no SharedSwitch on
 *     feed cards, no "Shared"/"Not shared" labels, no sharing captions,
 *     and EventCard/TimelineList no longer accept onSharingChange.
 *  2. Shared entries show the read-only FamilyShareIcon (ink family
 *     glyph on a blush circle, transparent outside — NO emoji) at the
 *     top-right of the card, immediately left of the delete ×.
 *  3. Unshared entries show the × alone — no icon.
 *  4. The delete × still opens confirmation (onCardDelete fires with the
 *     event); the icon is NOT interactive (not inside a Pressable).
 *  5. New-log and appointment sheets have no sharing switch — they show
 *     the quiet "Shared with your partners" status line.
 *  6. Non-shareable card types and partner cards show no icon.
 *
 * Components are invoked directly with stubbed React hooks (the repo's
 * established pattern: function components are NOT rendered, the JSX
 * tree is walked).
 *
 * Run with:
 *
 *   npx tsc tests/family_share_icon.test.ts --outDir /tmp/nurture-familyicon-tests \
 *     --module commonjs --target es2022 --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-familyicon-tests/tests/family_share_icon.test.js
 */

const Module = require('module') as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};

/* --- React hook stubs: top-level hooks run during direct invocation --- */
const noop = () => {};
const reactStub: Record<string, unknown> = {
  useState: (init: unknown) => [
    typeof init === 'function' ? (init as () => unknown)() : init,
    noop,
  ],
  useEffect: noop,
  useRef: (init: unknown) => ({ current: init }),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useReducer: (reducer: unknown, init: unknown) => [init, noop],
  Fragment: 'Fragment',
};
reactStub.default = reactStub;

const jsxFactory = (type: unknown, props: Record<string, unknown>) => ({ type, props });

const origLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request === 'react') return reactStub;
  if (request === 'react/jsx-runtime')
    return { jsx: jsxFactory, jsxs: jsxFactory, Fragment: 'Fragment' };
  if (request === 'react-native') {
    return {
      ScrollView: 'ScrollView',
      Pressable: 'Pressable',
      Text: 'Text',
      TextInput: 'TextInput',
      View: 'View',
      Modal: 'Modal',
      Animated: { Value: function () {}, View: 'Animated.View', timing: () => ({ start: noop }), spring: () => ({ start: noop }), parallel: () => ({ start: noop }) },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      Dimensions: { get: () => ({ height: 800, width: 390 }) },
      StyleSheet: {
        create: (s: unknown) => s,
        absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
      },
      Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios },
    };
  }
  if (request === 'react-native-svg') {
    return { Svg: 'Svg', Circle: 'Circle', Path: 'Path' };
  }
  if (request === 'react-native-safe-area-context') {
    return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
  }
  if (request === 'expo-router') {
    return { useRouter: () => ({ push: noop }) };
  }
  if (request === '@react-native-community/datetimepicker') {
    return { default: 'DateTimePicker' };
  }
  if (request === 'expo-sqlite') return { openDatabaseSync: () => null };
  if (request === 'expo-crypto') return { digestStringAsync: async () => 'x' };
  return origLoad.call(this, request, ...rest);
};

declare const process: { exit(code: number): void; cwd(): string };
declare const require: any;

import { default as EventCard } from '../src/composer/EventCard';
import { default as FamilyShareIcon } from '../src/components/FamilyShareIcon';
import { default as NewLogForm } from '../src/logs/NewLogForm';
import { default as AppointmentSheet } from '../src/logs/AppointmentSheet';
import type { LocalEvent } from '../src/lib/types';

type El = { type?: unknown; props?: Record<string, unknown> };

function makeEvent(type: string, overrides: Record<string, unknown> = {}): LocalEvent {
  return {
    id: 'evt-test-1',
    type: type as LocalEvent['type'],
    occurredAt: new Date('2026-09-22T14:00:00').toISOString(),
    createdAt: new Date('2026-09-22T14:00:00').toISOString(),
    userId: 'user-test',
    pregnancyId: 'preg-test',
    idempotencyKey: 'idem-test',
    deletedAt: null,
    visibility: 'shared',
    data: { text: 'hello' },
    ...overrides,
  } as unknown as LocalEvent;
}

/** Depth-first walk (function components are NOT invoked). */
function walk(el: unknown, visit: (e: El) => void): void {
  if (!el || typeof el !== 'object') return;
  const e = el as El;
  visit(e);
  const kids = (e.props?.children ?? []) as unknown;
  const list = Array.isArray(kids) ? kids : [kids];
  for (const k of list) walk(k, visit);
}

/** Walk tracking each node's ancestor chain (for interactivity checks). */
function walkParents(
  el: unknown,
  ancestors: El[],
  visit: (e: El, ancestors: El[]) => void,
): void {
  if (!el || typeof el !== 'object') return;
  const e = el as El;
  visit(e, ancestors);
  const kids = (e.props?.children ?? []) as unknown;
  const list = Array.isArray(kids) ? kids : [kids];
  for (const k of list) walkParents(k, [...ancestors, e], visit);
}

function findTestID(root: unknown, testID: string): El | null {
  let found: El | null = null;
  walk(root, (e) => {
    if (!found && e.props?.testID === testID) found = e;
  });
  return found;
}

function testIDs(root: unknown): string[] {
  const out: string[] = [];
  walk(root, (e) => {
    if (typeof e.props?.testID === 'string') out.push(e.props.testID as string);
  });
  return out;
}

/** All string children of every Text node in the tree. */
function textStrings(root: unknown): string[] {
  const out: string[] = [];
  walk(root, (e) => {
    if (e.type === 'Text' && typeof e.props?.children === 'string') {
      out.push(e.props.children as string);
    }
  });
  return out;
}

function componentName(t: unknown): string {
  if (typeof t === 'function') return (t as { name?: string }).name ?? '';
  return typeof t === 'string' ? t : '';
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

const fs = require('fs');
const path = require('path');
const src = (p: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf8');

/* --- 1. FamilyShareIcon: option-C art, no emoji ------------------------ */
{
  const icon = FamilyShareIcon({ size: 24 }) as unknown as El;
  check('FamilyShareIcon exposes the default testID', icon.props?.testID === 'family-share-icon');
  check(
    'FamilyShareIcon accessibilityLabel names the shared state',
    icon.props?.accessibilityLabel === 'Shared with partners',
  );
  check('FamilyShareIcon is not a button', icon.props?.accessibilityRole === 'image');
  let blush = false;
  let ink = false;
  walk(icon, (e) => {
    if (e.type === 'Circle' && e.props?.fill === '#F6E7DD') blush = true;
    if (e.props?.fill === '#2F2B27') ink = true;
  });
  check('family icon has the blush (#F6E7DD) filled circle', blush);
  check('family icon has the ink (#2F2B27) family glyph', ink);
  const glyphs = textStrings(icon);
  check('family icon contains no emoji', !glyphs.some((g) => /[\u{1F300}-\u{1FAFF}]/u.test(g)));
}

/* --- 2. Shared card: icon + ×, no switch, no labels -------------------- */
{
  const ev = makeEvent('note', { visibility: 'shared' });
  const tree = EventCard({ event: ev, onCardDelete: noop }) as unknown as El;
  const ids = testIDs(tree);
  const icon = findTestID(tree, `event-card-share-icon-${ev.id}`);
  check('shared card renders the family icon', !!icon && componentName(icon.type) === 'FamilyShareIcon');
  check('shared card still renders the delete ×', !!findTestID(tree, `event-card-delete-${ev.id}`));
  check(
    'no per-card share switch testID on a shared card',
    !ids.some((id) => /share-switch/.test(id)),
    ids.join(','),
  );
  check(
    'no SharedSwitch component rendered on a shared card',
    !(() => {
      let hit = false;
      walk(tree, (e) => {
        if (componentName(e.type) === 'SharedSwitch') hit = true;
      });
      return hit;
    })(),
  );
  const texts = textStrings(tree);
  check('no "Shared" label text on the card', !texts.includes('Shared'), texts.join(' | ').slice(0, 160));
  check('no "Not shared" label text on the card', !texts.includes('Not shared'));
  check('no "Shared with your partner." caption on the card', !texts.includes('Shared with your partner.'));
  // The icon is a status indicator, not a control: no Pressable ancestor.
  let iconInteractive = false;
  walkParents(
    tree,
    [],
    (e, ancestors) => {
      if (e.props?.testID === `event-card-share-icon-${ev.id}`) {
        if (ancestors.some((a) => a.type === 'Pressable')) iconInteractive = true;
      }
    },
  );
  check('family icon is not inside a Pressable', !iconInteractive);
}

/* --- 3. Unshared card: × alone, no icon -------------------------------- */
{
  const ev = makeEvent('note', { id: 'evt-test-2', visibility: 'private' });
  const tree = EventCard({ event: ev, onCardDelete: noop }) as unknown as El;
  check('unshared card renders no family icon', !findTestID(tree, `event-card-share-icon-${ev.id}`));
  check('unshared card still renders the delete ×', !!findTestID(tree, `event-card-delete-${ev.id}`));
  const texts = textStrings(tree);
  check('no "Shared" label text on an unshared card', !texts.includes('Shared'));
}

/* --- 4. Icon is scoped to shareable types ------------------------------- */
{
  // A shared mood entry is NOT a shareable card type: icon stays off.
  const ev = makeEvent('mood', { visibility: 'shared' });
  const tree = EventCard({ event: ev, onCardDelete: noop }) as unknown as El;
  check('shared non-shareable card renders no family icon', !findTestID(tree, `event-card-share-icon-${ev.id}`));
  // Kick sessions, appointments, Activity cards and reports are the
  // shareable set: a shared kick card shows the icon.
  const kick = makeEvent('kick_session', { id: 'evt-kick-1', visibility: 'shared' });
  const kickTree = EventCard({ event: kick, onCardDelete: noop }) as unknown as El;
  check('shared kick card renders the family icon', !!findTestID(kickTree, `event-card-share-icon-${kick.id}`));
  // Partner cards never show the owner-side indicator.
  const partnerTree = EventCard({
    event: makeEvent('note', { id: 'evt-p-1', visibility: 'shared' }),
    partnerMode: true,
  }) as unknown as El;
  check('partner card renders no family icon', !findTestID(partnerTree, 'event-card-share-icon-evt-p-1'));
  check('partner card renders no delete ×', !findTestID(partnerTree, 'event-card-delete-evt-p-1'));
}

/* --- 5. The × still opens delete confirmation --------------------------- */
{
  const ev = makeEvent('note', { visibility: 'shared' });
  let received: unknown = null;
  const tree = EventCard({
    event: ev,
    onCardDelete: (e: LocalEvent) => {
      received = e;
    },
  }) as unknown as El;
  const del = findTestID(tree, `event-card-delete-${ev.id}`);
  check('delete × is a Pressable button', !!del && del.type === 'Pressable' && del.props?.accessibilityRole === 'button');
  if (del && typeof del.props?.onPress === 'function') {
    (del.props.onPress as () => void)();
    check('tapping × calls onCardDelete with the event', (received as { id?: string } | null)?.id === ev.id);
  } else {
    check('tapping × calls onCardDelete with the event', false, 'no onPress on the ×');
  }
}

/* --- 6. New-log sheet: status line, no switch --------------------------- */
{
  const form = NewLogForm({ onSaved: noop, onClose: noop }) as unknown as El;
  check('new-log sheet has no share switch testID', !findTestID(form, 'new-log-share-switch'));
  const ids = testIDs(form);
  check('new-log sheet has no share-switch testID at all', !ids.some((id) => /share-switch/.test(id)), ids.join(','));
  const status = findTestID(form, 'new-log-share-status');
  check('new-log sheet shows the sharing status line', !!status);
  if (status) {
    check(
      'new-log status copy is the mockup verbatim (default ON)',
      textStrings(status).includes('Shared with your partners'),
      textStrings(status).join(' | '),
    );
  }
  const a = src('logs/NewLogForm.tsx');
  check('NewLogForm imports FamilyShareIcon', /FamilyShareIcon/.test(a));
  check('NewLogForm no longer imports SharedSwitch', !/SharedSwitch/.test(a));
  check('NewLogForm renders the OFF copy for the off state', /Only you can see this\./.test(a));
}

/* --- 7. Appointment sheet: status line, no switch ------------------------ */
{
  const sheet = AppointmentSheet({ visible: true, onClose: noop, onSaved: noop }) as unknown as El;
  check('appointment sheet has no share switch testID', !findTestID(sheet, 'appointment-share-switch'));
  const status = findTestID(sheet, 'appointment-share-status');
  check('appointment sheet shows the sharing status line', !!status);
  if (status) {
    check(
      'appointment status copy is the mockup verbatim (default ON)',
      textStrings(status).includes('Shared with your partners'),
      textStrings(status).join(' | '),
    );
  }
  const a = src('logs/AppointmentSheet.tsx');
  check('AppointmentSheet imports FamilyShareIcon', /FamilyShareIcon/.test(a));
  check('AppointmentSheet no longer imports SharedSwitch', !/SharedSwitch/.test(a));
}

/* --- 8. Sources: per-card editing path fully removed -------------------- */
{
  const card = src('composer/EventCard.tsx');
  check('EventCard no longer accepts onSharingChange', !/onSharingChange/.test(card));
  check('EventCard renders FamilyShareIcon', /FamilyShareIcon/.test(card));
  const list = src('timeline/TimelineList.tsx');
  check('TimelineList no longer accepts onSharingChange', !/onSharingChange/.test(list));
  const logs = fs.readFileSync(path.join(process.cwd(), 'app', '(tabs)', 'logs.tsx'), 'utf8') as string;
  check('logs.tsx no longer wires onSharingChange', !/onSharingChange/.test(logs));
  check('logs.tsx share-toast path is gone', !/share-toggle-toast/.test(logs));
}

/* --- 9. Kicker carries no date (Anuraj, Sept 21, 2026) -------------------- */
/* Day-group labels carry the date; the card header kicker is label-only. */
{
  const ev = makeEvent('note', { id: 'evt-kicker-1', visibility: 'shared' });
  const tree = EventCard({ event: ev, onCardDelete: noop }) as unknown as El;
  const kicker = findTestID(tree, `event-card-date-${ev.id}`);
  check('shareable card renders the kicker element', !!kicker);
  if (kicker) {
    const text = textStrings(kicker).join('');
    check('kicker has no date separator', !text.includes('·'), text);
    check(
      'kicker has no day words',
      !/today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(text),
      text,
    );
  }
  const kick = makeEvent('kick_session', { id: 'evt-kicker-2', visibility: 'shared' });
  const kickTree = EventCard({ event: kick, onCardDelete: noop }) as unknown as El;
  const kickKicker = findTestID(kickTree, `event-card-date-${kick.id}`);
  if (kickKicker) {
    const text = textStrings(kickKicker).join('');
    check('kick card kicker has no date separator', !text.includes('·'), text);
  } else {
    check('kick card kicker has no date separator', false, 'kicker element missing');
  }
}

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
} else {
  console.log('\nAll family-share-icon checks passed.');
}
