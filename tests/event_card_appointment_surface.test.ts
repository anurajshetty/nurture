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
  onSharingChange: () => {},
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
  onSharingChange: () => {},
}) as unknown as { props: { children: unknown } };
const momentBody = cardBodyOf(momentTree, moment.id);
check('moment card still renders inside the white Card container', !!momentBody && momentBody.type === Card);

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('appointment-card-surface: all checks passed');
