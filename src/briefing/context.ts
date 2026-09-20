/**
 * Anonymized briefing context (track 3).
 *
 * Builds the ONLY payload the app is allowed to send to the `week-briefing`
 * edge function. The output is deliberately identifier-free:
 *
 *   INCLUDED: gestational week (4–42) + day of week (1–7), firstTimeMom flag,
 *             optional age band, up to 5 canonical symptom-theme labels from
 *             the last 14 days.
 *   NEVER:    due date, names, emails, DOB, free-text log content, note text,
 *             photo/file references, event ids, user ids.
 *
 * Two free-text guards:
 * - Symptom labels are accepted ONLY when they match the canonical catalog
 *   (`SYMPTOM_NAMES`, case-insensitive). The symptom sheet lets her type
 *   custom text — those entries are dropped here so no free text ever
 *   leaves the device.
 * - Only the lowercased canonical label goes out; no dates, no counts, no
 *   note text, no energy/water fields.
 *
 * Pure core: `buildBriefingContextFrom(deps)` takes everything as
 * arguments, so it unit-tests without Expo/SQLite. `buildBriefingContext()`
 * is the zero-arg on-device entry; it lazy-requires the store/db so that
 * importing this module in a test runner never touches native modules.
 */

import { addDaysISO, gestationalDays, pregnancyWeek, todayISO } from '../onboarding/dates';
import type { LocalEvent, Pregnancy } from '../lib/types';

/**
 * Canonical symptom-name catalog for theme extraction. These plain labels
 * mirror the canonical names in the committed `src/composer/intent.ts`
 * (the composer's intent detector); kept local so the briefing module has
 * no dependency on the logging sheets.
 */
const SYMPTOM_NAMES: readonly string[] = [
  'Nausea',
  'Vomiting',
  'Fatigue',
  'Headache',
  'Backache',
  'Heartburn',
  'Swelling',
  'Cramps',
  'Dizziness',
  'Insomnia',
  'Bloating',
  'Constipation',
];

/** Optional age band, stored in local kv under AGE_BAND_KV_KEY. */
export type AgeBandValue = 'under-25' | '25-29' | '30-34' | '35-39' | '40-plus';

export const AGE_BAND_KV_KEY = 'briefing.ageBand';

export const AGE_BAND_OPTIONS: ReadonlyArray<{ value: AgeBandValue; label: string }> = [
  { value: 'under-25', label: 'Under 25' },
  { value: '25-29', label: '25–29' },
  { value: '30-34', label: '30–34' },
  { value: '35-39', label: '35–39' },
  { value: '40-plus', label: '40+' },
];

const AGE_BAND_SET: ReadonlySet<string> = new Set(AGE_BAND_OPTIONS.map((o) => o.value));

function isAgeBand(v: unknown): v is AgeBandValue {
  return typeof v === 'string' && AGE_BAND_SET.has(v);
}

/**
 * The anonymized context. Every field is safe to send to the edge function;
 * there is intentionally no field in which an identifier could hide.
 */
export interface BriefingContext {
  /** Gestational week, 1-indexed, 4..42. */
  week: number;
  /** Day of the gestational week, 1-indexed, 1..7. */
  day: number;
  firstTimeMom: boolean;
  ageBand?: AgeBandValue;
  /** Distinct canonical symptom labels, most-recent first, max 5. */
  symptomThemes: string[];
}

/** Inputs to the pure builder. The app supplies these from local state. */
export interface BriefingDeps {
  pregnancy: Pick<Pregnancy, 'dueDate' | 'parity'> | null;
  /** Raw kv value for AGE_BAND_KV_KEY; non-canonical values are dropped. */
  ageBand: string | null;
  /** Symptom-type events from the last 14 days (newest first). */
  symptomEvents: Array<Pick<LocalEvent, 'type' | 'occurredAt' | 'data'>>;
  /** Today as YYYY-MM-DD in the device's local calendar. */
  today: string;
}

const CANONICAL_SYMPTOMS: ReadonlySet<string> = new Set(
  SYMPTOM_NAMES.map((s) => s.toLowerCase()),
);

const MAX_THEMES = 5;

/**
 * Extracts distinct canonical symptom labels (most-recent first, max 5).
 * Non-canonical entries — including anything she typed freehand in the
 * symptom sheet — are dropped: no free text leaves the device.
 */
function extractSymptomThemes(
  events: BriefingDeps['symptomEvents'],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of events) {
    if (e.type !== 'symptom') continue;
    const arr = e.data?.symptoms;
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (typeof raw !== 'string') continue;
      const label = raw.trim().toLowerCase();
      if (label.length === 0 || !CANONICAL_SYMPTOMS.has(label)) continue;
      if (seen.has(label)) continue;
      seen.add(label);
      if (out.length < MAX_THEMES) out.push(label);
    }
    if (out.length >= MAX_THEMES) break;
  }
  return out;
}

/**
 * Pure builder: anonymized briefing context, or null when there is no
 * usable pregnancy (no due date, unparseable, not yet started) or when the
 * gestational week falls outside the edge function's 4..42 contract.
 */
export function buildBriefingContextFrom(deps: BriefingDeps): BriefingContext | null {
  const due = deps.pregnancy?.dueDate;
  if (!due) return null;
  const g = gestationalDays(due, deps.today);
  if (g === null || g < 0) return null;
  const week = pregnancyWeek(due, deps.today); // the one shared helper — same number every screen shows
  if (week === null) return null; // unreachable: g above already parsed both dates
  const day = (g % 7) + 1; // 1..7 (weekOf in dates.ts uses 0..6)
  if (week < 4 || week > 42) return null;
  const ctx: BriefingContext = {
    week,
    day,
    firstTimeMom: deps.pregnancy?.parity === 'first',
    symptomThemes: extractSymptomThemes(deps.symptomEvents),
  };
  if (isAgeBand(deps.ageBand)) ctx.ageBand = deps.ageBand;
  return ctx;
}

/* ------------------------------------------------------------------ */
/* On-device entry points. Lazy requires keep this module importable   */
/* in test runners without Expo/SQLite. Never throws.                  */
/* ------------------------------------------------------------------ */

/** Dynamic require boundary: module shape is checked at the call site, not here. */
type AnyModule = Record<string, any>;

declare const require: (id: string) => unknown;

/**
 * Lazy dependency resolution. Two constraints shape this:
 * - Metro only bundles `require()` with a static string literal — a
 *   variable id fails the export with "Invalid call".
 * - The web export bundle has no *global* `require` (only the per-module
 *   one Metro injects), so `globalThis.require` lookups are undefined.
 * Each dependency therefore gets its own tiny wrapper with a literal
 * path, called only at runtime on-device. The node unit-test runner never
 * calls these, so the module stays importable there.
 */
function lazyStore(): AnyModule {
  return require('../sync/store') as AnyModule;
}

function lazyDb(): AnyModule {
  return require('../lib/db') as AnyModule;
}

/**
 * Zero-arg on-device builder: reads the active pregnancy, the optional
 * age band, and the last 14 days of symptom events from local storage,
 * and returns the anonymized context — or null when there is nothing
 * safe to send. Never throws.
 */
export function buildBriefingContext(): BriefingContext | null {
  try {
    const store = lazyStore();
    const db = lazyDb();
    const today = todayISO();
    const start = addDaysISO(today, -13); // 14-day window, inclusive
    const end = addDaysISO(today, 1);
    if (!start || !end) return null;
    const pregnancy = store.getActivePregnancy() as Pregnancy | null;
    const events = store.listEventsInRange(start, end) as LocalEvent[];
    return buildBriefingContextFrom({
      pregnancy,
      ageBand: db.kvGet(AGE_BAND_KV_KEY) as string | null,
      symptomEvents: events,
      today,
    });
  } catch {
    return null;
  }
}

/** Reads the stored age band, or null when unset/invalid. Never throws. */
export function getAgeBand(): AgeBandValue | null {  try {
    const v = lazyDb().kvGet(AGE_BAND_KV_KEY) as string | null;
    return isAgeBand(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Stores (or clears, with null) the age band. The value is local-only —
 * the edge function only ever receives it inside an anonymous context.
 */
export function setAgeBand(band: AgeBandValue | null): void {
  const db = lazyDb();
  if (band === null) db.kvDelete(AGE_BAND_KV_KEY);
  else db.kvSet(AGE_BAND_KV_KEY, band);
}

/* ------------------------------------------------------------------ */
/* Baby name (Anuraj, Sept 2026): optional, user-supplied, local-only.  */
/*                                                                     */
/* The name is captured in onboarding (skippable) and editable in the  */
/* You tab. It NEVER enters BriefingContext and is NEVER sent to the   */
/* edge function — curated copy carries {Name}/{name} tokens instead,  */
/* and the real name is substituted on-device at briefing assembly      */
/* (see withBabyName, applied in policy.toBriefing). Delight cards are  */
/* never phrased, so their tokens are equally safe.                    */
/* ------------------------------------------------------------------ */

/** Optional baby name, stored in local kv under BABY_NAME_KV_KEY. Local-only: never synced, never sent off-device. */
export const BABY_NAME_KV_KEY = 'briefing.babyName';

/** Token for the name in sentence-initial (capitalized) position. */
export const BABY_NAME_TOKEN_CAP = '{Name}';
/** Token for the name in mid-sentence (lowercase) position. */
export const BABY_NAME_TOKEN = '{name}';

/** Reads the stored baby name (trimmed), or null when unset/blank. Never throws. */
export function getBabyName(): string | null {
  try {
    const v = lazyDb().kvGet(BABY_NAME_KV_KEY) as string | null;
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

/**
 * Stores (or clears, with null/blank) the baby name. Local-only — the
 * value lives in the on-device kv store and is never synced or sent to
 * the phraser. Never throws.
 */
export function setBabyName(name: string | null): void {
  try {
    const db = lazyDb();
    if (name === null || name.trim().length === 0) db.kvDelete(BABY_NAME_KV_KEY);
    else db.kvSet(BABY_NAME_KV_KEY, name.trim());
  } catch {
    // A failed write keeps the previous value; the UI still works.
  }
}

/**
 * Substitutes the {Name}/{name} tokens in curated copy with the baby's
 * name when one is set, or the generic fallback otherwise. Pure.
 * "{Name}'s" → "<name>'s" / "Your baby's" — the possessive rides along.
 *
 * The name is inserted verbatim (trimmed) for both tokens — the token case
 * only selects the fallback: sentence-initial `{Name}` → "Your baby",
 * mid-sentence `{name}` → "your baby". Curated copy must use the token
 * whose case matches the grammatical position.
 */
export function withBabyName(text: string, name: string | null | undefined): string {
  const clean = typeof name === 'string' ? name.trim() : '';
  const cap = clean.length > 0 ? clean : 'Your baby';
  const low = clean.length > 0 ? clean : 'your baby';
  return text.split(BABY_NAME_TOKEN_CAP).join(cap).split(BABY_NAME_TOKEN).join(low);
}

/** One journal entry for the look-back teaser: id, text, local date. */
export interface NoteLogEntry {
  id: string;
  text: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
}

/**
 * Zero-arg on-device reader: note-type events from the last 120 days with
 * their text. The engine quotes one entry verbatim in the quiet-day
 * look-back teaser; nothing here ever leaves the device. Never throws.
 */
export function getRecentNoteLogs(): NoteLogEntry[] {
  try {
    const store = lazyStore();
    const today = todayISO();
    const start = addDaysISO(today, -120);
    if (!start) return [];
    const events = store.listEventsInRange(start, today, 50) as LocalEvent[];
    const out: NoteLogEntry[] = [];
    for (const e of events) {
      if (e.type !== 'note' || e.deletedAt) continue;
      const data = e.data as Record<string, unknown> | undefined;
      const raw = data?.text ?? data?.note;
      if (typeof raw !== 'string' || raw.trim().length === 0) continue;
      const date =
        typeof e.occurredAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.occurredAt)
          ? e.occurredAt.slice(0, 10)
          : today;
      out.push({ id: e.id, text: raw, date });
    }
    return out;
  } catch {
    return [];
  }
}
