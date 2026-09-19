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

/** Assemble the final Briefing from the plan (+ optional phrasing). */
function toBriefing(
  ctx: BriefingContext,
  today: string,
  plan: EnginePlan,
  phrased: PhrasedSlots | null,
): Briefing {
  const slots: PlanSlot[] = phrased ? mergePhrasedSlots(plan.slots, phrased) : plan.slots;
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
    try {
      let logs: NoteLogEntry[] = [];
      try {
        logs = deps.getRecentLogs ? deps.getRecentLogs() : [];
      } catch {
        logs = [];
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
      const briefing = toBriefing(ctx, today, plan, null);
      try {
        // Best-effort: a failed write must not hide a good briefing.
        saveBriefing(briefing, store, today);
      } catch {
        // Cache write failed — the briefing is still shown.
      }
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

    const briefing = toBriefing(ctx, today, plan, phrased);
    try {
      // Best-effort: a failed write must not hide a good briefing.
      saveBriefing(briefing, store, today);
    } catch {
      // Cache write failed — the briefing is still shown live.
    }
    onUpdate('live', briefing);
  } catch {
    // Absolute last resort — the hook contract says never throw.
    onUpdate('empty', null);
  }
}
