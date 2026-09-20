/**
 * Epic 5 — Week view content assembly (pure, no native modules).
 *
 * All content is bundled: the v1.1 matrix (curated weeks 36–42, graceful
 * fallback for the rest), SIZE_BY_WEEK (weeks 1–40), and the question
 * bank below. Nothing is fetched, so the Week tab renders fully offline.
 *
 * Content rules (non-negotiable):
 * - General information only. Never "you should/shouldn't".
 * - No risk rates, no warning-sign lists, no diagnosis.
 * - Questions are prompts for her care team, never advice.
 * - Never describe this content as clinician-reviewed.
 */

import { getMatrixRow } from '../briefing/matrix';
import { SIZE_BY_WEEK } from '../briefing/delight';
import { gestationalDays, pregnancyWeek } from '../onboarding/dates';

/** Shape of SIZE_BY_WEEK entries (see src/briefing/delight.ts). */
export interface SizeEntry {
  staple: string;
  delight: string;
  length: string;
  weight: string;
}

/** Lowest / highest gestational week the Week tab will render. */
export const MIN_WEEK = 4;
export const MAX_WEEK = 42;

/** One reading section on the Week tab (expands in place). */
export interface WeekReading {
  id: string;
  title: string;
  /** e.g. "3 min read · Available offline" */
  subtitle: string;
  /** Paragraphs, in order. */
  body: string[];
}

/** Everything the Week tab renders for one gestational week. */
export interface WeekContent {
  week: number;
  /** Null outside SIZE_BY_WEEK's 1–40 coverage — the UI shows a soft fallback. */
  size: SizeEntry | null;
  /** Exactly 3 highlight lines. */
  highlights: [string, string, string];
  readings: WeekReading[];
  /** 2 care-team questions. */
  questions: [string, string];
  /** e.g. "Sep 14 – 20". Null when the range can't be computed. */
  weekRange: string | null;
  weeksToGo: number;
}

/**
 * Completed gestational week for a due date as of a YYYY-MM-DD day — the
 * one shared helper in onboarding/dates (pregnancyWeek). Returns null when
 * the due date is missing/unparseable, the pregnancy hasn't begun, or the
 * week falls outside the 4–42 content contract.
 */
export function getWeekNumber(
  dueDate: string | null | undefined,
  todayISO: string,
): number | null {
  if (!dueDate) return null;
  const week = pregnancyWeek(dueDate, todayISO);
  if (week === null) return null;
  if (week < MIN_WEEK || week > MAX_WEEK) return null;
  return week;
}

/* ------------------------------------------------------------------ */
/* Care-team questions. Gentle prompts, never advice. Curated for the  */
/* v1.1 weeks (36–42); warm generic pair everywhere else.              */
/* ------------------------------------------------------------------ */

const CURATED_QUESTIONS: Record<number, [string, string]> = {
  36: [
    'Anything you want in your birth plan while it\u2019s on your mind?',
    'Questions about the hospital bag checklist?',
  ],
  37: [
    'What should you expect at check-ins from here on?',
    'Anything about the early signs of labor you\u2019d like to ask about?',
  ],
  38: [
    'Anything on your mind as full term gets closer?',
    'Questions about your care team\u2019s plan for the coming weeks?',
  ],
  39: [
    'Anything you\u2019d like to ask before the due date arrives?',
    'Questions about rest, movement, or how you\u2019re feeling day to day?',
  ],
  40: [
    'Anything on your mind now that the due date is here?',
    'Questions about what happens next if baby stays cozy a while longer?',
  ],
  41: [
    'What does your care team suggest for this week?',
    'Anything you want to ask about extra check-ins?',
  ],
  42: [
    'What\u2019s the plan your care team suggests from here?',
    'Anything at all you\u2019d like to talk through together?',
  ],
};

const FALLBACK_QUESTIONS: [string, string] = [
  'Anything on your mind for your next visit?',
  'Anything about how you\u2019re feeling that you\u2019d like to ask about?',
];

export function getWeekQuestions(week: number): [string, string] {
  return CURATED_QUESTIONS[week] ?? FALLBACK_QUESTIONS;
}

/* ------------------------------------------------------------------ */
/* Reading assembly                                                   */
/* ------------------------------------------------------------------ */

const WORDS_PER_MINUTE = 200;

function readTime(body: string[]): string {
  const words = body.join(' ').split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return `${mins} min read`;
}

function reading(
  id: string,
  title: string,
  body: string[],
): WeekReading {
  return {
    id,
    title,
    subtitle: `${readTime(body)} · Available offline`,
    body,
  };
}

/* ------------------------------------------------------------------ */
/* Week range label                                                   */
/* ------------------------------------------------------------------ */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDay(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/**
 * "Sep 14 – 20" for the gestational week containing `todayISO`, given the
 * due date. Returns null when the dates don't parse.
 */
export function getWeekRangeLabel(
  dueDate: string,
  todayISO: string,
): string | null {
  const due = parseISODate(dueDate);
  const today = parseISODate(todayISO);
  if (!due || !today) return null;
  const g = gestationalDays(dueDate, todayISO);
  if (g === null || g < 0) return null;
  const dayOfWeek = g % 7; // 0 = first day of this gestational week
  const start = new Date(today);
  start.setDate(start.getDate() - dayOfWeek);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const startLabel = fmtDay(start);
  const endLabel =
    start.getMonth() === end.getMonth()
      ? String(end.getDate())
      : fmtDay(end);
  return `${startLabel} – ${endLabel}`;
}

/* ------------------------------------------------------------------ */
/* Name tokens + warm greeting                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolves the {Name}/{name} tokens in curated copy on-device with the
 * saved baby name, falling back to warm generic "your baby" wording.
 * Sentence-initial {Name} capitalizes the fallback ("Your baby").
 */
export function resolveNameTokens(
  text: string,
  babyName: string | null | undefined,
): string {
  const name = babyName?.trim() ? babyName.trim() : null;
  return text
    .replaceAll('{Name}', name ?? 'Your baby')
    .replaceAll('{name}', name ?? 'your baby');
}

/**
 * Warm stage-based greeting for the top of the Week screen
 * (Anuraj, Sept 2026). Uses the saved baby name when present.
 * Read aloud before shipping — each line should sound spoken.
 */
export function weekGreeting(
  week: number,
  babyName: string | null | undefined,
): string {
  const name = babyName?.trim() ? babyName.trim() : null;
  if (week >= 37)
    return name
      ? `Hey, you're almost there. Any day now, ${name}.`
      : `Hey, you're almost there.`;
  if (week >= 28)
    return name ? `The home stretch. ${name} is nearly here.` : `The home stretch.`;
  if (week >= 13)
    return name
      ? `Look how far you and ${name} have come.`
      : `Look how far you've come.`;
  return name ? `The beginning of everything, ${name}.` : `The beginning of everything.`;
}

/* ------------------------------------------------------------------ */
/* Main assembly                                                      */
/* ------------------------------------------------------------------ */

/**
 * Assembles everything the Week tab shows for a gestational week.
 * Never throws, never returns undefined fields — the UI can render it
 * directly. All sources are bundled, so this works fully offline.
 *
 * `babyName` (optional) resolves the {Name}/{name} tokens in curated
 * copy; when absent, warm generic "your baby" wording is used.
 */
export function getWeekContent(
  week: number,
  dueDate: string,
  todayISO: string,
  babyName?: string | null,
): WeekContent {
  const row = getMatrixRow(week);
  const size = SIZE_BY_WEEK[week] ?? null;

  const babySeeds = row.routineSeeds.baby;
  const highlights: [string, string, string] = [
    resolveNameTokens(row.anchors.baby, babyName),
    resolveNameTokens(babySeeds[0] ?? row.anchors.baby, babyName),
    resolveNameTokens(
      babySeeds[1] ?? babySeeds[0] ?? row.anchors.baby,
      babyName,
    ),
  ];

  const readings: WeekReading[] = [
    reading(
      'body',
      'Your body this week',
      row.routineSeeds.body.map((p) => resolveNameTokens(p, babyName)),
    ),
    reading(
      'tips',
      'Tips for this week',
      row.routineSeeds.tips.map((p) => resolveNameTokens(p, babyName)),
    ),
  ];

  return {
    week,
    size,
    highlights,
    readings,
    questions: getWeekQuestions(week),
    weekRange: getWeekRangeLabel(dueDate, todayISO),
    weeksToGo: Math.max(0, 40 - week),
  };
}

/**
 * True when the Week tab should render developmental content for this
 * pregnancy. False when tracking is stopped (Epic 9) — the tab goes
 * quiet: no size, no highlights, no reading, no questions.
 */
export function shouldShowWeekContent(
  pregnancy: { status: 'active' | 'stopped' } | null,
): boolean {
  return pregnancy?.status === 'active';
}
