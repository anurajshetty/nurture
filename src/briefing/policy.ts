/**
 * Daily-refresh policy for the morning briefing (v1.1: rules engine).
 *
 * `refreshBriefing(deps)` is the whole decision logic behind useBriefing,
 * kept dependency-injected so it unit-tests with a fake "today", an
 * in-memory KvStore, and stubbed engine/phraser — no network, no SQLite.
 * The React hook (./useBriefing.ts) is a thin wrapper that wires the real
 * deps and re-runs this on mount + screen focus.
 *
 * Refresh policy (device-local day):
 * 1. Build the anonymized context. Null (no due date) → 'empty'.
 * 2. Cache hit for today AND the current week → 'live' with the cached
 *    briefing — even offline, it's today's briefing.
 * 3. Otherwise, build the engine plan on-device (matrix + rules —
 *    deterministic, works with no network at all).
 * 4. If online → 'generating', then try the LLM phraser for the
 *    `phrase: true` slots:
 *    - success → merge phrasing into the plan, save, 'live'.
 *    - failure → render the curated plan verbatim, save, 'live'.
 *    The phraser is polish, never a dependency: Home never blanks.
 * 5. If offline → save the curated plan, 'offline' with the fresh plan
 *    (and the offline banner). Home never blanks on network failure.
 * 6. A week change (cached week !== current week) counts as stale and
 *    regenerates, with the same failure fallback as (4).
 *
 * Never throws: every failure path lands on 'live' (curated), 'offline'
 * (curated), or 'empty' (no due date only).
 */

import type { Briefing, BriefingStatus, PlanSlot, RichBody } from './types';
import type { BriefingContext, NoteLogEntry } from './context';
import { getBabyName as readBabyName, withBabyName } from './context';
import { buildPlan, type EnginePlan } from './engine';
import { getMatrixRow, MATRIX_REVIEW_DATE } from './matrix';
import {
  mergePhrasedSlots,
  phrasePlan,
  type PhraseRequestBody,
  type PhrasedSlots,
} from './client';
import {
  getCachedBriefing,
  saveBriefing,
  isFreshFor,
  type KvStore,
} from './cache';
import type { V12Appointment, V12Milestone } from './v12cards';
import { markCelebrated } from './v12cards';

/** Everything refreshBriefing needs; the hook supplies the real ones, tests supply fakes. */
export interface RefreshDeps {
  /** Today as YYYY-MM-DD in the device's local calendar. */
  today: string;
  store: KvStore;
  /**
   * False skips the fetch attempt and goes straight to offline/empty.
   * The hook sets this from navigator.onLine on web; native always
   * attempts (the client enforces the 15s timeout).
   */
  online: boolean;
  /** Track 3's buildBriefingContext (sync or async); null = no due date. */
  buildContext: () => BriefingContext | null | Promise<BriefingContext | null>;
  /**
   * Recent journal entries for the quiet-day look-back. Defaults to the
   * on-device note reader; tests stub this.
   */
  getRecentLogs?: () => NoteLogEntry[];
  /**
   * Defaults to the real phraser client; tests stub this. Rejects on any
   * failure — the policy falls back to the curated plan.
   */
  phrase?: (req: PhraseRequestBody) => Promise<{ phrased: PhrasedSlots; reviewDate: string }>;
  /**
   * v1.2 (Track 2): raw event-aware signals, read from the store by the
   * hook. All optional — the engine treats a missing signal as "no card".
   * The engine applies the ≤3-day / ≤7-day windows, the one-time kv gate,
   * and the C3 stop-state suppression itself.
   */
  getUpcomingAppointment?: () => V12Appointment | null;
  getRecentMilestone?: () => V12Milestone | null;
  /** Contract C3: false suppresses both v1.2 cards (planner pattern). */
  isPregnancyActive?: () => boolean;
  /**
   * Reads the optional baby name (Anuraj, Sept 2026). Defaults to the
   * on-device kv reader; tests stub this. The name gates the 'name'
   * delight kind in the engine and is substituted into {Name}/{name}
   * tokens on-device in toBriefing — it never reaches the network/phraser
   * (the substituted briefing text is still cached locally like any
   * other briefing).
   */
  getBabyName?: () => string | null;
  onUpdate: (status: BriefingStatus, briefing: Briefing | null) => void;
}

/** RichBody → plain lines for the phraser request. */
function bodyToLines(body: RichBody): string[] {
  return body.map((para) => para.map((run) => run.text).join(''));
}

/** Build the phraser request from the context + engine plan. */
export function buildPhraseRequest(
  ctx: BriefingContext,
  plan: EnginePlan,
): PhraseRequestBody {
  const row = getMatrixRow(ctx.week);
  return {
    week: ctx.week,
    day: ctx.day,
    firstTimeMom: ctx.firstTimeMom,
    ...(ctx.ageBand ? { ageBand: ctx.ageBand } : {}),
    symptomThemes: ctx.symptomThemes,
    planHash: plan.planHash,
    freshAngles: row.delight.freshAngles,
    slots: plan.slots
      .filter((s) => s.phrase)
      .map((s) => ({ slotId: s.slotId, preview: s.preview, body: bodyToLines(s.body) })),
  };
}

/**
 * v1.2: burn the one-time mark for every celebrated card in a briefing that
 * is actually being delivered to the screen. The engine only reads the gate
 * (buildPlan stays pure); marking here means a plan that is built but
 * discarded — stale refresh, double effect, phrase fallback — can never burn
 * the mark without showing the card. Best-effort; never throws.
 */
function markDeliveredCelebrations(
  store: KvStore,
  briefing: Briefing,
  today: string,
): void {
  try {
    for (const s of briefing.slots) {
      if (s.celebratedEventId) markCelebrated(store, s.celebratedEventId, today);
    }
  } catch {
    // A lost mark just means the next refresh re-checks; harmless.
  }
}

/** Assemble the final Briefing from the plan (+ optional phrasing). */
function toBriefing(
  ctx: BriefingContext,
  today: string,
  plan: EnginePlan,
  phrased: PhrasedSlots | null,
  babyName: string | null,
): Briefing {
  const merged: PlanSlot[] = phrased ? mergePhrasedSlots(plan.slots, phrased) : plan.slots;
  // On-device name substitution (Anuraj, Sept 2026): curated copy carries
  // {Name}/{name} tokens so the real name never reaches the phraser or the
  // network — the rendered briefing (with the name substituted) is cached
  // locally like any other briefing text. This is the single place the name
  // enters rendered text — both the phrased and the offline paths flow
  // through here. Slots without tokens are untouched.
  const slots: PlanSlot[] = merged.map((s) => ({
    ...s,
    title: withBabyName(s.title, babyName),
    preview: withBabyName(s.preview, babyName),
    body: s.body.map((para) => para.map((run) => ({ ...run, text: withBabyName(run.text, babyName) }))),
  }));
  return {
    week: ctx.week,
    day: ctx.day,
    generatedForDate: today,
    slots,
    reviewDate: MATRIX_REVIEW_DATE,
    planHash: plan.planHash,
  };
}

/**
 * Runs one refresh pass. Emits 'generating' before the build/phrase attempt
 * so the UI can show skeletons; emits exactly one terminal status
 * afterwards. Never throws.
 */
export async function refreshBriefing(deps: RefreshDeps): Promise<void> {
  const { today, store, online, buildContext, onUpdate } = deps;
  const phrase = deps.phrase ?? phrasePlan;
  try {
    let ctx: BriefingContext | null = null;
    try {
      ctx = await buildContext();
    } catch {
      ctx = null;
    }
    if (!ctx || typeof ctx.week !== 'number' || typeof ctx.day !== 'number') {
      // No due date (onboarding skipped) or unusable context — nothing to generate.
      onUpdate('empty', null);
      return;
    }

    const record = getCachedBriefing(store);
    // Keep the un-narrowed reference: isFreshFor is a type guard, so after
    // the check below `record` narrows and can no longer serve as "any cache".
    const stale = record;

    // Today's briefing for the current week: show it, even offline.
    if (isFreshFor(record, today, ctx.week)) {
      onUpdate('live', record.briefing);
      return;
    }

    // Stale or missing cache. The engine plan is built on-device and is
    // always renderable — even offline, Home never blanks.
    let plan: EnginePlan;
    // Baby name for the briefing (Anuraj, Sept 2026): read once per pass,
    // best-effort. Declared here so both toBriefing call sites below can
    // use it; assigned alongside the other isolated signal reads.
    let babyName: string | null = null;
    try {
      let logs: NoteLogEntry[] = [];
      try {
        logs = deps.getRecentLogs ? deps.getRecentLogs() : [];
      } catch {
        logs = [];
      }
      // v1.2 signals: read from the store; the engine gates them (windows,
      // one-time kv, C3). Each read is isolated — a failing signal never
      // breaks the briefing.
      let upcomingAppointment: V12Appointment | null = null;
      let recentMilestone: V12Milestone | null = null;
      let pregnancyActive = true;
      try {
        if (deps.getUpcomingAppointment) {
          upcomingAppointment = deps.getUpcomingAppointment() ?? null;
        }
      } catch {
        upcomingAppointment = null;
      }
      try {
        if (deps.getRecentMilestone) {
          recentMilestone = deps.getRecentMilestone() ?? null;
        }
      } catch {
        recentMilestone = null;
      }
      try {
        // Fail closed for C3: an unreadable stop signal suppresses the cards.
        if (deps.isPregnancyActive) pregnancyActive = deps.isPregnancyActive();
      } catch {
        pregnancyActive = false;
      }
      // Baby name (Anuraj, Sept 2026): optional, local-only. The engine
      // uses it only as a gate for the name-celebration delight card; the
      // real name is substituted into tokens on-device in toBriefing.
      try {
        babyName = deps.getBabyName ? deps.getBabyName() : readBabyName();
      } catch {
        babyName = null;
      }
      plan = buildPlan({
        week: ctx.week,
        day: ctx.day,
        date: today,
        firstTimeMom: ctx.firstTimeMom,
        ageBand: ctx.ageBand,
        symptomThemes: ctx.symptomThemes,
        logs,
        store,
        upcomingAppointment,
        recentMilestone,
        pregnancyActive,
        babyName,
      });
    } catch {
      // Engine failure is not expected (buildPlan never throws by design);
      // fall through to the stale-cache path if it ever happens.
      onUpdate(stale ? 'offline' : 'empty', stale ? stale.briefing : null);
      return;
    }

    // Offline: render the curated plan directly. The phraser is polish,
    // not a dependency.
    if (!online) {
      const briefing = toBriefing(ctx, today, plan, null, babyName);
      try {
        // Best-effort: a failed write must not hide a good briefing.
        saveBriefing(briefing, store, today);
      } catch {
        // Cache write failed — the briefing is still shown.
      }
      markDeliveredCelebrations(store, briefing, today);
      onUpdate('offline', briefing);
      return;
    }

    onUpdate('generating', null);

    // Polish layer: phrase the curated slots. Any failure → curated copy.
    let phrased: PhrasedSlots | null = null;
    try {
      const req = buildPhraseRequest(ctx, plan);
      if (req.slots.length > 0) {
        const res = await phrase(req);
        phrased = res.phrased;
      }
    } catch {
      phrased = null;
    }

    const briefing = toBriefing(ctx, today, plan, phrased, babyName);
    try {
      // Best-effort: a failed write must not hide a good briefing.
      saveBriefing(briefing, store, today);
    } catch {
      // Cache write failed — the briefing is still shown live.
    }
    markDeliveredCelebrations(store, briefing, today);
    onUpdate('live', briefing);
  } catch {
    // Absolute last resort — the hook contract says never throw.
    onUpdate('empty', null);
  }
}
