/**
 * Appointment card surface regression (Anuraj caught live, Sept 21, 2026):
 * on the Logs tab ("Your story") the APPOINTMENT card rendered FLAT on the
 * page background while every Moment card rendered inside the white rounded
 * Card container. Root cause: in src/composer/EventCard.tsx the
 * appointment-pressable branch rendered a plain View (marginBottom only)
 * instead of the shared Card component (white, 20pt radius, soft shadow).
 *
 * Guard: calling EventCard with an appointment + onAppointmentPress must
 * return a tree whose card body (testID `event-card-<id>`) has type Card —
 * the same Card type used by the non-appointment branch. Without the fix,
 * the card body's type is View (the stubbed react-native 'View' string).
 *
 * Run with:
 *
 *   npx tsc tests/event_card_appointment_surface.test.ts --outDir /tmp/nurture-card-tests \
 *     --module commonjs --target es2022 --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-card-tests/tests/event_card_appointment_surface.test.js
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
  // EventCard's transitive chain needs these; module evaluation must not
  // touch native SQLite or crypto in the node test harness.
  if (request === 'expo-sqlite') return { openDatabaseSync: () => null };
  if (request === 'expo-crypto') return { digestStringAsync: async () => 'x' };
  return origLoad.call(this, request, ...rest);
};

declare const process: { exit(code: number): void };

import { default as EventCard } from '../src/composer/EventCard';
import { default as Card } from '../src/components/Card';
import type { LocalEvent } from '../src/lib/types';

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
    data: { title: 'Scan', ...(overrides.data as Record<string, unknown> | undefined) },
    ...overrides,
  } as unknown as LocalEvent;
}

/** Find the direct child of the card wrapper that carries the card testID. */
function cardBodyOf(tree: { props: { children: unknown } }, id: string) {
  const kids = (tree.props.children ?? []) as Array<{
    type?: unknown;
    props?: { testID?: string };
  }>;
  const list = Array.isArray(kids) ? kids : [kids];
  return list.find(
    (k) => k && typeof k === 'object' && k.props && k.props.testID === `event-card-${id}`,
  );
}

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    console.log(`FAIL - ${name}`);
    failures++;
  }
}

// 1. Appointment + onAppointmentPress (the broken path): card must be Card.
const appt = makeEvent('appointment');
const apptTree = EventCard({
  event: appt,
  onAppointmentPress: () => {},
  onCardDelete: () => {},
}) as unknown as { props: { children: unknown } };
const apptBody = cardBodyOf(apptTree, appt.id);
check('appointment card (pressable) renders inside the white Card container', !!apptBody && apptBody.type === Card);

// 2. Appointment WITHOUT onAppointmentPress: also Card (control case).
const apptTree2 = EventCard({ event: appt, onCardDelete: () => {} }) as unknown as {
  props: { children: unknown };
};
const apptBody2 = cardBodyOf(apptTree2, appt.id);
check('appointment card (non-pressable) renders inside the white Card container', !!apptBody2 && apptBody2.type === Card);

// 3. Moment card: still Card (no regression to the already-correct branch).
const moment = makeEvent('note', { data: { text: 'hello' } });
const momentTree = EventCard({
  event: moment,
  onCardDelete: () => {},
}) as unknown as { props: { children: unknown } };
const momentBody = cardBodyOf(momentTree, moment.id);
check('moment card still renders inside the white Card container', !!momentBody && momentBody.type === Card);

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('appointment-card-surface: all checks passed');

/* ------------------------------------------------------------------ */
/* Compact SharedSwitch regression (Anuraj, Sept 21, 2026): feed-card
 * Shared switches render visually compact (44x26 track, 22px knob) but
 * keep a >=44pt effective tap target via hitSlop={10}. Coral ON / gray
 * OFF, role="switch", and toggle semantics are unchanged; the default
 * (partners card, global default) keeps the full 51x31 treatment.
 *
 * Guard: SharedSwitch({ compact: true }) must return a tree whose
 * Pressable has hitSlop 10 and whose track View is 44x26 with the
 * 22px knob; without the fix the track is 51x31 and hitSlop is 0.
 * ------------------------------------------------------------------ */

const SharedSwitchModule = require('../src/components/SharedSwitch') as {
  default: (props: Record<string, unknown>) => unknown;
};
const SharedSwitch = SharedSwitchModule.default;

function styleOf(el: unknown): Record<string, unknown> {
  const props = (el as { props?: { style?: unknown } }).props ?? {};
  const raw = props.style as unknown;
  const flat: Record<string, unknown> = {};
  for (const chunk of Array.isArray(raw) ? raw : [raw]) {
    if (chunk && typeof chunk === 'object') Object.assign(flat, chunk);
  }
  return flat;
}

function checkSwitch(compact: boolean) {
  const label = compact ? 'compact' : 'default';
  const tree = SharedSwitch({
    value: true,
    onChange: () => {},
    accessibilityLabel: 'Share this moment with your partner',
    ...(compact ? { compact: true } : {}),
  }) as {
    type: string;
    props: {
      style?: unknown;
      hitSlop?: unknown;
      accessibilityRole?: unknown;
      children?: unknown;
    };
  };
  const pressStyle = styleOf(tree);
  const hitSlop = tree.props.hitSlop;
  const track = tree.props.children as { props: { children?: unknown } };
  const trackStyle = styleOf(track);
  const knob = (track.props.children ?? {}) as { props: Record<string, unknown> };
  const knobStyle = styleOf(knob);

  const wantW = compact ? 44 : 51;
  const wantH = compact ? 26 : 31;
  check(
    `SharedSwitch ${label}: track is ${wantW}x${wantH}`,
    trackStyle.width === wantW && trackStyle.height === wantH,
  );

  const wantKnob = compact ? 22 : 27;
  check(
    `SharedSwitch ${label}: knob is ${wantKnob}px`,
    knobStyle.width === wantKnob && knobStyle.height === wantKnob,
  );

  const wantSlop = compact ? 10 : 0;
  check(`SharedSwitch ${label}: hitSlop is ${wantSlop}`, hitSlop === wantSlop);

  check(
    `SharedSwitch ${label}: role=switch kept`,
    tree.props.accessibilityRole === 'switch',
  );

  // ON track color stays coral #E8927C in both modes.
  check(
    `SharedSwitch ${label}: ON track color is coral #E8927C`,
    String(trackStyle.backgroundColor).toLowerCase() === '#e8927c',
  );

  // Effective tap target stays >= 44pt (button size + hitSlop).
  const bw = (pressStyle.width as number) ?? 0;
  const bh = (pressStyle.height as number) ?? 0;
  const hs = typeof hitSlop === 'number' ? hitSlop * 2 : 0;
  check(
    `SharedSwitch ${label}: effective tap target >= 44pt`,
    bw + hs >= 44 && bh + hs >= 44,
  );
}

checkSwitch(false);
checkSwitch(true);

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
