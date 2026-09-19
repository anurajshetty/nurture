/**
 * Track 4 unit tests: briefing cache + daily-refresh policy + edge-function client.
 *
 * Pure logic only — in-memory KvStore, stubbed fetch, injected "today".
 * No network, no SQLite, no Gemini. Run with:
 *
 *   npx tsc tests/home_briefing.test.ts src/briefing/cache.ts src/briefing/policy.ts \
 *     src/briefing/client.ts src/briefing/context.ts src/briefing/types.ts \
 *     src/onboarding/dates.ts \
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
  EXPECTED_CARD_IDS,
  fetchBriefing,
  validateBriefingResponse,
} from '../src/briefing/client';
import { refreshBriefing, type RefreshDeps } from '../src/briefing/policy';
import type { Briefing, BriefingCard, BriefingStatus } from '../src/briefing/types';
import type { BriefingContext } from '../src/briefing/context';

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

function makeCard(id: BriefingCard['id']): BriefingCard {
  return { id, title: `Title ${id}`, subtitle: `Subtitle ${id}`, body: [`Line one for ${id}.`, `Line two for ${id}.`] };
}

function makeBriefing(week: number, day: number, generatedForDate: string): Briefing {
  return {
    week,
    day,
    generatedForDate,
    cards: (['baby', 'body', 'know', 'tips'] as const).map(makeCard),
    reviewDate: generatedForDate,
  };
}

function makeCtx(week: number, day: number): BriefingContext {
  return { week, day, firstTimeMom: true, symptomThemes: ['nausea'] };
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
  checkTrue('cache: stored under briefing.cache.v1', raw.includes('"generatedForDate":"2026-09-18"'));

  store.set(BRIEFING_CACHE_KEY, '{not json');
  check('cache: malformed JSON → null', getCachedBriefing(store), null);

  store.set(BRIEFING_CACHE_KEY, JSON.stringify({ nope: 1 }));
  check('cache: wrong shape → null', getCachedBriefing(store), null);

  saveBriefing(briefing, store, TODAY);
  clearBriefing(store);
  check('cache: clear → null', getCachedBriefing(store), null);
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
/* client.ts — validation                                              */
/* ------------------------------------------------------------------ */

{
  // The real edge-function contract: { cards, reviewDate } plus an ignored
  // footer string. week/day/generatedForDate are never sent back.
  const good = {
    reviewDate: TODAY,
    footer: 'General information only — not medical advice.',
    cards: EXPECTED_CARD_IDS.map((id) => ({
      id,
      title: `Title ${id}`,
      subtitle: `Subtitle ${id}`,
      body: ['One.', 'Two.'],
    })),
  };
  const v = validateBriefingResponse(good);
  check('client: valid server payload passes', v.cards.map((c) => c.id), ['baby', 'body', 'know', 'tips']);
  check('client: reviewDate passes through', v.reviewDate, TODAY);
  check('client: extra footer key ignored', 'footer' in (v as unknown as Record<string, unknown>), false);

  const swapped = { ...good, cards: [...good.cards].reverse() };
  let code: string | null = null;
  try {
    validateBriefingResponse(swapped);
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: wrong card order → invalid_response', code, 'invalid_response');

  try {
    validateBriefingResponse({ ...good, cards: good.cards.slice(0, 3) });
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: 3 cards → invalid_response', code, 'invalid_response');

  try {
    validateBriefingResponse({ ...good, reviewDate: 'Sept 18' });
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: bad reviewDate → invalid_response', code, 'invalid_response');

  const longTitle = { ...good };
  longTitle.cards = good.cards.map((c, i) =>
    i === 0 ? { ...c, title: 'x'.repeat(61) } : c,
  );
  try {
    validateBriefingResponse(longTitle);
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: over-long title → invalid_response', code, 'invalid_response');

  const longLine = { ...good };
  longLine.cards = good.cards.map((c, i) =>
    i === 1 ? { ...c, body: ['y'.repeat(221)] } : c,
  );
  try {
    validateBriefingResponse(longLine);
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: over-long body line → invalid_response', code, 'invalid_response');

  const emptyBody = { ...good };
  emptyBody.cards = good.cards.map((c, i) => (i === 2 ? { ...c, body: [] } : c));
  try {
    validateBriefingResponse(emptyBody);
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: empty body → invalid_response', code, 'invalid_response');
}

/* ------------------------------------------------------------------ */
/* client.ts — fetchBriefing transport                                 */
/* ------------------------------------------------------------------ */

async function clientTests(): Promise<void> {
  const ctx = makeCtx(28, 3);
  // The REAL edge-function contract: { cards, reviewDate, footer } —
  // no week/day/generatedForDate come back over the wire.
  const wire = {
    reviewDate: TODAY,
    footer: 'General information only — not medical advice.',
    cards: EXPECTED_CARD_IDS.map((id) => ({ id, title: 't', subtitle: 's', body: ['b'] })),
  };

  // Success: only the context fields are sent as the body.
  let sentBody: unknown = null;
  const ok = await fetchBriefing(ctx, {
    configured: true,
    today: TODAY,
    invoke: async (body) => {
      sentBody = body;
      return { data: wire, error: null };
    },
  });
  check('client: real response contract succeeds (no week/day/generatedForDate on the wire)', ok.week, 28);
  check('client: day comes from the request context', ok.day, 3);
  check('client: generatedForDate is the device-local today', ok.generatedForDate, TODAY);
  check('client: reviewDate comes from the server', ok.reviewDate, TODAY);
  check('client: body is exactly the context', sentBody, ctx);

  // Context week/day out of range → invalid_response (validated on-device).
  let code: string | null = null;
  try {
    await fetchBriefing(makeCtx(3, 3), {
      configured: true,
      today: TODAY,
      invoke: async () => ({ data: wire, error: null }),
    });
    code = 'no-throw';
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: bad context week → invalid_response', code, 'invalid_response');

  // Edge-function error → network.
  code = null;
  try {
    await fetchBriefing(ctx, {
      configured: true,
      invoke: async () => ({ data: null, error: new Error('boom') }),
    });
  } catch (e) {
    code = (e as BriefingError).code;
  }
  check('client: function error → network', code, 'network');

  // Transport rejection → network.
  try {
    await fetchBriefing(ctx, {
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
    await fetchBriefing(ctx, {
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
    await fetchBriefing(ctx, {
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
    await fetchBriefing(ctx, {
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
/* policy.ts — refresh decisions                                       */
/* ------------------------------------------------------------------ */

async function policyTests(): Promise<void> {
  // 1. Today's cache for the current week → live, fetch NOT called.
  {
    const store = new MemStore();
    const cached = makeBriefing(28, 3, TODAY);
    saveBriefing(cached, store, TODAY);
    let fetchCalls = 0;
    const updates = await runRefresh({
      store,
      fetch: async () => {
        fetchCalls++;
        throw new Error('must not fetch');
      },
    });
    check('policy: cache hit statuses', updates.map((u) => u[0]), ['live']);
    check('policy: cache hit shows cached briefing', updates[0][1], cached);
    check('policy: cache hit skips fetch', fetchCalls, 0);
  }

  // 2. New day → fetch attempted; success → generating then live + cache saved.
  {
    const store = new MemStore();
    saveBriefing(makeBriefing(28, 2, YESTERDAY), store, YESTERDAY);
    const fresh = makeBriefing(28, 3, TODAY);
    let fetchCalls = 0;
    const updates = await runRefresh({
      store,
      fetch: async () => {
        fetchCalls++;
        return fresh;
      },
    });
    check('policy: new day statuses', updates.map((u) => u[0]), ['generating', 'live']);
    check('policy: new day shows fresh briefing', updates[1][1], fresh);
    check('policy: new day fetch attempted', fetchCalls, 1);
    check(
      'policy: success saved to cache',
      (getCachedBriefing(store) as BriefingCacheRecord).generatedForDate,
      TODAY,
    );
  }

  // 3. Fetch failure + stale cache → offline with the stale briefing.
  {
    const store = new MemStore();
    const stale = makeBriefing(27, 6, YESTERDAY);
    saveBriefing(stale, store, YESTERDAY);
    const updates = await runRefresh({
      store,
      fetch: async () => {
        throw new BriefingError('network', 'down');
      },
    });
    check('policy: failure+stale statuses', updates.map((u) => u[0]), ['generating', 'offline']);
    check('policy: failure+stale shows stale briefing', updates[1][1], stale);
  }

  // 4. Fetch failure + no cache → empty.
  {
    const store = new MemStore();
    const updates = await runRefresh({
      store,
      fetch: async () => {
        throw new BriefingError('network', 'down');
      },
    });
    check('policy: failure+nocache statuses', updates.map((u) => u[0]), ['generating', 'empty']);
    check('policy: failure+nocache briefing null', updates[1][1], null);
  }

  // 5. Week change (same date, different week) → refetch, not live.
  {
    const store = new MemStore();
    saveBriefing(makeBriefing(27, 7, TODAY), store, TODAY);
    let fetchCalls = 0;
    const fresh = makeBriefing(28, 1, TODAY);
    const updates = await runRefresh({
      store,
      fetch: async () => {
        fetchCalls++;
        return fresh;
      },
    });
    check('policy: week change refetches', fetchCalls, 1);
    check('policy: week change statuses', updates.map((u) => u[0]), ['generating', 'live']);
  }

  // 6. Offline fast-path: stale cache → offline, fetch NOT called.
  {
    const store = new MemStore();
    const stale = makeBriefing(28, 2, YESTERDAY);
    saveBriefing(stale, store, YESTERDAY);
    let fetchCalls = 0;
    const updates = await runRefresh({
      store,
      online: false,
      fetch: async () => {
        fetchCalls++;
        throw new Error('must not fetch');
      },
    });
    check('policy: offline+stale statuses', updates.map((u) => u[0]), ['offline']);
    check('policy: offline+stale shows stale', updates[0][1], stale);
    check('policy: offline skips fetch', fetchCalls, 0);
  }

  // 7. Offline fast-path: no cache → empty.
  {
    const store = new MemStore();
    let fetchCalls = 0;
    const updates = await runRefresh({
      store,
      online: false,
      fetch: async () => {
        fetchCalls++;
        throw new Error('must not fetch');
      },
    });
    check('policy: offline+nocache statuses', updates.map((u) => u[0]), ['empty']);
    check('policy: offline+nocache briefing null', updates[0][1], null);
    check('policy: offline+nocache skips fetch', fetchCalls, 0);
  }

  // 8. No due date (null context) → empty, fetch NOT called.
  {
    const store = new MemStore();
    let fetchCalls = 0;
    const updates = await runRefresh({
      store,
      buildContext: () => null,
      fetch: async () => {
        fetchCalls++;
        throw new Error('must not fetch');
      },
    });
    check('policy: no due date → empty', updates.map((u) => u[0]), ['empty']);
    check('policy: no due date briefing null', updates[0][1], null);
    check('policy: no due date skips fetch', fetchCalls, 0);
  }

  // 9. Context builder throws → empty, never throws out of refreshBriefing.
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

  // 10. retry() recovery: first pass fails (offline), second succeeds (live).
  {
    const store = new MemStore();
    const pass1 = await runRefresh({
      store,
      fetch: async () => {
        throw new BriefingError('network', 'down');
      },
    });
    check('policy: retry pass1 → empty', pass1.map((u) => u[0]), ['generating', 'empty']);
    const fresh = makeBriefing(28, 3, TODAY);
    const pass2 = await runRefresh({
      store,
      fetch: async () => fresh,
    });
    check('policy: retry pass2 → live', pass2.map((u) => u[0]), ['generating', 'live']);
    check('policy: retry pass2 shows fresh', pass2[1][1], fresh);
  }

  // 11. Cache write failure is best-effort — the briefing still shows live.
  {
    const store = new MemStore();
    store.set = () => {
      throw new Error('disk full');
    };
    const fresh = makeBriefing(28, 3, TODAY);
    const updates = await runRefresh({
      store,
      fetch: async () => fresh,
    });
    check('policy: cache write failure still live', updates.map((u) => u[0]), ['generating', 'live']);
  }
}

async function main(): Promise<void> {
  await clientTests();
  await policyTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
