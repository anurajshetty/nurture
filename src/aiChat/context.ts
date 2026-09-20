/**
 * Ask Willow context assembly (Anuraj, Sept 20, 2026).
 *
 * Per request the app sends, and ONLY:
 * - pregnancy week / stage, due date, baby's name if set
 * - ~14 days of recent log/symptom summaries (text lines, capped)
 * - 5 recent report summaries
 * - 6 recent chat turns (from on-device history — the server is stateless)
 *
 * No photos, no complete history, no identifiers beyond these fields.
 * All text is truncated; unknown-shaped event data is summarized
 * defensively and never crashes the send.
 */

import type { AskWillowContext } from './client';
import { recentTurnsForContext } from './history';
import { getBabyName } from '../briefing/context';
import { getActivePregnancy } from '../sync/store';
import { pregnancyWeek, todayISO, addDaysISO } from '../onboarding/dates';
import { listEventsInRange, listEvents } from '../sync/store';
import type { LocalEvent } from '../lib/types';

const MAX_LOG_LINES = 20;
const MAX_LOG_CHARS = 300;
const MAX_REPORTS = 5;
const MAX_REPORT_CHARS = 500;

function trimesterOfWeek(week: number): string {
  if (week <= 13) return 'first trimester';
  if (week <= 27) return 'second trimester';
  return 'third trimester';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** One text line per log/symptom event. Defensive: unknown data shapes
 *  degrade to the event type rather than crashing. */
function summarizeEvent(e: LocalEvent): string | null {
  const data = e.data ?? {};
  if (e.type === 'symptom') {
    const names = Array.isArray(data.symptoms)
      ? (data.symptoms as unknown[]).filter((s) => typeof s === 'string')
      : [];
    const bits: string[] = [];
    if (names.length > 0) bits.push(`symptoms: ${names.join(', ')}`);
    const note = str(data.text) ?? str(data.note);
    if (note) bits.push(note);
    const line = bits.join(' — ');
    return line ? `symptom: ${line}` : 'symptom logged';
  }
  if (e.type === 'mood') {
    const mood = str(data.mood) ?? str(data.value);
    return mood ? `mood: ${mood}` : 'mood logged';
  }
  const text = str(data.text) ?? str(data.note) ?? str(data.caption);
  if (text) return `${e.type}: ${text}`;
  return null;
}

function summarizeReport(e: LocalEvent): string | null {
  const data = e.data ?? {};
  const summary = data.reportSummary;
  if (typeof summary !== 'object' || summary === null) return null;
  const s = summary as Record<string, unknown>;
  if (s.status !== 'ready') return null;
  const title = str(s.title) ?? 'Report';
  const body = str(s.summary) ?? '';
  return body ? `${title}: ${body}` : title;
}

/**
 * Assemble the context for one chat request. Reads only local state;
 * returns null only when there is no active pregnancy.
 */
export function buildAskContext(): AskWillowContext {
  const pregnancy = getActivePregnancy();
  const dueDate = pregnancy?.dueDate ?? null;
  const completedWeek = dueDate ? pregnancyWeek(dueDate, todayISO()) : null;
  // Displayed week = the week she is IN (completed + 1), same as the
  // Week tab heading (Anuraj, Sept 2026).
  const week = completedWeek !== null ? completedWeek + 1 : null;

  let recentLogs: string[] = [];
  try {
    const start = addDaysISO(todayISO(), -13);
    const end = addDaysISO(todayISO(), 1);
    if (start && end) {
      const events = listEventsInRange(start, end, 200).filter((e) =>
        ['note', 'symptom', 'mood', 'weight', 'kick_session', 'milestone'].includes(e.type),
      );
      recentLogs = events
        .map(summarizeEvent)
        .filter((s): s is string => s !== null)
        .slice(0, MAX_LOG_LINES)
        .map((s) => (s.length > MAX_LOG_CHARS ? s.slice(0, MAX_LOG_CHARS - 1) + '…' : s));
    }
  } catch {
    recentLogs = [];
  }

  let reportSummaries: string[] = [];
  try {
    reportSummaries = listEvents(200)
      .filter((e) => e.type === 'report')
      .map(summarizeReport)
      .filter((s): s is string => s !== null)
      .slice(0, MAX_REPORTS)
      .map((s) => (s.length > MAX_REPORT_CHARS ? s.slice(0, MAX_REPORT_CHARS - 1) + '…' : s));
  } catch {
    reportSummaries = [];
  }

  return {
    week,
    stage: week !== null ? trimesterOfWeek(week) : 'unknown',
    dueDate,
    babyName: getBabyName(),
    recentLogs,
    reportSummaries,
    history: recentTurnsForContext(),
  };
}
