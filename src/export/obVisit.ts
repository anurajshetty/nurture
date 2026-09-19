/**
 * Epic 8 — OB-visit export: visit summary builder (pure, UI-agnostic).
 *
 * Turns her journal events between two dates into a clean, facts-only
 * summary: symptom frequency, weight trend, kick sessions, notes, and the
 * "questions to ask" list. Recorded facts ONLY — the builder never emits
 * risk rankings, interpretations, diagnoses, normal ranges, or severity
 * judgments. Every template string in this file is fixed copy; user text
 * is reproduced verbatim and HTML-escaped in the HTML renderer.
 *
 * INCLUSION RULES (per BACKLOG 8.1 + the approved mockup):
 * - Sections (Symptoms / Weight trend / Kick sessions / Notes / Questions)
 *   are individually toggleable; all default ON.
 * - Private notes, photos, and partner entries are EXCLUDED by default and
 *   require her explicit "Add". Photos shared from here are described, not
 *   embedded, and the UI states that location metadata is removed.
 * - Entries with visibility === 'export' (Epic 7's 📄 +Export mark) are
 *   PRESELECTED in the partner-entry picker — see `preselectExportMarked`.
 *   This module reads `event.visibility` only; it never changes visibility
 *   semantics (contract C4).
 *
 * PARTNER-ENTRY DETECTION (documented seam): in this tree Epic 7's partner
 * model doesn't exist yet, so a partner-authored entry is recognized by
 * `data.author === 'partner'`, `data.by === 'partner'`, or
 * `data.partner === true`. Epic 7 should confirm/extend this predicate when
 * its model lands. Explicitly-added partner entries are merged into their
 * natural sections (a partner note appears under Notes) and tagged
 * "(partner)" — the summary stays organized by content, not by author.
 *
 * QUESTION SOURCES (defensive, per contract C1): `question`-type events
 * (`data.text`) and `data.questions` arrays on appointment events — the
 * shape Epic 6 was recommended (`{ id, text, state }`), where only
 * `to_ask` (or stateless) questions are listed. Answered / deferred /
 * dismissed questions stay out.
 *
 * DATA SHAPES (defensive reads — journal payloads evolve):
 * - symptom:  data.symptoms: string[] (or data.symptom: string)
 * - weight:   data.value: number, data.unit: string
 * - kick_session: data.movements|kicks|count, data.durationMin|minutes
 * - note:     data.text
 * - photo:    data.attachments[].name — described, never embedded
 */

import type { EventAttachment, LocalEvent } from '../lib/types';

export type SectionKey = 'symptoms' | 'weight' | 'kicks' | 'notes' | 'questions';

export const SECTION_KEYS: SectionKey[] = ['symptoms', 'weight', 'kicks', 'notes', 'questions'];

export const SECTION_TITLES: Record<SectionKey, string> = {
  symptoms: 'Symptoms',
  weight: 'Weight trend',
  kicks: 'Kick sessions',
  notes: 'Notes',
  questions: 'Questions to ask',
};

/**
 * What she chose to include. Defaults exclude private notes, photos, and
 * partner entries; she adds them explicitly via the UI.
 */
export interface ExportOptions {
  sections: Record<SectionKey, boolean>;
  includePrivateNotes: boolean;
  includePhotos: boolean;
  /** Ids of explicitly-chosen partner entries (the UI preselects +Export ones). */
  partnerEntryIds: string[];
}

export function defaultExportOptions(): ExportOptions {
  return {
    sections: { symptoms: true, weight: true, kicks: true, notes: true, questions: true },
    includePrivateNotes: false,
    includePhotos: false,
    partnerEntryIds: [],
  };
}

/** Partner-authored entries are quarantined by default (see module doc). */
export function isPartnerEntry(e: LocalEvent): boolean {
  const d = (e.data ?? {}) as Record<string, unknown>;
  return d.author === 'partner' || d.by === 'partner' || d.partner === true;
}

export function isPhotoEntry(e: LocalEvent): boolean {
  return e.type === 'photo';
}

export function isPrivateNote(e: LocalEvent): boolean {
  return e.type === 'note' && e.visibility === 'private';
}

/** Epic 7's 📄 +Export mark — read-only here (contract C4). */
export function isExportMarked(e: LocalEvent): boolean {
  return e.visibility === 'export';
}

/**
 * Partner entries with visibility 'export' are preselected in the picker.
 * Returns the event ids, in journal order (oldest first).
 */
export function preselectExportMarked(partnerEntries: LocalEvent[]): string[] {
  return partnerEntries.filter(isExportMarked).map((e) => e.id);
}

export interface QuestionItem {
  text: string;
  occurredAt: string;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

interface AppointmentQuestion {
  id?: string;
  text?: unknown;
  state?: unknown;
}

/**
 * Collects "questions to ask" from `question` events and appointment
 * `data.questions` arrays (Epic 6's recommended shape). Only open
 * questions ('to_ask' or no state) are listed.
 */
export function collectQuestions(events: LocalEvent[]): QuestionItem[] {
  const out: QuestionItem[] = [];
  for (const e of events) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    if (e.type === 'question') {
      const text = asString(d.text);
      if (text) out.push({ text, occurredAt: e.occurredAt });
      continue;
    }
    if (e.type === 'appointment' && Array.isArray(d.questions)) {
      for (const q of d.questions as AppointmentQuestion[]) {
        if (!q || typeof q !== 'object') continue;
        const state = typeof q.state === 'string' ? q.state : 'to_ask';
        if (state !== 'to_ask') continue;
        const text = asString(q.text);
        if (text) out.push({ text, occurredAt: e.occurredAt });
      }
    }
  }
  return out;
}

export interface CategorizedEvents {
  symptoms: LocalEvent[];
  weight: LocalEvent[];
  kicks: LocalEvent[];
  notes: LocalEvent[];
  questions: QuestionItem[];
  /** Excluded by default; added explicitly. */
  photos: LocalEvent[];
  /** Excluded by default; added explicitly. */
  privateNotes: LocalEvent[];
  /** Excluded by default; added explicitly (picker preselects +Export). */
  partnerEntries: LocalEvent[];
}

/**
 * Buckets events by content. Pass non-deleted events already clipped to the
 * chosen range. Partner entries, photos, and private notes are quarantined
 * into their own buckets — `selectForSummary` decides what actually ships.
 */
export function categorizeForExport(events: LocalEvent[]): CategorizedEvents {
  const cat: CategorizedEvents = {
    symptoms: [], weight: [], kicks: [], notes: [],
    questions: [], photos: [], privateNotes: [], partnerEntries: [],
  };
  for (const e of events) {
    if (isPartnerEntry(e)) { cat.partnerEntries.push(e); continue; }
    if (isPhotoEntry(e)) { cat.photos.push(e); continue; }
    switch (e.type) {
      case 'symptom': cat.symptoms.push(e); break;
      case 'weight': cat.weight.push(e); break;
      case 'kick_session': cat.kicks.push(e); break;
      case 'note':
        if (isPrivateNote(e)) cat.privateNotes.push(e);
        else cat.notes.push(e);
        break;
      default: break; // questions are collected separately below
    }
  }
  cat.questions = collectQuestions(events.filter((e) => !isPartnerEntry(e)));
  const byTime = (a: LocalEvent, b: LocalEvent) => a.occurredAt.localeCompare(b.occurredAt);
  cat.symptoms.sort(byTime);
  cat.weight.sort(byTime);
  cat.kicks.sort(byTime);
  cat.notes.sort(byTime);
  cat.photos.sort(byTime);
  cat.privateNotes.sort(byTime);
  cat.partnerEntries.sort(byTime);
  cat.questions.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return cat;
}

export interface SymptomCount { name: string; count: number }
export interface WeightReading { dateISO: string; value: number; unit: string }
export interface KickSession { dateISO: string; movements: number | null; durationMin: number | null }
export interface NoteItem { dateISO: string; text: string; fromPartner: boolean }
export interface PhotoItem { dateISO: string; name: string }

/** The facts-only summary model — everything the renderers need, nothing more. */
export interface VisitSummary {
  rangeStartISO: string;
  rangeEndISO: string; // exclusive
  rangeLabel: string;
  generatedAtISO: string;
  symptoms: SymptomCount[];
  weight: WeightReading[];
  kicks: KickSession[];
  notes: NoteItem[];
  questions: string[];
  photos: PhotoItem[];
}

function eventDay(e: LocalEvent): string {
  return e.occurredAt.slice(0, 10);
}

function noteText(e: LocalEvent): string | null {
  return asString((e.data ?? {}).text);
}

function photoName(e: LocalEvent): string {
  const atts = (e.data ?? {}).attachments;
  if (Array.isArray(atts)) {
    const first = (atts as EventAttachment[]).find((a) => a && a.name);
    if (first?.name) return first.name;
  }
  return asString((e.data ?? {}).text) ?? 'Photo';
}

/**
 * Applies her inclusion choices to categorized events. Partner entries and
 * private notes merge into their natural sections (tagged when from a
 * partner); photos stay their own listed section (described, not embedded).
 */
export function buildVisitSummary(
  cat: CategorizedEvents,
  options: ExportOptions,
  range: { startISO: string; endISO: string; label: string },
  generatedAtISO: string,
): VisitSummary {
  const on = (s: SectionKey) => options.sections[s];
  const partnerIds = new Set(options.partnerEntryIds);
  const chosenPartner = cat.partnerEntries.filter((e) => partnerIds.has(e.id));

  // --- Symptoms: frequency counts, most frequent first.
  const symptomEvents = on('symptoms') ? cat.symptoms : [];
  const counts = new Map<string, number>();
  for (const e of symptomEvents) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    const names: string[] = [];
    if (Array.isArray(d.symptoms)) {
      for (const s of d.symptoms) { const n = asString(s); if (n) names.push(n); }
    }
    const single = asString(d.symptom);
    if (single) names.push(single);
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const symptoms: SymptomCount[] = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // --- Weight: recorded values only — no targets, no judgment.
  const weight: WeightReading[] = on('weight')
    ? cat.weight
        .map((e) => {
          const d = (e.data ?? {}) as Record<string, unknown>;
          const value = asNumber(d.value);
          const unit = asString(d.unit) ?? '';
          return value === null ? null : { dateISO: eventDay(e), value, unit };
        })
        .filter((r): r is WeightReading => r !== null)
    : [];

  // --- Kick sessions: recorded sessions, newest last (chronological).
  const kicks: KickSession[] = on('kicks')
    ? cat.kicks.map((e) => {
        const d = (e.data ?? {}) as Record<string, unknown>;
        return {
          dateISO: eventDay(e),
          movements: asNumber(d.movements) ?? asNumber(d.kicks) ?? asNumber(d.count),
          durationMin:
            asNumber(d.durationMin) ?? asNumber(d.minutes) ?? asNumber(d.duration_minutes),
        };
      })
    : [];

  // --- Notes: shared notes + explicitly-added private notes + chosen partner entries.
  const notes: NoteItem[] = [];
  if (on('notes')) {
    for (const e of cat.notes) {
      const text = noteText(e);
      if (text) notes.push({ dateISO: eventDay(e), text, fromPartner: false });
    }
    if (options.includePrivateNotes) {
      for (const e of cat.privateNotes) {
        const text = noteText(e);
        if (text) notes.push({ dateISO: eventDay(e), text, fromPartner: false });
      }
    }
    for (const e of chosenPartner) {
      if (e.type !== 'note') continue;
      const text = noteText(e);
      if (text) notes.push({ dateISO: eventDay(e), text, fromPartner: true });
    }
    notes.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  }

  // --- Questions to ask: open questions only.
  const questions = on('questions') ? cat.questions.map((q) => q.text) : [];

  // --- Photos: described (count + file names), never embedded.
  const photos: PhotoItem[] = options.includePhotos
    ? cat.photos.map((e) => ({ dateISO: eventDay(e), name: photoName(e) }))
    : [];

  return {
    rangeStartISO: range.startISO,
    rangeEndISO: range.endISO,
    rangeLabel: range.label,
    generatedAtISO,
    symptoms, weight, kicks, notes, questions, photos,
  };
}

/** Counts what the summary actually contains — drives the "N entries" captions. */
export function summaryCounts(s: VisitSummary): Record<SectionKey | 'photos', number> {
  return {
    symptoms: s.symptoms.reduce((n, x) => n + x.count, 0),
    weight: s.weight.length,
    kicks: s.kicks.length,
    notes: s.notes.length,
    questions: s.questions.length,
    photos: s.photos.length,
  };
}

/* ------------------------------------------------------------------ */
/* Renderers — text and printable HTML. Facts only, by construction.   */
/* ------------------------------------------------------------------ */

function formatGenDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

const FRAMING_TITLE = 'Visit summary';
const FRAMING_DISCLAIMER = 'A user-entered record — not a clinical chart.';
const FRAMING_GENERATED = 'generated on this device';

/** Plain-text rendering — the share/print payload for accessibility tools. */
export function renderSummaryText(s: VisitSummary): string {
  const L: string[] = [];
  L.push(FRAMING_TITLE);
  L.push(s.rangeLabel);
  L.push(FRAMING_DISCLAIMER);
  L.push(`Generated ${formatGenDate(s.generatedAtISO)} — ${FRAMING_GENERATED}.`);
  L.push('');

  if (s.symptoms.length) {
    L.push(`Symptoms · ${s.symptoms.reduce((n, x) => n + x.count, 0)} entries`);
    for (const x of s.symptoms) L.push(`- ${x.name}: ${x.count}×`);
    L.push('');
  }
  if (s.weight.length) {
    const first = s.weight[0];
    const last = s.weight[s.weight.length - 1];
    const sameUnit = first.unit === last.unit && first.unit !== '';
    L.push(`Weight trend · ${s.weight.length} entries`);
    for (const r of s.weight) L.push(`- ${r.dateISO}: ${r.value}${r.unit ? ` ${r.unit}` : ''}`);
    L.push(
      sameUnit
        ? `${first.value} → ${last.value} ${first.unit} · recorded values only, no targets.`
        : 'Recorded values only, no targets.',
    );
    L.push('');
  }
  if (s.kicks.length) {
    L.push(`Kick sessions · ${s.kicks.length}`);
    for (const k of s.kicks) {
      const bits: string[] = [];
      if (k.movements !== null) bits.push(`${k.movements} movements`);
      if (k.durationMin !== null) bits.push(`${k.durationMin} min`);
      L.push(`- ${k.dateISO}${bits.length ? ` — ${bits.join(' · ')}` : ''}`);
    }
    L.push('');
  }
  if (s.notes.length) {
    L.push(`Notes · ${s.notes.length} entries`);
    for (const n of s.notes) {
      L.push(`- ${n.dateISO}${n.fromPartner ? ' (partner)' : ''} — "${n.text}"`);
    }
    L.push('');
  }
  if (s.questions.length) {
    L.push('Questions to ask');
    for (const q of s.questions) L.push(`- ${q}`);
    L.push('');
  }
  if (s.photos.length) {
    L.push(`Photos · ${s.photos.length} (described, not attached)`);
    for (const p of s.photos) L.push(`- ${p.dateISO} — ${p.name}`);
    L.push('Location data is removed when photos are shared.');
    L.push('');
  }
  return L.join('\n').trimEnd() + '\n';
}

function escHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Weight sparkline as inline SVG (pure markup — no chart library). */
function weightSparkline(readings: WeightReading[]): string {
  if (readings.length < 2) return '';
  const W = 300;
  const H = 56;
  const PAD = 8;
  const values = readings.map((r) => r.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = readings.map((r, i) => {
    const x = PAD + (i * (W - PAD * 2)) / (readings.length - 1);
    const y = PAD + (1 - (r.value - min) / span) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(',');
  return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight trend line">` +
    `<polyline points="${pts.join(' ')}" fill="none" stroke="#93B192" stroke-width="2.5" stroke-linecap="round"/>` +
    `<circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="#93B192"/>` +
    `</svg>`;
}

function formatDayShort(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Self-contained printable HTML document — the v1 share/print payload.
 * No external assets, no scripts: it opens in Mail, Files, AirDrop, and
 * prints cleanly from the iOS share sheet or a desktop browser.
 * (Choice documented: HTML instead of PDF — no heavy PDF library, keeps
 * generation far under the 5-second budget on-device.)
 */
export function renderSummaryHtml(s: VisitSummary): string {
  const sec: string[] = [];

  if (s.symptoms.length) {
    const max = Math.max(...s.symptoms.map((x) => x.count));
    const bars = s.symptoms
      .map(
        (x) => `<div class="bar"><div class="bl"><span>${escHtml(x.name)}</span><span>${x.count}×</span></div>` +
          `<div class="bt"><div class="bf" style="width:${Math.round((x.count / max) * 100)}%"></div></div></div>`,
      )
      .join('');
    const total = s.symptoms.reduce((n, x) => n + x.count, 0);
    sec.push(`<div class="dsec">Symptoms · ${total} entries</div>${bars}`);
  }

  if (s.weight.length) {
    const first = s.weight[0];
    const last = s.weight[s.weight.length - 1];
    const sameUnit = first.unit === last.unit && first.unit !== '';
    const trend = sameUnit
      ? `${first.value} → ${last.value} ${escHtml(first.unit)} · recorded values only, no targets.`
      : 'Recorded values only, no targets.';
    sec.push(
      `<div class="dsec">Weight trend · ${s.weight.length} entries</div>` +
        weightSparkline(s.weight) +
        `<p class="dsub">${trend}</p>`,
    );
  }

  if (s.kicks.length) {
    const items = s.kicks
      .map((k) => {
        const bits: string[] = [];
        if (k.movements !== null) bits.push(`${k.movements} movements`);
        if (k.durationMin !== null) bits.push(`${k.durationMin} min`);
        return `<li>${escHtml(formatDayShort(k.dateISO))}${bits.length ? ` — ${escHtml(bits.join(' · '))}` : ''}</li>`;
      })
      .join('');
    sec.push(`<div class="dsec">Kick sessions · ${s.kicks.length}</div><ul>${items}</ul>`);
  }

  if (s.notes.length) {
    const items = s.notes
      .map(
        (n) =>
          `<li>${escHtml(formatDayShort(n.dateISO))}${n.fromPartner ? ' (partner)' : ''} — &ldquo;${escHtml(n.text)}&rdquo;</li>`,
      )
      .join('');
    sec.push(`<div class="dsec">Notes · ${s.notes.length} entries</div><ul>${items}</ul>`);
  }

  if (s.questions.length) {
    const items = s.questions.map((q) => `<div class="dq">${escHtml(q)}</div>`).join('');
    sec.push(`<div class="dsec">Questions to ask</div>${items}`);
  }

  if (s.photos.length) {
    const items = s.photos
      .map((p) => `<li>${escHtml(formatDayShort(p.dateISO))} — ${escHtml(p.name)}</li>`)
      .join('');
    sec.push(
      `<div class="dsec">Photos · ${s.photos.length} (described, not attached)</div><ul>${items}</ul>` +
        `<p class="dsub">Location data is removed when photos are shared.</p>`,
    );
  }

  if (!sec.length) {
    sec.push('<p class="dsub">No entries in this range yet — her journal entries will appear here.</p>');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visit summary</title>
<style>
  body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#2F2B27;background:#fff;margin:0;padding:28px 24px;max-width:640px;}
  .dh{font-size:22px;font-weight:700;margin:0 0 6px;}
  .dsub{font-size:13px;color:#8A8078;line-height:1.55;margin:0 0 18px;}
  .dsec{font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6F8F6E;margin:22px 0 8px;}
  .bar{margin-bottom:10px;}
  .bl{display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px;}
  .bt{height:8px;background:#F1EAE0;border-radius:999px;overflow:hidden;}
  .bf{height:100%;background:#DE7A59;border-radius:999px;}
  ul{margin:0 0 6px;padding-left:20px;font-size:14px;line-height:1.7;}
  .dq{font-size:14px;background:#FAF6F0;border:1px solid #ECE5DA;border-radius:10px;padding:10px 12px;margin-bottom:8px;}
  .foot{margin-top:28px;padding-top:14px;border-top:1px solid #ECE5DA;font-size:12px;color:#8A8078;}
  @media print{body{padding:0;}}
</style>
</head>
<body>
  <p class="dh">${escHtml(FRAMING_TITLE)}</p>
  <p class="dsub">${escHtml(s.rangeLabel)}<br>${escHtml(FRAMING_DISCLAIMER)}<br>Generated ${escHtml(formatGenDate(s.generatedAtISO))} — ${escHtml(FRAMING_GENERATED)}.</p>
  ${sec.join('\n  ')}
  <p class="foot">This summary was generated on-device from entries she recorded herself. It is not a clinical chart and has not been reviewed by a clinician.</p>
</body>
</html>
`;
}

/**
 * Facts-only guard for tests: scans rendered output for language the
 * builder must never emit (diagnoses, risk language, severity judgments,
 * normal ranges, clinical directives). Returns the offending matches.
 * User-entered text is reproduced verbatim, so this guard is applied to
 * the *framing + section templates* — tests use benign fixture text.
 */
const FACTS_ONLY_BANNED: RegExp[] = [
  /diagnos/i,
  /\brisk\b/i,
  /abnormal/i,
  /normal range/i,
  /severity/i,
  /concerning/i,
  /alarming/i,
  /\bprognosis\b/i,
  /you should (see|call|visit)/i,
  /recommend/i,
  /clinician-reviewed/i,
  /medically (reviewed|approved)/i,
];

export function factsOnlyViolations(rendered: string): string[] {
  return FACTS_ONLY_BANNED.filter((re) => re.test(rendered)).map((re) => re.source);
}
