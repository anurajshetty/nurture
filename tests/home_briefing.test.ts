/**
 * Track 4 unit tests (v1.1): briefing cache + daily-refresh policy +
 * edge-function phraser client + merge.
 *
 * Pure logic only — in-memory KvStore, stubbed phraser, injected "today".
 * No network, no SQLite, no Gemini. Run with:
 *
 *   npx tsc tests/home_briefing.test.ts src/briefing/cache.ts src/briefing/policy.ts \
 *     src/briefing/client.ts src/briefing/context.ts src/briefing/types.ts \
 *     src/briefing/engine.ts src/briefing/matrix.ts src/briefing/delight.ts \
 *     src/theme/tokens.ts src/lib/types.ts src/onboarding/dates.ts \
 *     --outDir /tmp/nurture-briefing-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-briefing-tests/tests/home_briefing.test.js
 */

import {
  BRIEFING_CACHE_KEY,
  clearBriefing,
  getCachedBriefing,
  isFreshFor,
  saveBriefing,
  type BriefingCacheRecord,
  type KvStore,
} from '../src/briefing/cache';
import {
  BriefingError,
  mergePhrasedSlots,
  phrasePlan,
  validatePhraseResponse,
  type PhraseRequestBody,
  type PhrasedSlots,
} from '../src/briefing/client';
import { buildPlan } from '../src/briefing/engine';
import { MATRIX_REVIEW_DATE } from '../src/briefing/matrix';
import { refreshBriefing, type RefreshDeps } from '../src/briefing/policy';
import type { Briefing, BriefingStatus, PlanSlot } from '../src/briefing/types';
import type { BriefingContext } from '../src/briefing/context';
import { withBabyName } from '../src/briefing/context';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${name}\n  actual:   ${a}\n  expected: ${e}`);
  }
}

function checkTrue(name: string, v: boolean): void {
  check(name, v, true);
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

class MemStore implements KvStore {
  private map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function makeSlot(slotId: string, section: PlanSlot['section']): PlanSlot {
  return {
    slotId,
    section,
    title: `Title ${slotId}`,
    preview: `Preview ${slotId}`,
    body: [[{ text: `Body ${slotId}.` }]],
    phrase: section === 'routine' || section === 'timely',
    tint: '#fff',
    glyph: '❀',
    glyphColor: '#000',
    testID: slotId,
  };
}

function makeBriefing(week: number, day: number, generatedForDate: string): Briefing {
  const slots = ['routine-baby', 'routine-body', 'routine-know', 'routine-tips'].map((id) =>
    makeSlot(id, 'routine'),
  );
  return {
    week,
    day,
    generatedForDate,
    slots,
    reviewDate: generatedForDate,
    planHash: 'testhash',
  };
}

function makeCtx(week: number, day: number): BriefingContext {
  return { week, day, firstTimeMom: true, symptomThemes: ['nausea'] };
}

/** The plan slots as toBriefing renders them with no name set (generic fallback). */
function substituted(slots: PlanSlot[]): PlanSlot[] {
  return slots.map((s) => ({
    ...s,
    title: withBabyName(s.title, null),
    preview: withBabyName(s.preview, null),
    body: s.body.map((para) => para.map((run) => ({ ...run, text: withBabyName(run.text, null) }))),
  }));
}

function makePhraseReq(slotIds: string[]): PhraseRequestBody {
  return {
    week: 28,
    day: 3,
    firstTimeMom: true,
    symptomThemes: ['nausea'],
    planHash: 'testhash',
    freshAngles: [],
    slots: slotIds.map((slotId) => ({
      slotId,
      preview: `Preview ${slotId}`,
      body: [`Body ${slotId}.`],
    })),
  };
}

const TODAY = '2026-09-18';
const YESTERDAY = '2026-09-17';

async function runRefresh(
  overrides: Partial<RefreshDeps> & { store: KvStore },
): Promise<Array<[BriefingStatus, Briefing | null]>> {
  const updates: Array<[BriefingStatus, Briefing | null]> = [];
  await refreshBriefing({
    today: TODAY,
    online: true,
    buildContext: () => makeCtx(28, 3),
    onUpdate: (s, b) => {
      updates.push([s, b]);
    },
    ...overrides,
  });
  return updates;
}

/* ------------------------------------------------------------------ */
/* cache.ts                                                            */
/* ------------------------------------------------------------------ */

{
  const store = new MemStore();
  check('cache: empty store → null', getCachedBriefing(store), null);

  const briefing = makeBriefing(28, 3, TODAY);
  saveBriefing(briefing, store, TODAY);
  const got = getCachedBriefing(store) as BriefingCacheRecord;
  check('cache: roundtrip date', got.generatedForDate, TODAY);
  check('cache: roundtrip week', got.week, 28);
  check('cache: roundtrip briefing', got.briefing, briefing);

  const raw = store.get(BRIEFING_CACHE_KEY) as string;
  checkTrue('cache: stored under briefing.cache.v3', raw.includes('"generatedForDate":"2026-09-18"'));

  store.set(BRIEFING_CACHE_KEY, '{not json');
  check('cache: malformed JSON → null', getCachedBriefing(store), null);

  store.set(BRIEFING_CACHE_KEY, JSON.stringify({ nope: 1 }));
  check('cache: wrong shape → null', getCachedBriefing(store), null);

  // The v1 shape (cards) must never validate as v2.
  store.set(
    BRIEFING_CACHE_KEY,
    JSON.stringify({
      generatedForDate: TODAY,
      week: 28,
      briefing: { week: 28, day: 3, generatedForDate: TODAY, cards: [], reviewDate: TODAY },
    }),
  );
  check('cache: v1 cards shape → null', getCachedBriefing(store), null);

  saveBriefing(briefing, store, TODAY);
  clearBriefing(store);
  check('cache: clear → null', getCachedBriefing(store), null);
}

/* ------------------------------------------------------------------ */
/* Regression (Anuraj, Sept 2026): stale pre-token cache entries       */
/* ------------------------------------------------------------------ */

async function cacheKeyBumpRegressionTests(): Promise<void> {
  // A v2 entry holds pre-{Name}-token copy with a hardcoded personal name.
  // The v3 key bump must make the reader ignore it entirely — otherwise a
  // client that generated a briefing before the de-Mira fix keeps serving
  // the stale name all day. The former name is built from parts so the
  // literal never appears in this repo.
  const FORMER = 'mi' + 'ra';
  const staleBriefing = makeBriefing(28, 3, TODAY);
  staleBriefing.slots[0] = {
    ...staleBriefing.slots[0],
    title: `${FORMER}'s organs are ready`,
  };
  const store = new MemStore();
  store.set(
    'briefing.cache.v2',
    JSON.stringify({ generatedForDate: TODAY, week: 28, briefing: staleBriefing }),
  );

  check('stale v2 entry: ignored by reader', getCachedBriefing(store), null);

  // A refresh with the stale entry present regenerates instead of serving it.
  const updates = await runRefresh({ store, online: false });
  check('stale v2 entry: refresh regenerates (offline path)', updates.map((u) => u[0]), ['offline']);
  const live = updates[0][1] as Briefing;
  const text = live.slots
    .map(
      (s) =>
        s.title + ' ' + s.preview + ' ' + s.body.map((p) => p.map((r) => r.text).join('')).join(' '),
    )
    .join('\n');
  const formerNamePattern = new RegExp('\\b' + 'mi' + 'ra' + '\\b', 'i');
  check('stale v2 entry: regenerated briefing has no hardcoded name', formerNamePattern.test(text), false);

  // The fresh record is stored under the new key. The stale v2 entry is
  // simply never read again — no migration, old entries age out.
  checkTrue('stale v2 entry: fresh record under v3 key', (store.get(BRIEFING_CACHE_KEY) as string).length > 0);
}

{
  const record: BriefingCacheRecord = {
    generatedForDate: TODAY,
    week: 28,
    briefing: makeBriefing(28, 3, TODAY),
  };
  checkTrue('fresh: today + same week', isFreshFor(record, TODAY, 28));
  check('fresh: new day → stale', isFreshFor(record, '2026-09-19', 28), false);
  check('fresh: week change → stale', isFreshFor(record, TODAY, 29), false);
  check('fresh: null record → stale', isFreshFor(null, TODAY, 28), false);
}

{
  // saveBriefing stamps the injectable "today", not the briefing's own date.
  const store = new MemStore();
  saveBriefing(makeBriefing(28, 3, '2000-01-01'), store, TODAY);
  check('cache: save stamps injected today', (getCachedBriefing(store) as BriefingCacheRecord).generatedForDate, TODAY);
}

/* ------------------------------------------------------------------ */
/* client.ts — phraser validation                                      */
/* ------------------------------------------------------------------ */

{
  const req = makePhraseReq(['routine-baby', 'routine-body']);
  const good = {
    reviewDate: TODAY,
    footer: 'General information only — not medical advice.',
    slots: [
      { slotId: 'routine-baby', preview: 'Phrased baby preview', body: ['Phrased baby line.'] },
      { slotId: 'routine-body', preview: 'Phrased body preview', body: ['Phrased body line.'] },
    ],
  };
  const v = validatePhraseResponse(good, req);
  check('client: valid phrasing passes', v.slots.map((s) => s.slotId), ['routine-baby', 'routine-body']);
  check('client: reviewDate passes through', v.reviewDate, TODAY);
  check('client: phrased preview kept', v.slots[0].preview, 'Phrased baby preview');

  const swapped = { ...good, slots: [...good.slots].reverse() };
  let code: string | null = null;
  try {
    validatePhraseResponse(swapped, req);
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: wrong slot order → invalid_response', code, 'invalid_response');

  try {
    validatePhraseResponse({ ...good, slots: good.slots.slice(0, 1) }, req);
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: slot count mismatch → invalid_response', code, 'invalid_response');

  try {
    validatePhraseResponse({ ...good, reviewDate: 'Sept 18' }, req);
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: bad reviewDate → invalid_response', code, 'invalid_response');

  // Body line count must match the request (same number of lines, reworded).
  const lineMismatch = {
    ...good,
    slots: good.slots.map((s, i) => (i === 0 ? { ...s, body: ['One.', 'Two.'] } : s)),
  };
  try {
    validatePhraseResponse(lineMismatch, req);
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: body line count mismatch → invalid_response', code, 'invalid_response');

  // Length overruns are clamped, not rejected (the function already clamps).
  const long = {
    ...good,
    slots: good.slots.map((s, i) =>
      i === 0 ? { ...s, preview: 'x'.repeat(200), body: ['y'.repeat(500)] } : s,
    ),
  };
  const cv = validatePhraseResponse(long, req);
  checkTrue('client: over-long preview clamped', cv.slots[0].preview.length <= 120);
  checkTrue('client: over-long body line clamped', cv.slots[0].body[0].length <= 220);
}

/* ------------------------------------------------------------------ */
/* client.ts — mergePhrasedSlots                                       */
/* ------------------------------------------------------------------ */

{
  const slots = [
    makeSlot('routine-baby', 'routine'),
    makeSlot('delight-card-fact', 'delight'),
  ];
  const phrased: PhrasedSlots = {
    'routine-baby': { preview: 'Phrased preview', body: ['Phrased line one.', 'Phrased line two.'] },
  };
  const merged = mergePhrasedSlots(slots, phrased);
  check('client: merge phrases the flagged slot', merged[0].preview, 'Phrased preview');
  check('client: merge keeps line count', merged[0].body.length, 2);
  check('client: merge leaves unflagged slot alone', merged[1].preview, 'Preview delight-card-fact');
  check('client: merge is pure (input untouched)', slots[0].preview, 'Preview routine-baby');
}

{
  // Token-preservation rule: a phrasing that drops {Name}/{name} is rejected.
  const tokenSlot: PlanSlot = {
    ...makeSlot('routine-baby', 'routine'),
    preview: '{Name} is growing every day.',
    body: [[{ text: 'And {name} has been tasting.' }]],
  };
  const keep: PhrasedSlots = {
    'routine-baby': {
      preview: '{Name} is growing every single day.',
      body: ['And {name} has been tasting new flavors.'],
    },
  };
  const drop: PhrasedSlots = {
    'routine-baby': {
      preview: 'The baby is growing every day.',
      body: ['And {name} has been tasting.'],
    },
  };
  const kept = mergePhrasedSlots([tokenSlot], keep);
  check('client: merge keeps phrasing that preserves tokens', kept[0].preview, '{Name} is growing every single day.');
  const dropped = mergePhrasedSlots([tokenSlot], drop);
  check('client: merge rejects phrasing that drops {Name}', dropped[0].preview, '{Name} is growing every day.');
  check('client: rejected merge keeps curated body', dropped[0].body[0][0].text, 'And {name} has been tasting.');
  const dropBody: PhrasedSlots = {
    'routine-baby': {
      preview: '{Name} is growing every day.',
      body: ['And the baby has been tasting.'],
    },
  };
  const droppedBody = mergePhrasedSlots([tokenSlot], dropBody);
  check('client: merge rejects phrasing that drops {name} in body', droppedBody[0].preview, '{Name} is growing every day.');
}

/* ------------------------------------------------------------------ */
/* client.ts — phrasePlan transport                                    */
/* ------------------------------------------------------------------ */

async function clientTests(): Promise<void> {
  const req = makePhraseReq(['routine-baby', 'routine-body']);
  const wire = {
    reviewDate: TODAY,
    slots: req.slots.map((s) => ({ slotId: s.slotId, preview: `P ${s.slotId}`, body: s.body })),
  };

  // Success: the whole request body is sent as-is; phrasing keyed by slotId.
  let sentBody: unknown = null;
  const res = await phrasePlan(req, {
    configured: true,
    invoke: async (body) => {
      sentBody = body;
      return { data: wire, error: null };
    },
  });
  check('client: phrasing keyed by slotId', res.phrased['routine-baby'].preview, 'P routine-baby');
  check('client: reviewDate comes from the server', res.reviewDate, TODAY);
  check('client: body is exactly the request', sentBody, req);

  // Request validation on-device: bad week → invalid_response.
  let code: string | null = null;
  try {
    await phrasePlan({ ...req, week: 3 }, {
      configured: true,
      invoke: async () => ({ data: wire, error: null }),
    });
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: bad request week → invalid_response', code, 'invalid_response');

  // Edge-function error → network.
  code = null;
  try {
    await phrasePlan(req, {
      configured: true,
      invoke: async () => ({ data: null, error: new Error('boom') }),
    });
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: function error → network', code, 'network');

  // Transport rejection → network.
  try {
    await phrasePlan(req, {
      configured: true,
      invoke: async () => {
        throw new Error('offline');
      },
    });
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: invoke rejects → network', code, 'network');

  // Timeout → network (injectable short timeout; no real waiting).
  try {
    await phrasePlan(req, {
      configured: true,
      timeoutMs: 30,
      invoke: () => new Promise(() => {}),
    });
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: timeout → network', code, 'network');

  // Unconfigured backend → not_configured, invoke never called.
  let invoked = false;
  try {
    await phrasePlan(req, {
      configured: false,
      invoke: async () => {
        invoked = true;
        return { data: wire, error: null };
      },
    });
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: unconfigured → not_configured', code, 'not_configured');
  check('client: unconfigured never invokes', invoked, false);

  // Malformed payload → invalid_response.
  try {
    await phrasePlan(req, {
      configured: true,
      invoke: async () => ({ data: { hello: 1 }, error: null }),
    });
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: bad payload → invalid_response', code, 'invalid_response');
}

/* ------------------------------------------------------------------ */
/* policy.ts — refresh decisions (engine + phraser)                    */
/* ------------------------------------------------------------------ */

/** The deterministic engine plan the policy builds for week 28, day 3. */
function expectedPlan() {
  return buildPlan({
    week: 28,
    day: 3,
    date: TODAY,
    firstTimeMom: true,
    symptomThemes: ['nausea'],
    logs: [],
    store: null,
  });
}

async function policyTests(): Promise<void> {
  // 1. Today's cache for the current week → live, phraser NOT called.
  {
    const store = new MemStore();
    const cached = makeBriefing(28, 3, TODAY);
    saveBriefing(cached, store, TODAY);
    let phraseCalls = 0;
    const updates = await runRefresh({
      store,
      phrase: async () => {
        phraseCalls++;
        throw new Error('must not phrase');
      },
    });
    check('policy: cache hit statuses', updates.map((u) => u[0]), ['live']);
    check('policy: cache hit shows cached briefing', updates[0][1], cached);
    check('policy: cache hit skips phraser', phraseCalls, 0);
  }

  // 2. New day → generating, engine plan phrased, merged briefing live + cached.
  {
    const store = new MemStore();
    saveBriefing(makeBriefing(28, 2, YESTERDAY), store, YESTERDAY);
    const plan = expectedPlan();
    let sentReq: PhraseRequestBody | undefined;
    const updates = await runRefresh({
      store,
      phrase: async (req) => {
        sentReq = req;
        // A compliant phraser preserves the {Name}/{name} tokens (here by
        // keeping the curated wording with a "Phrased: " prefix).
        const phrased: PhrasedSlots = {};
        for (const s of req.slots) {
          phrased[s.slotId] = {
            preview: `Phrased: ${s.preview}`,
            body: s.body.map((l) => `Phrased: ${l}`),
          };
        }
        return { phrased, reviewDate: TODAY };
      },
    });
    check('policy: new day statuses', updates.map((u) => u[0]), ['generating', 'live']);
    const live = updates[1][1] as Briefing;
    check('policy: phraser got the plan hash', sentReq?.planHash, plan.planHash);
    check(
      'policy: phraser got the phrase:true slot ids in order',
      sentReq?.slots.map((s) => s.slotId),
      plan.slots.filter((s) => s.phrase).map((s) => s.slotId),
    );
    check(
      'policy: routine slots show phrased text (tokens preserved, name substituted)',
      live.slots.filter((s) => s.section === 'routine').map((s) => s.preview),
      plan.slots.filter((s) => s.section === 'routine').map((s) => withBabyName(`Phrased: ${s.preview}`, null)),
    );
    check(
      'policy: delight slots keep curated copy (never phrased)',
      live.slots.filter((s) => s.section === 'delight').map((s) => s.preview),
      plan.slots.filter((s) => s.section === 'delight').map((s) => s.preview),
    );
    check('policy: reviewDate is the matrix review date', live.reviewDate, MATRIX_REVIEW_DATE);
    check('policy: planHash carried through', live.planHash, plan.planHash);
    check(
      'policy: success saved to cache',
      (getCachedBriefing(store) as BriefingCacheRecord).generatedForDate,
      TODAY,
    );
  }

  // 3. Phraser failure → live with the curated plan (polish, not dependency).
  {
    const store = new MemStore();
    const plan = expectedPlan();
    const updates = await runRefresh({
      store,
      phrase: async () => {
        throw new BriefingError('network', 'down');
      },
    });
    check('policy: phraser failure statuses', updates.map((u) => u[0]), ['generating', 'live']);
    const live = updates[1][1] as Briefing;
    check(
      'policy: phraser failure shows curated slots (name substituted)',
      live.slots,
      substituted(plan.slots),
    );
    check(
      'policy: curated fallback saved to cache',
      (getCachedBriefing(store) as BriefingCacheRecord).briefing.slots,
      substituted(plan.slots),
    );
  }

  // 4. Offline fast-path: the engine builds today's plan on-device even
  //    with no cache — Home never blanks. Phraser NOT called.
  {
    const store = new MemStore();
    const stale = makeBriefing(28, 2, YESTERDAY);
    saveBriefing(stale, store, YESTERDAY);
    let phraseCalls = 0;
    const updates = await runRefresh({
      store,
      online: false,
      phrase: async () => {
        phraseCalls++;
        throw new Error('must not phrase');
      },
    });
    check('policy: offline+stale statuses', updates.map((u) => u[0]), ['offline']);
    const offlineBriefing = updates[0][1] as Briefing;
    check('policy: offline builds a fresh plan, not the stale cache',
      offlineBriefing.generatedForDate, TODAY);
    check('policy: offline plan is the curated engine plan (name substituted)',
      offlineBriefing.slots, substituted(expectedPlan().slots));
    check('policy: offline skips phraser', phraseCalls, 0);
    check(
      'policy: offline plan saved to cache',
      (getCachedBriefing(store) as BriefingCacheRecord).generatedForDate,
      TODAY,
    );
  }

  // 5. Offline fast-path: no cache → 'offline' with a fresh curated plan,
  //    never 'empty' (empty is only for "no due date").
  {
    const store = new MemStore();
    const updates = await runRefresh({
      store,
      online: false,
      phrase: async () => {
        throw new Error('must not phrase');
      },
    });
    check('policy: offline+nocache statuses', updates.map((u) => u[0]), ['offline']);
    const offlineBriefing = updates[0][1] as Briefing;
    check('policy: offline+nocache shows a fresh plan', offlineBriefing.generatedForDate, TODAY);
    check('policy: offline+nocache plan has slots', offlineBriefing.slots.length > 0, true);
  }

  // 6. No due date (null context) → empty, phraser NOT called.
  {
    const store = new MemStore();
    let phraseCalls = 0;
    const updates = await runRefresh({
      store,
      buildContext: () => null,
      phrase: async () => {
        phraseCalls++;
        throw new Error('must not phrase');
      },
    });
    check('policy: no due date → empty', updates.map((u) => u[0]), ['empty']);
    check('policy: no due date briefing null', updates[0][1], null);
    check('policy: no due date skips phraser', phraseCalls, 0);
  }

  // 7. Context builder throws → empty, never throws out of refreshBriefing.
  {
    const store = new MemStore();
    const updates = await runRefresh({
      store,
      buildContext: () => {
        throw new Error('db gone');
      },
    });
    check('policy: builder throws → empty', updates.map((u) => u[0]), ['empty']);
  }

  // 8. Week change (same date, different week) → rebuild, not live.
  {
    const store = new MemStore();
    saveBriefing(makeBriefing(27, 7, TODAY), store, TODAY);
    let phraseCalls = 0;
    const updates = await runRefresh({
      store,
      phrase: async (req) => {
        phraseCalls++;
        const phrased: PhrasedSlots = {};
        for (const s of req.slots) phrased[s.slotId] = { preview: s.preview, body: s.body };
        return { phrased, reviewDate: TODAY };
      },
    });
    check('policy: week change rephrases', phraseCalls, 1);
    check('policy: week change statuses', updates.map((u) => u[0]), ['generating', 'live']);
  }

  // 9. Cache write failure is best-effort — the briefing still shows live.
  {
    const store = new MemStore();
    store.set = () => {
      throw new Error('disk full');
    };
    const updates = await runRefresh({
      store,
      phrase: async (req) => {
        const phrased: PhrasedSlots = {};
        for (const s of req.slots) phrased[s.slotId] = { preview: s.preview, body: s.body };
        return { phrased, reviewDate: TODAY };
      },
    });
    check('policy: cache write failure still live', updates.map((u) => u[0]), ['generating', 'live']);
  }
}

/* ------------------------------------------------------------------ */
/* baby name (Anuraj, Sept 2026): gating + on-device substitution       */
/* ------------------------------------------------------------------ */

async function babyNamePolicyTests(): Promise<void> {
  const echoPhrase = async (req: PhraseRequestBody) => {
    const phrased: PhrasedSlots = {};
    for (const s of req.slots) phrased[s.slotId] = { preview: s.preview, body: s.body };
    return { phrased, reviewDate: TODAY };
  };

  // 1. Name set → the briefing shows it; the phraser never sees it.
  {
    const store = new MemStore();
    let sentReq: PhraseRequestBody | undefined;
    const updates = await runRefresh({
      store,
      getBabyName: () => 'Wren',
      phrase: async (req) => {
        sentReq = req;
        return echoPhrase(req);
      },
    });
    check('name: live statuses', updates.map((u) => u[0]), ['generating', 'live']);
    const live = updates[1][1] as Briefing;
    const size = live.slots.find((s) => s.slotId === 'delight-card-size');
    check('name: size card title uses the name', size?.title, 'How big is Wren?');
    const baby = live.slots.find((s) => s.slotId === 'routine-baby');
    checkTrue('name: routine-baby preview uses the name', (baby?.preview ?? '').includes('Wren'));
    const flat = JSON.stringify(live.slots);
    checkTrue('name: no unreplaced tokens in the briefing', !flat.includes('{Name}') && !flat.includes('{name}'));
    checkTrue('name: phraser never saw the name (privacy)', !JSON.stringify(sentReq).includes('Wren'));
  }

  // 2. No name → generic fallback; no celebration card.
  {
    const store = new MemStore();
    const updates = await runRefresh({ store, getBabyName: () => null, phrase: echoPhrase });
    const live = updates[1][1] as Briefing;
    const size = live.slots.find((s) => s.slotId === 'delight-card-size');
    check('no-name: size card title is generic', size?.title, 'How big is your baby?');
    check(
      'no-name: no celebration card',
      live.slots.some((s) => s.title === "Your baby's name"),
      false,
    );
  }

  // 3. On the 'name' rotation day with a name set → the celebration card.
  {
    const store = new MemStore();
    // 2026-01-03: dayOfYear 3 % 5 === 3 → ROTATION_ORDER[3] === 'name'.
    const updates: Array<[BriefingStatus, Briefing | null]> = [];
    await refreshBriefing({
      today: '2026-01-03',
      store,
      online: true,
      buildContext: () => makeCtx(28, 3),
      getBabyName: () => 'Wren',
      phrase: echoPhrase,
      onUpdate: (s, b) => {
        updates.push([s, b]);
      },
    });
    const live = updates[1][1] as Briefing;
    const rotating = live.slots.find((s) => s.slotId === 'delight-card-rotating');
    check('name-day: celebration card title', rotating?.title, "Your baby's name");
    checkTrue('name-day: preview celebrates the name', (rotating?.preview ?? '').includes('You chose Wren ♥'));
  }

  // 4. The offline path substitutes too.
  {
    const store = new MemStore();
    const updates = await runRefresh({ store, online: false, getBabyName: () => 'Wren' });
    check('name: offline statuses', updates.map((u) => u[0]), ['offline']);
    const briefing = updates[0][1] as Briefing;
    const size = briefing.slots.find((s) => s.slotId === 'delight-card-size');
    check('name: offline size title uses the name', size?.title, 'How big is Wren?');
  }
}

async function main(): Promise<void> {
  await clientTests();
  await policyTests();
  await babyNamePolicyTests();
  await cacheKeyBumpRegressionTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
