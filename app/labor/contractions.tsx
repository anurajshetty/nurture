/**
 * Labor readiness — contraction timer (Willow, Sept 2026).
 * Design source of truth: mockup 27-labor-readiness-contractions.html
 * (Anuraj approved Sept 20, 2026).
 *
 * One-tap timing for mid-labor: a giant start/stop target, a calm
 * six-hour history with forgiving edit & delete, a night treatment for
 * 3 AM, and a screen that stays awake while timing. The 5-1-1 note is
 * quiet and informational only — no alarms, no triage language, no
 * "go to hospital" wording (designer's hard rule).
 *
 * Storage: device-local KV (`labor.contractions.v1`) — works fully
 * offline, no account. Contractions deliberately do NOT go through the
 * events table, so they never leak into the Logs journal feed; the
 * timer's own history is the single home for them.
 *
 * Pure helpers (timer math, history derivation, persistence) are exported
 * for the unit suite: tests/labor-contractions.test.ts. They never throw
 * outward.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { BottomSheet, Card, Screen } from '../../src/components';
import { kvGet, kvSet } from '../../src/lib/db';
import { newVisitEntries } from '../../src/labor/feed';
import { saveContractionSession } from '../../src/labor/feedStore';
import {
  colors,
  minTouch,
  radii,
  shadow,
  spacing,
  type as typeScale,
} from '../../src/theme/tokens';
import { LABOR_DISCLAIMER, TIMER_COPY as C } from '../../src/labor/copy';
import { requestScreenWakeLock } from '../../src/labor/keepAwake';

/* ------------------------------------------------------------------ */
/* Pure logic (unit-tested).                                           */
/* ------------------------------------------------------------------ */

/** One timed contraction. `startedAt` is an ISO 8601 timestamp. */
export interface ContractionEntry {
  id: string;
  startedAt: string;
  /** Length in whole seconds. */
  durationSec: number;
  /**
   * Frozen start-to-start gap (seconds) to the next (newer) contraction.
   * Recorded once, at the moment the successor is logged — never derived
   * from "now", so history rows never render a live-ticking clock.
   * `null` for the newest entry, which has no successor yet (renders "—").
   */
  apartSec?: number | null;
}

const CONTRACTIONS_KV_KEY = 'labor.contractions.v1';
/** History scope: the last six hours ("Tonight's history"). */
export const HISTORY_WINDOW_MS = 6 * 3600_000;
/** The 5-1-1 note surfaces only with this many recent entries… */
const FIVE_ONE_ONE_MIN_ENTRIES = 3;
/** …whose average interval is at most this (quiet, informational). */
const FIVE_ONE_ONE_MAX_AVG_INTERVAL_SEC = 6 * 60;
/** Manual edits clamp to this range (5s–10min), in 5s steps. */
const MIN_DURATION_SEC = 5;
const MAX_DURATION_SEC = 600;
const DURATION_STEP_SEC = 5;
const MAX_STORED = 300;

export function clampDurationSec(sec: number): number {
  if (!Number.isFinite(sec)) return MIN_DURATION_SEC;
  return Math.min(
    MAX_DURATION_SEC,
    Math.max(MIN_DURATION_SEC, Math.round(sec / DURATION_STEP_SEC) * DURATION_STEP_SEC),
  );
}

/** "M:SS" — 62 → "1:02". */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** Device-local "3:42 AM". Empty string on bad input. */
export function formatTimeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "about 5 minutes" — soft wording for the history summary. */
export function formatApproxInterval(sec: number): string {
  if (!Number.isFinite(sec) || sec < 90) return 'about a minute';
  return `about ${Math.round(sec / 60)} minutes`;
}

/** Whole seconds between two epoch-ms timestamps (≥1). */
export function durationSecBetween(startedAtMs: number, endedAtMs: number): number {
  return Math.max(1, Math.round((endedAtMs - startedAtMs) / 1000));
}

/** Whole seconds from the previous contraction's start to this one's (≥0). */
export function intervalSecBetween(
  prevStartedAtMs: number,
  startedAtMs: number,
): number {
  return Math.max(0, Math.round((startedAtMs - prevStartedAtMs) / 1000));
}

/** Tolerant parse: garbage in → null, never throws. */
export function readContraction(raw: unknown): ContractionEntry | null {
  try {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' && r.id.length > 0 ? r.id : null;
    const startedAt =
      typeof r.startedAt === 'string' && !Number.isNaN(Date.parse(r.startedAt))
        ? r.startedAt
        : null;
    const durationSec =
      typeof r.durationSec === 'number' && Number.isFinite(r.durationSec)
        ? Math.max(1, Math.round(r.durationSec))
        : null;
    // apartSec is optional (legacy rows predate it); tolerate garbage.
    const apartSec =
      typeof r.apartSec === 'number' &&
      Number.isFinite(r.apartSec) &&
      r.apartSec >= 0
        ? Math.round(r.apartSec)
        : null;
    if (!id || !startedAt || durationSec === null) return null;
    return { id, startedAt, durationSec, apartSec };
  } catch {
    return null;
  }
}

export function newContractionId(): string {
  return `cx-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function byNewest(a: ContractionEntry, b: ContractionEntry): number {
  return b.startedAt.localeCompare(a.startedAt);
}

/** All stored contractions, newest first. Never throws. */
export function loadContractions(): ContractionEntry[] {
  try {
    const raw = kvGet(CONTRACTIONS_KV_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ContractionEntry[] = [];
    for (const item of parsed) {
      const e = readContraction(item);
      if (e) out.push(e);
    }
    return out.sort(byNewest);
  } catch {
    return [];
  }
}

function persistAll(entries: readonly ContractionEntry[]): void {
  try {
    // apartSec is (re)frozen here — the only place values are recorded —
    // so renders never need "now" and history rows never tick.
    const trimmed = backfillAparts(entries).slice(0, MAX_STORED);
    kvSet(CONTRACTIONS_KV_KEY, JSON.stringify(trimmed));
  } catch {
    /* never throw outward */
  }
}

/**
 * Freezes every entry's `apartSec` (start-to-start gap to its successor,
 * newest first). The newest entry has no successor yet → `apartSec: null`,
 * rendered as a static "—". Recomputed only when the stored list changes
 * (log / edit / delete), so deleting a middle entry correctly re-points
 * its older neighbor at the new successor. Idempotent and never throws.
 */
export function backfillAparts(
  entries: readonly ContractionEntry[],
): ContractionEntry[] {
  const sorted = [...entries].sort(byNewest);
  return sorted.map((e, i) => {
    if (i === 0) return { ...e, apartSec: null };
    const newerMs = Date.parse(sorted[i - 1].startedAt);
    const mineMs = Date.parse(e.startedAt);
    const apartSec =
      !Number.isNaN(newerMs) &&
      !Number.isNaN(mineMs) &&
      newerMs >= mineMs
        ? intervalSecBetween(mineMs, newerMs)
        : null;
    return { ...e, apartSec };
  });
}

/**
 * Display value for a history row's "apart" segment. Prefers the frozen
 * `apartSec` recorded when the successor was logged; for legacy rows that
 * predate it, derives the gap statically from the successor's start.
 * The newest entry (no successor) → `null`, rendered as a static "—".
 * Never derived from "now" — no live-ticking numbers on history rows.
 */
export function apartForRow(
  entry: ContractionEntry,
  successor: ContractionEntry | null,
): number | null {
  if (
    typeof entry.apartSec === 'number' &&
    Number.isFinite(entry.apartSec) &&
    entry.apartSec >= 0
  ) {
    return entry.apartSec;
  }
  if (!successor) return null;
  const newerMs = Date.parse(successor.startedAt);
  const mineMs = Date.parse(entry.startedAt);
  if (Number.isNaN(newerMs) || Number.isNaN(mineMs) || newerMs < mineMs) {
    return null;
  }
  return intervalSecBetween(mineMs, newerMs);
}

/** Appends one logged contraction; returns the new full list. */
export function logContraction(entry: ContractionEntry): ContractionEntry[] {
  const seen = new Set<string>();
  const all = [entry, ...loadContractions()].filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  persistAll(all);
  return all;
}

/** Rewrites one entry's duration (mistap fix); returns the full list. */
export function updateContractionDuration(
  id: string,
  durationSec: number,
): ContractionEntry[] {
  const all = loadContractions().map((e) =>
    e.id === id ? { ...e, durationSec: clampDurationSec(durationSec) } : e,
  );
  persistAll(all);
  return all;
}

/** Removes one entry; returns the full list. */
export function removeContraction(id: string): ContractionEntry[] {
  const all = loadContractions().filter((e) => e.id !== id);
  persistAll(all);
  return all;
}

/**
 * Entries within the history window (default: last 6 hours), newest
 * first. Future-dated rows are excluded.
 */
export function recentContractions(
  all: readonly ContractionEntry[],
  nowMs: number,
  windowMs: number = HISTORY_WINDOW_MS,
): ContractionEntry[] {
  return all.filter((e) => {
    const t = Date.parse(e.startedAt);
    return !Number.isNaN(t) && t <= nowMs && nowMs - t <= windowMs;
  });
}

/**
 * Average interval (start-to-start, seconds) across consecutive entries,
 * newest first. Null with fewer than two entries.
 */
export function averageIntervalSec(
  entries: readonly ContractionEntry[],
): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 1 < entries.length; i++) {
    const a = Date.parse(entries[i].startedAt);
    const b = Date.parse(entries[i + 1].startedAt);
    if (!Number.isNaN(a) && !Number.isNaN(b) && a > b) {
      sum += (a - b) / 1000;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

/**
 * The quiet 5-1-1 note surfaces only when a pattern has actually
 * emerged: at least 3 recent entries averaging ≤6 minutes apart.
 * Informational only — never an alarm, never triage.
 */
export function showsFiveOneOneNote(
  all: readonly ContractionEntry[],
  nowMs: number,
): boolean {
  const recent = recentContractions(all, nowMs);
  if (recent.length < FIVE_ONE_ONE_MIN_ENTRIES) return false;
  const avg = averageIntervalSec(recent);
  return avg !== null && avg <= FIVE_ONE_ONE_MAX_AVG_INTERVAL_SEC;
}

export interface HistorySummary {
  count: number;
  /** "3:42 AM" — the latest entry's time. */
  lastLabel: string;
  avgIntervalSec: number | null;
}

/** The "N timed · last at T — about X apart" line, or null when empty. */
export function historySummary(
  all: readonly ContractionEntry[],
  nowMs: number,
): HistorySummary | null {
  const recent = recentContractions(all, nowMs);
  if (recent.length === 0) return null;
  return {
    count: recent.length,
    lastLabel: formatTimeOfDay(recent[0].startedAt),
    avgIntervalSec: averageIntervalSec(recent),
  };
}

/* ------------------------------------------------------------------ */
/* Palette (day + the 3 AM night treatment).                           */
/* ------------------------------------------------------------------ */

interface Pal {
  bg: string;
  card: string;
  ink: string;
  body: string;
  muted: string;
  line: string;
  blush: string;
  coral: string;
  coralDeep: string;
}

function pal(night: boolean): Pal {
  return night
    ? {
        bg: '#1F1812',
        card: '#2C231A',
        ink: '#F6EEE1',
        body: '#D9CDBB',
        muted: '#A89A86',
        line: '#453729',
        blush: '#38291C',
        coral: colors.coral,
        coralDeep: '#E8937A',
      }
    : {
        bg: colors.bg,
        card: colors.card,
        ink: colors.ink,
        body: '#5C554D',
        muted: colors.muted,
        line: colors.line,
        blush: colors.blush,
        coral: colors.coral,
        coralDeep: colors.coralDeep,
      };
}

/* ------------------------------------------------------------------ */
/* Wake lock — the screen stays awake while timing (mockup behavior).  */
/* Shared labor implementation (`src/labor/keepAwake.ts`): Web Wake     */
/* Lock API on web, expo-keep-awake on native.                          */
/* ------------------------------------------------------------------ */

function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const release = requestScreenWakeLock();
    return () => {
      release();
    };
  }, [active]);
}

/* ------------------------------------------------------------------ */
/* Screen.                                                             */
/* ------------------------------------------------------------------ */

type TimerView = 'idle' | 'timing' | 'logged' | 'history';

export default function ContractionTimerScreen() {
  const router = useRouter();
  const [view, setView] = useState<TimerView>('idle');
  const [night, setNight] = useState(false);
  const [entries, setEntries] = useState<ContractionEntry[]>([]);
  // Active timing session.
  const [sessionStartMs, setSessionStartMs] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Last logged contraction (the "logged" confirmation screen).
  const [lastLogged, setLastLogged] = useState<{
    durationSec: number;
    intervalSec: number | null;
  } | null>(null);
  // Edit sheet.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDurationSec, setEditDurationSec] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const p = pal(night);
  const timing = view === 'timing';
  useWakeLock(timing);

  const reload = () => setEntries(loadContractions());
  useFocusEffect(reload);

  const stopTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  useEffect(() => stopTick, []);

  /**
   * Labor feed (mockup 32, Anuraj approved Sept 21, 2026): ONE feed card
   * per timing visit. Snapshot the contraction ids at mount; on unmount
   * (leaving the timer), any id not in the snapshot was timed during
   * this visit and becomes a single summary card. Zero new contractions
   * → no card. Edits and deletions of older entries never create cards.
   * The store dedupes on the session key, so this is safe to re-run.
   */
  useEffect(() => {
    let baseline: Set<string>;
    try {
      baseline = new Set(loadContractions().map((e) => e.id));
    } catch {
      baseline = new Set();
    }
    return () => {
      try {
        const fresh = newVisitEntries(baseline, loadContractions());
        if (fresh.length > 0) saveContractionSession(fresh);
      } catch {
        /* the feed card must never break navigation */
      }
    };
  }, []);

  const startTiming = () => {
    stopTick();
    const now = Date.now();
    setSessionStartMs(now);
    setElapsedSec(0);
    tickRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - now) / 1000));
    }, 500);
    setView('timing');
  };

  const stopTiming = () => {
    stopTick();
    const now = Date.now();
    const prev = entries[0] ?? null;
    const entry: ContractionEntry = {
      id: newContractionId(),
      startedAt: new Date(sessionStartMs).toISOString(),
      durationSec: durationSecBetween(sessionStartMs, now),
    };
    const all = logContraction(entry);
    setEntries(all);
    setLastLogged({
      durationSec: entry.durationSec,
      intervalSec: prev
        ? intervalSecBetween(Date.parse(prev.startedAt), sessionStartMs)
        : null,
    });
    setView('logged');
  };

  const nowMs = Date.now();
  const recent = recentContractions(entries, nowMs);
  const summary = historySummary(entries, nowMs);
  const show511 = showsFiveOneOneNote(entries, nowMs);
  const editing = editingId ? entries.find((e) => e.id === editingId) ?? null : null;

  const openEdit = (id: string) => {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    setEditDurationSec(e.durationSec);
    setConfirmingDelete(false);
    setEditingId(id);
  };
  const closeEdit = () => {
    setEditingId(null);
    setConfirmingDelete(false);
  };

  // "Since last" / "Last length" stats while timing: relative to the
  // previous entry (the in-progress one has no duration yet).
  const prevEntry = entries[0] ?? null;
  const sinceLastSec = prevEntry
    ? intervalSecBetween(Date.parse(prevEntry.startedAt), sessionStartMs)
    : null;

  return (
    <Screen
      testID="timer-screen"
      bottomPadding={spacing.xxxl}
      style={{ backgroundColor: p.bg }}
      contentStyle={{ backgroundColor: p.bg }}
    >
      {/* Top nav: back (idle/logged/history), spacer while timing, moon */}
      <View style={styles.topnav}>
        {timing ? (
          <View style={styles.navSpacer} />
        ) : (
          <Pressable
            testID="timer-back"
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [
              styles.iconBtn,
              { borderColor: p.line, backgroundColor: p.card },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.iconGlyph, { color: p.ink }]}>‹</Text>
          </Pressable>
        )}
        <View style={styles.navSpacer} />
        <Pressable
          testID="timer-night-toggle"
          onPress={() => setNight((n) => !n)}
          accessibilityRole="button"
          accessibilityLabel={night ? 'Day mode' : 'Night mode'}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: p.line, backgroundColor: p.card },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={[styles.iconGlyph, { color: p.ink }]}>☾</Text>
        </Pressable>
      </View>

      {view === 'idle' && (
        <IdleView
          p={p}
          summary={summary}
          onStart={startTiming}
          onHistory={() => setView('history')}
        />
      )}

      {view === 'timing' && (
        <TimingView
          p={p}
          elapsedSec={elapsedSec}
          sinceLastSec={sinceLastSec}
          lastLengthSec={prevEntry?.durationSec ?? null}
          onStop={stopTiming}
        />
      )}

      {view === 'logged' && lastLogged && (
        <LoggedView
          p={p}
          durationSec={lastLogged.durationSec}
          intervalSec={lastLogged.intervalSec}
          onNext={startTiming}
          onHistory={() => setView('history')}
        />
      )}

      {view === 'history' && (
        <HistoryView
          p={p}
          recent={recent}
          nowMs={nowMs}
          show511={show511}
          onEdit={openEdit}
        />
      )}

      <Text style={[styles.disclaimer, { color: p.muted }]}>
        {LABOR_DISCLAIMER}
      </Text>

      {/* Edit sheet */}
      <BottomSheet
        visible={editing !== null}
        onClose={closeEdit}
        testID="timer-edit-sheet"
        accessibilityLabel="Edit contraction"
      >
        {editing && (
          <EditSheet
            p={p}
            entry={editing}
            durationSec={editDurationSec}
            setDurationSec={setEditDurationSec}
            confirmingDelete={confirmingDelete}
            onDone={() => {
              setEntries(updateContractionDuration(editing.id, editDurationSec));
              closeEdit();
            }}
            onAskDelete={() => setConfirmingDelete(true)}
            onKeep={() => setConfirmingDelete(false)}
            onDelete={() => {
              setEntries(removeContraction(editing.id));
              closeEdit();
            }}
          />
        )}
      </BottomSheet>
    </Screen>
  );
}

/* ------------------------------ views ------------------------------ */

function IdleView({
  p,
  summary,
  onStart,
  onHistory,
}: {
  p: Pal;
  summary: HistorySummary | null;
  onStart: () => void;
  onHistory: () => void;
}) {
  return (
    <View>
      <Text style={[styles.kicker, { color: p.coralDeep }]}>{C.kicker}</Text>
      <Text style={[styles.title, { color: p.ink }]}>{C.title}</Text>
      <Text style={[styles.lede, { color: p.body }]}>{C.idleLede}</Text>

      <View style={styles.startWrap}>
        <Pressable
          testID="timer-start"
          onPress={onStart}
          accessibilityRole="button"
          accessibilityLabel="Start timing contraction"
          style={({ pressed }) => [
            styles.startBtn,
            { backgroundColor: pressed ? p.coralDeep : p.coral },
          ]}
        >
          <Text style={styles.startGlyph}>▶</Text>
          <Text style={styles.startTitle}>{C.startTitle}</Text>
          <Text style={styles.startSub}>{C.startSub}</Text>
        </Pressable>
      </View>

      {summary && (
        <Card
          testID="timer-history-card"
          onPress={onHistory}
          accessibilityLabel="Tonight's history. Button."
          style={{ backgroundColor: p.card, marginBottom: spacing.md }}
        >
          <View style={styles.rowBetween}>
            <View style={styles.grow}>
              <Text style={[styles.cardTitle, { color: p.ink }]}>
                {C.historyTitle}
              </Text>
              <Text style={[styles.cardBody, { color: p.body }]}>
                {summary.count} timed · last at {summary.lastLabel}
                {summary.avgIntervalSec !== null
                  ? ` — ${formatApproxInterval(summary.avgIntervalSec)} apart`
                  : ''}
              </Text>
            </View>
            <Text style={[styles.chev, { color: p.muted }]}>›</Text>
          </View>
        </Card>
      )}

      <View style={styles.awakeNote}>
        <Text style={[styles.awakeGlyph, { color: p.muted }]}>☾</Text>
        <Text style={[styles.awakeText, { color: p.muted }]}>
          {C.awakeNoteIdle}
        </Text>
      </View>
    </View>
  );
}

function TimingView({
  p,
  elapsedSec,
  sinceLastSec,
  lastLengthSec,
  onStop,
}: {
  p: Pal;
  elapsedSec: number;
  sinceLastSec: number | null;
  lastLengthSec: number | null;
  onStop: () => void;
}) {
  return (
    <View>
      <View style={styles.clockWrap}>
        <Text
          testID="timer-clock"
          style={[styles.clock, { color: p.ink }]}
          accessibilityLabel={`Timing: ${formatClock(elapsedSec)}`}
        >
          {formatClock(elapsedSec)}
        </Text>
        <Text style={[styles.clockLabel, { color: p.muted }]}>
          {C.timingLabel}
        </Text>
      </View>

      <Pressable
        testID="timer-stop"
        onPress={onStop}
        accessibilityRole="button"
        accessibilityLabel="Stop timing"
        style={({ pressed }) => [
          styles.stopBtn,
          { backgroundColor: pressed ? p.coralDeep : p.coral },
        ]}
      >
        <Text style={styles.stopGlyph}>■</Text>
        <Text style={styles.stopTitle}>{C.stopTitle}</Text>
      </Pressable>

      <View style={styles.statRow}>
        <View style={[styles.stat, { backgroundColor: p.card }]}>
          <Text style={[styles.statV, { color: p.ink }]}>
            {sinceLastSec !== null ? formatClock(sinceLastSec) : '—'}
          </Text>
          <Text style={[styles.statL, { color: p.muted }]}>{C.sinceLast}</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: p.card }]}>
          <Text style={[styles.statV, { color: p.ink }]}>
            {lastLengthSec !== null ? formatClock(lastLengthSec) : '—'}
          </Text>
          <Text style={[styles.statL, { color: p.muted }]}>{C.lastLength}</Text>
        </View>
      </View>

      <View style={styles.awakeNote}>
        <Text style={[styles.awakeGlyph, { color: p.muted }]}>☾</Text>
        <Text style={[styles.awakeText, { color: p.muted }]}>
          {C.awakeNoteTiming}
        </Text>
      </View>
      <Text style={[styles.centerNote, { color: p.body }]}>{C.timingHint}</Text>
    </View>
  );
}

function LoggedView({
  p,
  durationSec,
  intervalSec,
  onNext,
  onHistory,
}: {
  p: Pal;
  durationSec: number;
  intervalSec: number | null;
  onNext: () => void;
  onHistory: () => void;
}) {
  return (
    <View>
      <View style={styles.loggedCheckWrap}>
        <Text style={styles.loggedCheck}>✓</Text>
      </View>
      <Text style={[styles.loggedTitle, { color: p.ink }]}>{C.loggedTitle}</Text>
      <Text style={[styles.loggedLede, { color: p.body }]}>
        {formatClock(durationSec)} long
        {intervalSec !== null
          ? ` · ${formatClock(intervalSec)} after the last one`
          : ' · the first one tonight'}
        .{'\n'}
        {C.savedLine}
      </Text>

      <Pressable
        testID="timer-next"
        onPress={onNext}
        accessibilityRole="button"
        accessibilityLabel="Time the next contraction"
        style={({ pressed }) => [
          styles.nextBtn,
          { backgroundColor: pressed ? p.coralDeep : p.coral },
        ]}
      >
        <Text style={styles.nextGlyph}>▶</Text>
        <Text style={styles.nextTitle}>{C.nextButton}</Text>
      </Pressable>

      <Pressable
        testID="timer-view-history"
        onPress={onHistory}
        accessibilityRole="button"
        accessibilityLabel="View tonight's history"
        style={({ pressed }) => [
          styles.ghostBtn,
          { borderColor: p.line, backgroundColor: p.card },
          pressed && { backgroundColor: p.blush },
        ]}
      >
        <Text style={[styles.ghostText, { color: p.coralDeep }]}>
          {C.historyButton}
        </Text>
      </Pressable>
    </View>
  );
}

function HistoryView({
  p,
  recent,
  nowMs,
  show511,
  onEdit,
}: {
  p: Pal;
  recent: ContractionEntry[];
  nowMs: number;
  show511: boolean;
  onEdit: (id: string) => void;
}) {
  const summary = historySummary(recent, nowMs);
  return (
    <View testID="timer-history-list">
      <Text style={[styles.kicker, { color: p.coralDeep }]}>{C.historyKicker}</Text>
      <Text style={[styles.title, { color: p.ink }]}>{C.historyTitle}</Text>
      {summary && (
        <Text style={[styles.summary, { color: p.body }]}>
          <Text style={[styles.summaryBold, { color: p.ink }]}>
            {summary.lastLabel}
          </Text>
          {summary.avgIntervalSec !== null
            ? ` — contractions ${formatApproxInterval(summary.avgIntervalSec)} apart.`
            : ` — ${summary.count} timed so far.`}
        </Text>
      )}

      {/* The quiet 5-1-1 note: informational only, never an alarm. */}
      {show511 && (
        <View
          testID="timer-511-note"
          style={[styles.note511, { backgroundColor: p.blush }]}
        >
          <Text style={[styles.note511Text, { color: p.ink }]}>
            <Text style={[styles.note511Lead, { color: p.ink }]}>
              {C.fiveOneOneLead}{' '}
            </Text>
            {C.fiveOneOneBody}
          </Text>
        </View>
      )}

      {recent.map((e, i) => {
        const successor = i > 0 ? recent[i - 1] : null;
        // Frozen at log time (or statically derived for legacy rows);
        // the newest entry shows a static "—" — never a running clock.
        const apartSec = apartForRow(e, successor);
        return (
          <Pressable
            key={e.id}
            testID={`timer-row-${i}`}
            onPress={() => onEdit(e.id)}
            accessibilityRole="button"
            accessibilityLabel={`${formatTimeOfDay(e.startedAt)} contraction, ${formatClock(e.durationSec)} long. Tap to edit.`}
            style={({ pressed }) => [
              styles.hrow,
              { backgroundColor: pressed ? p.blush : p.card },
            ]}
          >
            <View style={styles.grow}>
              <Text style={[styles.ht, { color: p.ink }]}>
                {formatTimeOfDay(e.startedAt)}
              </Text>
              <Text style={[styles.hs, { color: p.muted }]}>
                {formatClock(e.durationSec)} long ·{' '}
                {apartSec !== null ? `${formatClock(apartSec)} apart` : '— apart'}
              </Text>
            </View>
            <Text style={[styles.chev, { color: p.muted }]}>›</Text>
          </Pressable>
        );
      })}

      <Text style={[styles.centerNote, { color: p.body }]}>{C.historyHint}</Text>
    </View>
  );
}

function EditSheet({
  p,
  entry,
  durationSec,
  setDurationSec,
  confirmingDelete,
  onDone,
  onAskDelete,
  onKeep,
  onDelete,
}: {
  p: Pal;
  entry: ContractionEntry;
  durationSec: number;
  setDurationSec: (s: number) => void;
  confirmingDelete: boolean;
  onDone: () => void;
  onAskDelete: () => void;
  onKeep: () => void;
  onDelete: () => void;
}) {
  return (
    <View>
      <Text style={[styles.sheetTitle, { color: p.ink }]}>
        {confirmingDelete
          ? C.deleteTitle
          : `${formatTimeOfDay(entry.startedAt)} contraction`}
      </Text>
      <Text style={[styles.sheetSub, { color: p.muted }]}>
        {confirmingDelete
          ? `The ${formatTimeOfDay(entry.startedAt)} contraction will be removed from tonight's history.`
          : C.editSub}
      </Text>

      {!confirmingDelete ? (
        <View>
          <View style={[styles.stepper, { backgroundColor: p.bg }]}>
            <Text style={[styles.stepperLabel, { color: p.body }]}>
              {C.lengthLabel}
            </Text>
            <View style={styles.stepBtns}>
              <Pressable
                testID="timer-dur-minus"
                onPress={() => setDurationSec(clampDurationSec(durationSec - 5))}
                accessibilityRole="button"
                accessibilityLabel="Shorter"
                style={({ pressed }) => [
                  styles.stepBtn,
                  { borderColor: p.line, backgroundColor: p.card },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.stepGlyph, { color: p.coralDeep }]}>−</Text>
              </Pressable>
              <Text
                testID="timer-dur-value"
                style={[styles.stepVal, { color: p.ink }]}
              >
                {formatClock(durationSec)}
              </Text>
              <Pressable
                testID="timer-dur-plus"
                onPress={() => setDurationSec(clampDurationSec(durationSec + 5))}
                accessibilityRole="button"
                accessibilityLabel="Longer"
                style={({ pressed }) => [
                  styles.stepBtn,
                  { borderColor: p.line, backgroundColor: p.card },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.stepGlyph, { color: p.coralDeep }]}>+</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.stepper, { backgroundColor: p.bg }]}>
            <Text style={[styles.stepperLabel, { color: p.body }]}>
              {C.startedAtLabel}
            </Text>
            <Text style={[styles.stepVal, { color: p.ink }]}>
              {formatTimeOfDay(entry.startedAt)}
            </Text>
          </View>

          <Pressable
            testID="timer-edit-done"
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel="Done"
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: pressed ? p.coralDeep : p.coral },
            ]}
          >
            <Text style={styles.primaryText}>{C.done}</Text>
          </Pressable>

          <Pressable
            testID="timer-ask-delete"
            onPress={onAskDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete this entry"
            style={styles.dangerTextBtn}
          >
            <Text style={[styles.dangerText, { color: p.coralDeep }]}>
              {C.deleteEntry}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.confirmBox, { backgroundColor: p.blush }]}>
          <Text style={[styles.confirmText, { color: p.ink }]}>
            {C.deleteTitle}
          </Text>
          <View style={styles.confirmRow}>
            <Pressable
              testID="timer-keep"
              onPress={onKeep}
              accessibilityRole="button"
              accessibilityLabel="Keep it"
              style={({ pressed }) => [
                styles.keepBtn,
                { borderColor: p.line, backgroundColor: p.card },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.keepText, { color: p.ink }]}>{C.keepIt}</Text>
            </Pressable>
            <Pressable
              testID="timer-delete"
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete"
              style={({ pressed }) => [
                styles.delBtn,
                { backgroundColor: pressed ? p.coral : p.coralDeep },
              ]}
            >
              <Text style={styles.delText}>{C.delete}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

/* ------------------------------ styles ----------------------------- */

const styles = StyleSheet.create({
  topnav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouch,
    marginHorizontal: -spacing.xs,
  },
  navSpacer: { width: minTouch },
  iconBtn: {
    width: minTouch,
    height: minTouch,
    borderRadius: minTouch / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 22, fontWeight: '600', lineHeight: 24 },
  kicker: {
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginTop: spacing.sm,
    marginBottom: 6,
    marginHorizontal: 2,
  } as TextStyle,
  title: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: '600',
    lineHeight: 32,
    marginBottom: 6,
  } as TextStyle,
  lede: { fontSize: 15, lineHeight: 23, marginBottom: spacing.lg },
  disclaimer: {
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.xl,
    marginHorizontal: 2,
  } as TextStyle,
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1 },
  chev: { fontSize: 20, fontWeight: '600' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardBody: { fontSize: 14, lineHeight: 22 },
  /* idle */
  startWrap: { alignItems: 'center', paddingVertical: 26 },
  startBtn: {
    width: 212,
    height: 212,
    borderRadius: 106,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.28,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  startGlyph: { fontSize: 34, color: '#FFFFFF', lineHeight: 38 },
  startTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  startSub: { fontSize: 13, fontWeight: '600', color: '#FFFFFF', opacity: 0.92 },
  awakeNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: spacing.lg,
  },
  awakeGlyph: { fontSize: 15 },
  awakeText: { fontSize: 13, fontWeight: '600' },
  /* timing */
  clockWrap: { alignItems: 'center', paddingTop: 30, paddingBottom: 6 },
  clock: {
    fontSize: 76,
    fontWeight: '700',
    letterSpacing: -1.5,
    lineHeight: 80,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  clockLabel: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 10,
  } as TextStyle,
  stopBtn: {
    width: '100%',
    minHeight: 72,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 18,
    marginBottom: 6,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  stopGlyph: { fontSize: 22, color: '#FFFFFF' },
  stopTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  statRow: { flexDirection: 'row', gap: 10, marginTop: spacing.lg },
  stat: {
    flex: 1,
    borderRadius: 16,
    padding: spacing.md,
    alignItems: 'center',
    ...shadow.card,
  },
  statV: {
    fontSize: 19,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  statL: {
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 3,
  } as TextStyle,
  centerNote: { fontSize: 13.5, lineHeight: 21, textAlign: 'center' } as TextStyle,
  /* logged */
  loggedCheckWrap: { alignItems: 'center', paddingTop: 18 },
  loggedCheck: { fontSize: 34, color: '#6F8F6E', lineHeight: 40 },
  loggedTitle: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  } as TextStyle,
  loggedLede: { fontSize: 15, lineHeight: 23, textAlign: 'center' } as TextStyle,
  nextBtn: {
    width: '100%',
    minHeight: 64,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 18,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  nextGlyph: { fontSize: 24, color: '#FFFFFF' },
  nextTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  ghostBtn: {
    width: '100%',
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  ghostText: { fontSize: 16, fontWeight: '700' },
  /* history */
  summary: { fontSize: 14.5, lineHeight: 23, marginBottom: 14, marginHorizontal: 2 },
  summaryBold: { fontWeight: '700' },
  note511: { borderRadius: 16, padding: 14, marginBottom: 14 },
  note511Text: { fontSize: 14, lineHeight: 22 },
  note511Lead: { fontWeight: '700' },
  hrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 18,
    padding: 14,
    paddingLeft: spacing.lg,
    marginBottom: 10,
    minHeight: 64,
    ...shadow.card,
  },
  ht: {
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  hs: {
    fontSize: 13,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  /* edit sheet */
  sheetTitle: { fontFamily: 'Georgia', fontSize: 21, fontWeight: '600', marginBottom: 4 } as TextStyle,
  sheetSub: { fontSize: 13.5, lineHeight: 20, marginBottom: 14 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    padding: 8,
    paddingLeft: spacing.lg,
    marginBottom: 10,
  },
  stepperLabel: { fontSize: 14, fontWeight: '600' },
  stepBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: minTouch,
    height: minTouch,
    borderRadius: minTouch / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: { fontSize: 22, fontWeight: '700', lineHeight: 24 },
  stepVal: {
    fontSize: 17,
    fontWeight: '800',
    minWidth: 56,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  primaryBtn: {
    width: '100%',
    minHeight: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  primaryText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  dangerTextBtn: {
    width: '100%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  dangerText: { fontSize: 15.5, fontWeight: '700' },
  confirmBox: { borderRadius: 16, padding: spacing.lg, marginTop: spacing.md },
  confirmText: { fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: spacing.md },
  confirmRow: { flexDirection: 'row', gap: 10 },
  keepBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepText: { fontSize: 15.5, fontWeight: '700' },
  delBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  delText: { fontSize: 15.5, fontWeight: '800', color: '#FFFFFF' },
} as Record<string, ViewStyle | TextStyle>);

export const __laborTimerStyles = styles;
