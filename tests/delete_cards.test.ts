/**
 * Deletable feed cards — deterministic tests (mockup 30, Anuraj approved
 * Sept 20, 2026).
 *
 * The per-type confirmation copy (deleteKindFor / deleteCopyFor in
 * src/timeline/deleteCopy.ts) is pure: no database, no expo, no network.
 * These tests pin the EXACT approved copy for every card type and the
 * kind mapping (appointments, reports incl. legacy file entries, kick
 * sessions, and everything else as an ordinary log entry).
 *
 * Run with:
 *
 *   npx tsc tests/delete_cards.test.ts src/timeline/deleteCopy.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests/tests/delete_cards.test.js
 */

declare const process: { exit(code: number): void };
// The codebase's lazy-require pattern: declare the runtime `require`
// explicitly so this pure-node compile doesn't depend on @types/node.
declare const require: (id: string) => unknown;

const {
  deleteKindFor,
  deleteCopyFor,
  DELETE_COPY,
} = require('../src/timeline/deleteCopy') as {
  deleteKindFor: (e: unknown) => string;
  deleteCopyFor: (e: unknown) => {
    xLabel: string;
    title: string;
    body: string;
    confirmLabel: string;
    toast: string;
  };
  DELETE_COPY: Record<string, { xLabel: string; title: string; body: string; confirmLabel: string; toast: string }>;
};

function ev(type: string, data: Record<string, unknown> = {}): unknown {
  return {
    id: 'evt-1',
    userId: null,
    pregnancyId: null,
    type,
    occurredAt: '2026-09-20T10:00:00.000Z',
    visibility: 'private',
    data,
  };
}

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}`);
  }
}

// --- kind mapping -------------------------------------------------------
check('appointment -> appointment', deleteKindFor(ev('appointment')) === 'appointment');
check("report type -> report", deleteKindFor(ev('report')) === 'report');
check('legacy file type -> report', deleteKindFor(ev('file')) === 'report');
check(
  "category=report entry -> report",
  deleteKindFor(ev('photo', { category: 'report' })) === 'report',
);
check('kick_session -> kick_session', deleteKindFor(ev('kick_session')) === 'kick_session');
for (const t of ['note', 'mood', 'symptom', 'photo', 'milestone', 'weight', 'question']) {
  check(`${t} -> log`, deleteKindFor(ev(t)) === 'log');
}

// --- exact approved copy (mockup 30, verbatim) ---------------------------
const appt = deleteCopyFor(ev('appointment'));
check('appt xLabel', appt.xLabel === 'Delete appointment');
check('appt title', appt.title === 'Delete this appointment?');
check(
  'appt body',
  appt.body ===
    'It leaves your story and your Week, and its reminder is cancelled too. This can\u2019t be undone.',
);
check('appt confirmLabel', appt.confirmLabel === 'Delete appointment');
check('appt toast', appt.toast === 'Appointment deleted');

const report = deleteCopyFor(ev('report'));
check('report xLabel', report.xLabel === 'Delete report summary');
check('report title', report.title === 'Delete this summary?');
check(
  'report body',
  report.body ===
    'Only the summary card goes away \u2014 your entries stay in your story. This can\u2019t be undone.',
);
check('report confirmLabel', report.confirmLabel === 'Delete summary');
check('report toast', report.toast === 'Summary deleted');

const kick = deleteCopyFor(ev('kick_session'));
check('kick xLabel', kick.xLabel === 'Delete kick session');
check('kick title', kick.title === 'Delete this kick session?');
check('kick body', kick.body === 'It leaves your story. This can\u2019t be undone.');
check('kick confirmLabel', kick.confirmLabel === 'Delete session');
check('kick toast', kick.toast === 'Kick session deleted');

const log = deleteCopyFor(ev('note'));
check('log xLabel', log.xLabel === 'Delete log entry');
check('log title', log.title === 'Delete this entry?');
check(
  'log body',
  log.body === 'It leaves your story everywhere it appears. This can\u2019t be undone.',
);
check('log confirmLabel', log.confirmLabel === 'Delete entry');
check('log toast', log.toast === 'Entry deleted');

// --- DELETE_COPY table is complete ---------------------------------------
for (const kind of ['appointment', 'report', 'kick_session', 'log']) {
  const c = DELETE_COPY[kind];
  check(
    `DELETE_COPY.${kind} complete`,
    !!c && !!c.xLabel && !!c.title && !!c.body && !!c.confirmLabel && !!c.toast,
  );
}

console.log(failures === 0 ? '\nAll delete-card copy tests passed.' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
