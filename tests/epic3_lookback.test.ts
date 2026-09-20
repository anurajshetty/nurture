/**
 * Epic 3.3 deterministic tests: memory look-back selection logic.
 * Pure module only — no database, no notifications, no network. Run with:
 *
 *   npx tsc --ignoreConfig tests/epic3_lookback.test.ts src/timeline/lookback.ts \
 *     src/onboarding/dates.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-lookback-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-lookback-tests/tests/epic3_lookback.test.js
 */

import type { EventType, LocalEvent } from '../src/lib/types';
import {
  LOOK_BACK_WEEKS_AGO,
  chooseLookBack,
  lookBackWeekKey,
  lookBackWindow,
} from '../src/timeline/lookback';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

let seq = 0;
function ev(over: { type: EventType; occurredAt: string; data?: Record<string, unknown>; deletedAt?: string | null }): LocalEvent {
  seq += 1;
  return {
    id: `ev-${seq}`,
    userId: 'u1',
    pregnancyId: 'p1',
    type: over.type,
    occurredAt: over.occurredAt,
    visibility: 'private',
    data: over.data ?? {},
    idempotencyKey: `k-${seq}`,
    deletedAt: over.deletedAt ?? null,
    updatedAt: '2026-09-18T00:00:00.000Z',
    createdAt: over.occurredAt,
    dirty: false,
  };
}

// Fixed "now": Friday 2026-09-18. 28 days back = 2026-08-21.
const now = new Date(2026, 8, 18, 12, 0, 0);

// ---------- window bounds ----------

{
  const w = lookBackWindow(now);
  check('window start = 31 days before', w.startISO, '2026-08-18');
  check('window end = 25 days before (exclusive)', w.endISO, '2026-08-24');
  check('window spans 6 days', w.endISO !== w.startISO, true);
}

// ---------- photo preference ----------

{
  const note = ev({
    type: 'note',
    occurredAt: '2026-08-21T10:00:00', // exactly 28 days ago
    data: { text: 'Heard the heartbeat today.' },
  });
  const photo = ev({
    type: 'photo',
    occurredAt: '2026-08-19T18:30:00', // 30 days ago — farther from 28
    data: {},
  });
  const r = chooseLookBack([note, photo], now);
  check('photo beats closer note', r?.event.id, photo.id);
  check('photo with no text → warm fallback quote', r?.quote, 'A photo from that day');
  check('weeksAgo is 4', r?.weeksAgo, 4);
  check('photo subline', r?.subline, 'Photo · Aug 19 · tap to revisit');
}

// ---------- photo via attachment (not type 'photo') ----------

{
  const plain = ev({
    type: 'note',
    occurredAt: '2026-08-21T09:00:00',
    data: { text: 'Plain note at the exact target day.' },
  });
  const withPhoto = ev({
    type: 'note',
    occurredAt: '2026-08-24T09:00:00', // outside window — should be ignored
    data: { text: 'Ignored.' },
  });
  const attached = ev({
    type: 'milestone',
    occurredAt: '2026-08-20T09:00:00', // 29 days ago
    data: {
      text: 'First bump pic.',
      attachments: [{ id: 'a1', kind: 'photo', name: 'bump.jpg', upload: 'done' }],
    },
  });
  const r = chooseLookBack([plain, withPhoto, attached], now);
  check('photo attachment beats exact-day text note', r?.event.id, attached.id);
}

// ---------- closest to 28 days ----------

{
  const far = ev({
    type: 'note',
    occurredAt: '2026-08-19T09:00:00', // 30 days ago: |30-28| = 2
    data: { text: 'Farther one.' },
  });
  const near = ev({
    type: 'note',
    occurredAt: '2026-08-22T09:00:00', // 27 days ago: |27-28| = 1
    data: { text: 'Nearer one.' },
  });
  const r = chooseLookBack([far, near], now);
  check('closest to 28 days wins', r?.event.id, near.id);
  check('quote uses her own text', r?.quote, 'Nearer one.');
  check('note subline label is Moment', r?.subline, 'Moment · Aug 22 · tap to revisit');
}

// ---------- tie: first-in wins (deterministic) ----------

{
  const a = ev({
    type: 'mood',
    occurredAt: '2026-08-19T09:00:00', // 30 days: distance 2
    data: { text: 'First.' },
  });
  const b = ev({
    type: 'mood',
    occurredAt: '2026-08-23T09:00:00', // 26 days: distance 2
    data: { text: 'Second.' },
  });
  const r = chooseLookBack([a, b], now);
  check('tie → first-in wins', r?.event.id, a.id);
  check('mood subline label', r?.subline, 'Mood · Aug 19 · tap to revisit');
}

// ---------- null cases ----------

{
  check('empty candidates → null', chooseLookBack([], now), null);
  check(
    'all out of window → null',
    chooseLookBack(
      [ev({ type: 'note', occurredAt: '2026-09-10T09:00:00', data: { text: 'Too recent.' } })],
      now,
    ),
    null,
  );
  check(
    'textless non-photo only → null',
    chooseLookBack(
      [
        ev({
          type: 'symptom',
          occurredAt: '2026-08-21T09:00:00',
          data: { symptoms: ['Heartburn'] }, // no text — not a quotable memory
        }),
      ],
      now,
    ),
    null,
  );
  check(
    'deleted events never surface',
    chooseLookBack(
      [
        ev({
          type: 'note',
          occurredAt: '2026-08-21T09:00:00',
          data: { text: 'Gone.' },
          deletedAt: '2026-09-01T00:00:00.000Z',
        }),
      ],
      now,
    ),
    null,
  );
}

// ---------- end of window is exclusive ----------

{
  const edge = ev({
    type: 'note',
    occurredAt: '2026-08-24T00:00:01', // exactly 25 days before = end bound
    data: { text: 'Right at the edge.' },
  });
  check('end bound exclusive', chooseLookBack([edge], now), null);
}

// ---------- quote truncation ----------

{
  const long = 'x'.repeat(150);
  const r = chooseLookBack(
    [ev({ type: 'note', occurredAt: '2026-08-21T09:00:00', data: { text: long } })],
    now,
  );
  check('long quote truncated to 120 + ellipsis', r?.quote.length, 121);
  check('truncated quote ends with ellipsis', r?.quote.endsWith('…'), true);
  const exact = 'y'.repeat(120);
  const r2 = chooseLookBack(
    [ev({ type: 'note', occurredAt: '2026-08-21T09:00:00', data: { text: exact } })],
    now,
  );
  check('exactly-120 quote untouched', r2?.quote, exact);
}

// ---------- type labels ----------

{
  const cases: [EventType, string][] = [
    ['note', 'Moment'],
    ['mood', 'Mood'],
    ['photo', 'Photo'],
    ['milestone', 'Milestone'],
    ['symptom', 'Symptoms'],
    ['appointment', 'Appointment'],
    ['kick_session', 'Kicks'],
  ];
  for (const [type, label] of cases) {
    const r = chooseLookBack(
      [ev({ type, occurredAt: '2026-08-21T09:00:00', data: { text: 'Some memory.' } })],
      now,
    );
    check(`subline label for ${type}`, r?.subline, `${label} · Aug 21 · tap to revisit`);
  }
}

// ---------- week key ----------

{
  check('2026-09-18 → 2026-W38', lookBackWeekKey(now), '2026-W38');
  check('2026-09-21 (Monday) → 2026-W39', lookBackWeekKey(new Date(2026, 8, 21)), '2026-W39');
  check('2026-09-20 (Sunday) still W38', lookBackWeekKey(new Date(2026, 8, 20)), '2026-W38');
  check('stable across the week', lookBackWeekKey(new Date(2026, 8, 14)), '2026-W38');
  check('format matches YYYY-Www', /^\d{4}-W\d{2}$/.test(lookBackWeekKey(now)), true);
  check('LOOK_BACK_WEEKS_AGO is 4', LOOK_BACK_WEEKS_AGO, 4);
}

// ---------- summary ----------

console.log(`\nlookback: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
