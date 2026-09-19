/**
 * Epic 8 unit tests: OB-visit export (range resolution, entry filtering,
 * facts-only guard, generation performance). Pure modules only — no
 * database, no notifications, no network. Run with:
 *
 *   npx tsc --ignoreConfig tests/epic8_export.test.ts src/export/obVisit.ts \
 *     src/export/range.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-export-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-export-tests/tests/epic8_export.test.js
 */

import type { LocalEvent, Visibility } from '../src/lib/types';
import {
  buildVisitSummary,
  categorizeForExport,
  collectQuestions,
  defaultExportOptions,
  factsOnlyViolations,
  isExportMarked,
  isPartnerEntry,
  isPhotoEntry,
  isPrivateNote,
  preselectExportMarked,
  renderSummaryHtml,
  renderSummaryText,
  summaryCounts,
  type CategorizedEvents,
  type ExportOptions,
  type VisitSummary,
} from '../src/export/obVisit';
import {
  findLastVisitDate,
  formatRangeLabel,
  resolveRange,
} from '../src/export/range';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1;
    console.log(`ok - ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL - ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

let seq = 0;
function ev(partial: Partial<LocalEvent> & { type: string }): LocalEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    userId: null,
    pregnancyId: null,
    type: partial.type,
    occurredAt: partial.occurredAt ?? '2026-09-10T10:00:00.000Z',
    visibility: (partial.visibility ?? 'private') as Visibility,
    data: partial.data ?? {},
    idempotencyKey: `k${seq}`,
    deletedAt: null,
    updatedAt: '2026-09-10T10:00:00.000Z',
    dirty: false,
  };
}

const NOW = new Date('2026-09-18T12:00:00.000Z');

/* ---------------- range: "since last visit" ---------------- */

{
  // Stored date wins.
  const r = resolveRange({
    preset: 'since_last_visit',
    now: NOW,
    events: [],
    storedLastVisitISO: '2026-09-02',
  });
  check('since-last-visit uses stored date', r.startISO === '2026-09-02' && r.source === 'stored', JSON.stringify(r));
  check('since-last-visit label', r.label === 'Sep 2 – 18, 2026', r.label);
}

{
  // Most recent past appointment wins; future appointments ignored.
  const events = [
    ev({ type: 'appointment', occurredAt: '2026-09-25T10:00:00.000Z', data: { title: 'Future' } }),
    ev({ type: 'appointment', occurredAt: '2026-08-20T10:00:00.000Z', data: { title: 'Older' } }),
    ev({ type: 'appointment', occurredAt: '2026-09-02T10:00:00.000Z', data: { title: 'Last visit' } }),
  ];
  const found = findLastVisitDate(events, NOW);
  check('findLastVisitDate picks most recent past appointment', found === '2026-09-02', String(found));
  const r = resolveRange({ preset: 'since_last_visit', now: NOW, events });
  check('since-last-visit falls back to appointment', r.startISO === '2026-09-02' && r.source === 'appointment', JSON.stringify(r));
}

{
  // No stored date, no appointments -> 30-day fallback.
  const r = resolveRange({ preset: 'since_last_visit', now: NOW, events: [] });
  check('since-last-visit falls back to 30 days', r.startISO === '2026-08-20' && r.source === 'fallback', JSON.stringify(r));
}

{
  const r = resolveRange({ preset: 'last_30_days', now: NOW, events: [] });
  check('last-30-days range', r.startISO === '2026-08-20' && r.source === 'last_30_days', JSON.stringify(r));
}

{
  const r = resolveRange({
    preset: 'custom', now: NOW, customStartISO: '2026-09-01', customEndISO: '2026-09-10',
  });
  check('custom range', r.startISO === '2026-09-01' && r.endISO === '2026-09-11' && r.source === 'custom', JSON.stringify(r));
  check('range label same month', r.label === 'Sep 1 – 10, 2026', r.label);
  check('range label single day', formatRangeLabel('2026-09-05', '2026-09-06') === 'Sep 5, 2026');
  let threw = false;
  try {
    resolveRange({ preset: 'custom', now: NOW, customStartISO: 'nope', customEndISO: '2026-09-10' });
  } catch { threw = true; }
  check('custom range rejects bad dates', threw);
  threw = false;
  try {
    resolveRange({ preset: 'custom', now: NOW, customStartISO: '2026-09-10', customEndISO: '2026-09-01' });
  } catch { threw = true; }
  check('custom range rejects end before start', threw);
}

/* ---------------- entry filtering ---------------- */

function seedEvents(): LocalEvent[] {
  return [
    ev({ type: 'symptom', visibility: 'private', data: { symptoms: ['Fatigue', 'Heartburn'] } }),
    ev({ type: 'symptom', visibility: 'private', data: { symptoms: ['Fatigue'] } }),
    ev({ type: 'weight', visibility: 'private', data: { value: 139, unit: 'lb' } }),
    ev({ type: 'weight', visibility: 'private', data: { value: 142.5, unit: 'lb' } }),
    ev({ type: 'kick_session', visibility: 'private', data: { movements: 12, durationMin: 18 } }),
    ev({ type: 'note', visibility: 'shared', data: { text: 'Slept through the night.' } }),
    ev({ type: 'note', visibility: 'private', data: { text: 'Private worry.' } }),
    ev({ type: 'photo', visibility: 'private', data: { attachments: [{ id: 'a1', kind: 'photo', name: 'bump.jpg', upload: 'pending' }] } }),
    ev({ type: 'note', visibility: 'export', data: { text: 'Partner note for OB', author: 'partner' } }),
    ev({ type: 'note', visibility: 'private', data: { text: 'Partner private note', author: 'partner' } }),
    ev({ type: 'question', visibility: 'private', data: { text: 'Travel plans at 32 weeks — okay?' } }),
    ev({
      type: 'appointment', visibility: 'private',
      data: { questions: [{ id: 'q1', text: 'Is the placenta still low-lying?', state: 'to_ask' }, { id: 'q2', text: 'Old question', state: 'dismissed' }] },
    }),
  ];
}

{
  const events = seedEvents();
  const shared = events.find((e) => (e.data as { text?: string }).text === 'Slept through the night.')!;
  const priv = events.find((e) => (e.data as { text?: string }).text === 'Private worry.')!;
  const photo = events.find((e) => e.type === 'photo')!;
  const pExport = events.find((e) => (e.data as { text?: string }).text === 'Partner note for OB')!;
  const pPriv = events.find((e) => (e.data as { text?: string }).text === 'Partner private note')!;

  check('private note detected', isPrivateNote(priv));
  check('shared note is not a private note', !isPrivateNote(shared));
  check('photo detected', isPhotoEntry(photo));
  check('partner entry detected', isPartnerEntry(pExport) && isPartnerEntry(pPriv));
  check('non-partner not flagged', !isPartnerEntry(shared));
  check('+Export mark read', isExportMarked(pExport) && !isExportMarked(pPriv));

  const cat = categorizeForExport(events);
  check('defaults quarantine private notes', cat.privateNotes.length === 1 && cat.notes.length === 1);
  check('defaults quarantine photos', cat.photos.length === 1);
  check('defaults quarantine partner entries', cat.partnerEntries.length === 2);
  check('+Export preselection', JSON.stringify(preselectExportMarked(cat.partnerEntries)) === JSON.stringify([pExport.id]));
  check('questions: to_ask kept, dismissed dropped',
    cat.questions.length === 2 &&
    cat.questions.some((q) => q.text === 'Travel plans at 32 weeks — okay?') &&
    cat.questions.some((q) => q.text === 'Is the placenta still low-lying?'));
}

{
  // Defaults: private notes, photos, partner entries stay OUT.
  const cat = categorizeForExport(seedEvents());
  const s = buildVisitSummary(
    cat, defaultExportOptions(),
    { startISO: '2026-09-02', endISO: '2026-09-19', label: 'Sep 2 – Sep 18, 2026' },
    NOW.toISOString(),
  );
  check('default excludes private note text', !renderSummaryText(s).includes('Private worry'));
  check('default excludes photos', s.photos.length === 0);
  check('default excludes partner notes', !s.notes.some((n) => n.fromPartner));
  check('symptom frequency counted', s.symptoms.length === 2 && s.symptoms[0].name === 'Fatigue' && s.symptoms[0].count === 2);
  check('weight readings recorded', s.weight.length === 2 && s.weight[0].value === 139);
  check('kick session recorded', s.kicks.length === 1 && s.kicks[0].movements === 12 && s.kicks[0].durationMin === 18);
  check('questions included', s.questions.length === 2);
}

{
  // Explicit adds: private notes, photos, preselected +Export partner entry.
  const events = seedEvents();
  const cat = categorizeForExport(events);
  const opts: ExportOptions = {
    ...defaultExportOptions(),
    includePrivateNotes: true,
    includePhotos: true,
    partnerEntryIds: preselectExportMarked(cat.partnerEntries),
  };
  const s = buildVisitSummary(
    cat, opts,
    { startISO: '2026-09-02', endISO: '2026-09-19', label: 'Sep 2 – Sep 18, 2026' },
    NOW.toISOString(),
  );
  check('explicit add includes private note', s.notes.some((n) => n.text === 'Private worry.'));
  check('explicit add includes photo (described)', s.photos.length === 1 && s.photos[0].name === 'bump.jpg');
  check('preselected +Export partner entry included + tagged',
    s.notes.some((n) => n.text === 'Partner note for OB' && n.fromPartner));
  check('non-selected partner entry stays out',
    !s.notes.some((n) => n.text === 'Partner private note'));
}

{
  // Section toggles.
  const cat = categorizeForExport(seedEvents());
  const opts = defaultExportOptions();
  opts.sections.symptoms = false;
  opts.sections.questions = false;
  const s = buildVisitSummary(
    cat, opts,
    { startISO: '2026-09-02', endISO: '2026-09-19', label: 'Sep 2 – Sep 18, 2026' },
    NOW.toISOString(),
  );
  check('toggled-off sections omitted', s.symptoms.length === 0 && s.questions.length === 0 && s.weight.length === 2);
}

/* ---------------- facts-only guard ---------------- */

{
  const cat = categorizeForExport(seedEvents());
  const s = buildVisitSummary(
    cat, { ...defaultExportOptions(), includePrivateNotes: true, includePhotos: true, partnerEntryIds: preselectExportMarked(cat.partnerEntries) },
    { startISO: '2026-09-02', endISO: '2026-09-19', label: 'Sep 2 – Sep 18, 2026' },
    NOW.toISOString(),
  );
  const text = renderSummaryText(s);
  const html = renderSummaryHtml(s);
  check('text has facts-only framing', text.includes('A user-entered record — not a clinical chart.'));
  check('text has generated timestamp', text.includes('Generated Sep 18, 2026'));
  check('html has facts-only framing', html.includes('A user-entered record — not a clinical chart.'));
  check('html has generated timestamp', html.includes('Generated Sep 18, 2026'));
  check('text facts-only', factsOnlyViolations(text).length === 0, factsOnlyViolations(text).join(','));
  check('html facts-only', factsOnlyViolations(html).length === 0, factsOnlyViolations(html).join(','));
  check('weight copy is facts-only', html.includes('recorded values only, no targets'));
  check('html escapes user text', !renderSummaryHtml({
    ...s, notes: [{ dateISO: '2026-09-10', text: '<script>alert(1)</script>', fromPartner: false }],
  }).includes('<script>alert(1)</script>'));
}

{
  // collectQuestions: answered/deferred/dismissed stay out; stateless counts as open.
  const events = [
    ev({ type: 'appointment', data: { questions: [
      { id: 'a', text: 'Open one', state: 'to_ask' },
      { id: 'b', text: 'Answered one', state: 'answered' },
      { id: 'c', text: 'Stateless one' },
      { id: 'd', text: 'Dismissed one', state: 'dismissed' },
    ] } }),
  ];
  const qs = collectQuestions(events);
  check('only open questions collected', qs.length === 2 && qs.every((q) => q.text !== 'Answered one' && q.text !== 'Dismissed one'));
}

/* ---------------- performance: < 5s generation ---------------- */

{
  const many: LocalEvent[] = [];
  for (let i = 0; i < 2000; i += 1) {
    many.push(ev({
      type: ['symptom', 'weight', 'kick_session', 'note'][i % 4],
      // Notes are 'shared' here so the perf path also renders note text.
      visibility: i % 4 === 3 ? 'shared' : 'private',
      occurredAt: `2026-09-${String((i % 17) + 1).padStart(2, '0')}T10:00:00.000Z`,
      data: i % 4 === 0 ? { symptoms: ['Fatigue', 'Heartburn'] }
        : i % 4 === 1 ? { value: 140 + (i % 10), unit: 'lb' }
        : i % 4 === 2 ? { movements: 10 + (i % 5), durationMin: 15 }
        : { text: `Note number ${i}` },
    }));
  }
  const t0 = Date.now();
  const cat = categorizeForExport(many);
  const s = buildVisitSummary(
    cat, defaultExportOptions(),
    { startISO: '2026-09-01', endISO: '2026-09-19', label: 'Sep 1 – Sep 18, 2026' },
    NOW.toISOString(),
  );
  const text = renderSummaryText(s);
  const html = renderSummaryHtml(s);
  const ms = Date.now() - t0;
  check('2000-event summary generates in < 5s', ms < 5000, `${ms}ms`);
  check('2000-event output non-trivial', text.length > 1000 && html.length > 2000, `${text.length}/${html.length}`);
  const counts = summaryCounts(s);
  check('summaryCounts', counts.symptoms === 1000 && counts.notes === 500, JSON.stringify(counts));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
