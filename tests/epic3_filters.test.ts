/**
 * Epic 3.2 deterministic tests: the timeline matchesFilter predicate.
 * Pure logic only — no database, no expo, no network. The source module
 * does import react-native for its row component, so we stub the
 * react-native module loader before requiring it; matchesFilter itself
 * never touches it.
 *
 * Run with:
 *
 *   npx tsc tests/epic3_filters.test.ts src/timeline/TimelineFilters.tsx \
 *     --outDir /tmp/nurture-tests --module commonjs --target es2022 \
 *     --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests/tests/epic3_filters.test.js
 */

// @types/node provides `require` as a runtime value; use it directly.
declare const process: { exit(code: number): void };
// Stub react-native before TimelineFilters.tsx loads (its row component
// imports ScrollView/StyleSheet/View). matchesFilter itself is pure and
// never reaches for these.
const nodeModule = require('module');
const origLoad = nodeModule._load;
nodeModule._load = function (request: string, ...rest: any[]) {
  if (request === 'react-native') {
    return {
      ScrollView: 'ScrollView',
      Pressable: 'Pressable',
      Text: 'Text',
      View: 'View',
      StyleSheet: { create: (s: unknown) => s },
    };
  }
  return origLoad.call(this, request, ...rest);
};

const { matchesFilter } = require('../src/timeline/TimelineFilters') as {
  matchesFilter: (event: any, filter: string) => boolean;
};

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

function ev(type: string, data: Record<string, unknown> = {}): any {
  return {
    id: `ev-${type}`,
    userId: null,
    pregnancyId: null,
    type,
    occurredAt: '2026-09-18T10:00:00.000Z',
    visibility: 'private',
    data,
    idempotencyKey: 'k',
    deletedAt: null,
    updatedAt: '2026-09-18T10:00:00.000Z',
    dirty: false,
  };
}

const ALL: string[] = ['all', 'reports', 'appointments', 'logs', 'notes', 'symptoms', 'kicks'];
function onlyIn(event: any, expected: string[]): void {
  for (const f of ALL) {
    check(`${event.type} [${f}]`, matchesFilter(event, f), expected.includes(f));
  }
}

// ---------- each filter kind ----------

{
  // 'all' matches every event type, including ones outside the buckets.
  for (const t of ['note', 'mood', 'photo', 'symptom', 'appointment', 'kick_session', 'milestone', 'weight', 'question', 'file', 'weird_future_type']) {
    check(`all → ${t}`, matchesFilter(ev(t), 'all'), true);
  }
}

{
  onlyIn(ev('note', { text: 'hello' }), ['all', 'logs', 'notes']);
}

{
  // mood collapses into notes (and the Logs umbrella)
  onlyIn(ev('mood', { mood: 'glowing' }), ['all', 'logs', 'notes']);
}

{
  // a photo-only log entry surfaces under Logs now that the Photos chip is gone
  onlyIn(ev('photo', {}), ['all', 'logs']);
}

{
  // a scanned report saved as a photo carries the report category
  onlyIn(ev('photo', { category: 'report' }), ['all', 'reports']);
}

{
  // a note carrying a photo attachment surfaces under Logs, never Reports
  const withPhoto = ev('note', {
    text: 'bump shot',
    attachments: [{ id: 'a1', kind: 'photo', name: 'bump.jpg', upload: 'done' }],
  });
  check('note + photo attachment → logs', matchesFilter(withPhoto, 'logs'), true);
  check('note + photo attachment → all', matchesFilter(withPhoto, 'all'), true);
  check('note + photo attachment → notes', matchesFilter(withPhoto, 'notes'), true);
  check('note + photo attachment → reports', matchesFilter(withPhoto, 'reports'), false);
  check('note + photo attachment → symptoms', matchesFilter(withPhoto, 'symptoms'), false);
}

{
  // defensive: attachments not an array, or entries that aren't photo kinds
  const weird = ev('note', { attachments: 'nope' as unknown });
  check('attachments string → logs', matchesFilter(weird, 'logs'), true);
  check('attachments string → reports', matchesFilter(weird, 'reports'), false);

  const mixed = ev('note', {
    attachments: [null, 42, { id: 'x', kind: 'file', name: 'lab.pdf' }],
  });
  check('null/number/file entries → logs', matchesFilter(mixed, 'logs'), true);
  check('null/number/file entries → reports', matchesFilter(mixed, 'reports'), false);

  const fileOnly = ev('file', {
    attachments: [{ id: 'x', kind: 'file', name: 'lab.pdf' }],
  });
  check('file event → reports', matchesFilter(fileOnly, 'reports'), true);
  check('file event → logs false', matchesFilter(fileOnly, 'logs'), false);
}

{
  onlyIn(ev('symptom', { symptoms: ['Nausea'] }), ['all', 'logs', 'symptoms']);
}

{
  onlyIn(ev('appointment', { title: 'Ultrasound' }), ['all', 'appointments']);
}

{
  onlyIn(ev('kick_session', { kicks: 8 }), ['all', 'logs', 'kicks']);
}

{
  // milestone sits under Kicks (approved mockup: "First strong kicks")
  onlyIn(ev('milestone', { title: 'First strong kicks' }), ['all', 'logs', 'kicks']);
  const otherMilestone = ev('milestone', { title: 'Heard the heartbeat' });
  check('any milestone → kicks', matchesFilter(otherMilestone, 'kicks'), true);
  check('any milestone → logs', matchesFilter(otherMilestone, 'logs'), true);
  check('milestone → symptoms false', matchesFilter(otherMilestone, 'symptoms'), false);
}

// ---------- visible under 'all' + 'logs' ----------

{
  onlyIn(ev('weight', { value: 148, unit: 'lb' }), ['all', 'logs']);
}

{
  onlyIn(ev('question', { text: 'Is soft cheese okay?' }), ['all', 'logs']);
}

// ---------- reports ----------

{
  // Add report always saves type 'report' (entry-typing rule) — a Report
  // entry with either attachment kind lands only in all + reports
  onlyIn(
    ev('report', {
      text: 'glucose-results.pdf',
      attachments: [{ id: 'a1', kind: 'file', name: 'glucose-results.pdf', upload: 'pending' }],
      category: 'report',
    }),
    ['all', 'reports'],
  );
}

{
  // a scanned report (photo attachment) is still a Report entry, never a Photo
  onlyIn(
    ev('report', {
      text: 'scan-sep-19.jpg',
      attachments: [{ id: 'a1', kind: 'photo', name: 'scan-sep-19.jpg', upload: 'pending' }],
      category: 'report',
    }),
    ['all', 'reports'],
  );
}

{
  onlyIn(ev('file', {}), ['all', 'reports']);
}

{
  // unknown future event types must not leak into a bucket
  onlyIn(ev('weird_future_type', {}), ['all']);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
