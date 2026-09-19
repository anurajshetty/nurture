/**
 * Track 3 tests (v1.1): week-briefing edge function logic
 * (supabase/functions/week-briefing/lib.ts) — the LLM-as-phraser.
 *
 * The Gemini API is NEVER called here: `callGemini` takes an injected
 * fetch, and every test below passes a stub. Run with:
 *
 *   npx tsc tests/week_briefing.test.ts supabase/functions/week-briefing/lib.ts \
 *     --outDir /tmp/nurture-tests-wb --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-wb/tests/week_briefing.test.js
 */

import {
  BRIEFING_FOOTER,
  buildSystemInstruction,
  buildUserPrompt,
  callGemini,
  MODEL,
  ProviderError,
  validatePhrasing,
  validateRequest,
  type PhraseRequest,
} from '../supabase/functions/week-briefing/lib';

declare const process: { exit(code: number): void };

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(sortKeys(actual));
  const e = JSON.stringify(sortKeys(expected));
  if (a === e) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

/** Recursively sorts object keys so comparisons ignore insertion order. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** True when `key` appears anywhere in a nested object/array. */
function containsKey(v: unknown, key: string): boolean {
  if (Array.isArray(v)) return v.some((x) => containsKey(x, key));
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return Object.keys(o).some((k) => k === key || containsKey(o[k], key));
  }
  return false;
}

/* ---------------- request validation (phraser contract) ---------------- */

const MINIMAL: PhraseRequest = {
  week: 28,
  day: 3,
  firstTimeMom: true,
  symptomThemes: [],
  planHash: 'a1b2c3d4',
  freshAngles: [],
  slots: [{ slotId: 'routine-baby', preview: 'A warm preview', body: ['A curated line.'] }],
};

check('valid minimal request', validateRequest({ ...MINIMAL }), {
  ok: true,
  value: { ...MINIMAL },
});

check(
  'valid full request',
  validateRequest({
    week: 36,
    day: 1,
    firstTimeMom: false,
    ageBand: '30-34',
    symptomThemes: ['backache', 'insomnia'],
    planHash: 'deadbeef',
    freshAngles: ['One fresh angle.'],
    slots: [
      { slotId: 'timely-prep-hospital-bag', preview: 'Pack the bag', body: ['Line one.', 'Line two.'] },
      { slotId: 'routine-baby', preview: 'Baby preview', body: ['Baby line.'] },
    ],
  }),
  {
    ok: true,
    value: {
      week: 36,
      day: 1,
      firstTimeMom: false,
      ageBand: '30-34',
      symptomThemes: ['backache', 'insomnia'],
      planHash: 'deadbeef',
      freshAngles: ['One fresh angle.'],
      slots: [
        { slotId: 'timely-prep-hospital-bag', preview: 'Pack the bag', body: ['Line one.', 'Line two.'] },
        { slotId: 'routine-baby', preview: 'Baby preview', body: ['Baby line.'] },
      ],
    },
  },
);

const bad = (body: unknown) => validateRequest(body);
check('rejects extra field (dueDate)', bad({ ...MINIMAL, dueDate: '2026-10-08' }), { ok: false, problem: 'invalid_request' });
check('rejects extra field (email)', bad({ ...MINIMAL, email: 'a@b.c' }), { ok: false, problem: 'invalid_request' });
check('rejects extra field (journalText)', bad({ ...MINIMAL, journalText: 'hello' }), { ok: false, problem: 'invalid_request' });
check('rejects extra slot field', bad({ ...MINIMAL, slots: [{ ...MINIMAL.slots[0], extra: 1 }] }), { ok: false, problem: 'invalid_request' });
check('rejects week 3', bad({ ...MINIMAL, week: 3 }), { ok: false, problem: 'invalid_request' });
check('rejects week 43', bad({ ...MINIMAL, week: 43 }), { ok: false, problem: 'invalid_request' });
check('rejects non-integer week', bad({ ...MINIMAL, week: 28.5 }), { ok: false, problem: 'invalid_request' });
check('rejects week as string', bad({ ...MINIMAL, week: '28' }), { ok: false, problem: 'invalid_request' });
check('rejects day 0', bad({ ...MINIMAL, day: 0 }), { ok: false, problem: 'invalid_request' });
check('rejects day 8', bad({ ...MINIMAL, day: 8 }), { ok: false, problem: 'invalid_request' });
check('rejects missing week', bad({ day: 3, firstTimeMom: true, symptomThemes: [], planHash: 'x', freshAngles: [], slots: MINIMAL.slots }), { ok: false, problem: 'invalid_request' });
check('rejects truthy firstTimeMom', bad({ ...MINIMAL, firstTimeMom: 'yes' }), { ok: false, problem: 'invalid_request' });
check('rejects bad ageBand', bad({ ...MINIMAL, ageBand: '30' }), { ok: false, problem: 'invalid_request' });
check('rejects 6 symptom themes', bad({ ...MINIMAL, symptomThemes: ['a', 'b', 'c', 'd', 'e', 'f'] }), { ok: false, problem: 'invalid_request' });
check('rejects non-string theme', bad({ ...MINIMAL, symptomThemes: ['backache', 42] }), { ok: false, problem: 'invalid_request' });
check('rejects empty theme string', bad({ ...MINIMAL, symptomThemes: ['  '] }), { ok: false, problem: 'invalid_request' });
check('rejects theme over 40 chars', bad({ ...MINIMAL, symptomThemes: ['x'.repeat(41)] }), { ok: false, problem: 'invalid_request' });
check('rejects missing planHash', bad({ ...MINIMAL, planHash: undefined }), { ok: false, problem: 'invalid_request' });
check('rejects 4 fresh angles', bad({ ...MINIMAL, freshAngles: ['a', 'b', 'c', 'd'] }), { ok: false, problem: 'invalid_request' });
check('rejects empty slots', bad({ ...MINIMAL, slots: [] }), { ok: false, problem: 'invalid_request' });
check('rejects 13 slots', bad({ ...MINIMAL, slots: Array.from({ length: 13 }, (_, i) => ({ slotId: `s${i}`, preview: 'p', body: ['b'] })) }), { ok: false, problem: 'invalid_request' });
check(
  'rejects duplicate slotIds',
  bad({ ...MINIMAL, slots: [MINIMAL.slots[0], { ...MINIMAL.slots[0] }] }),
  { ok: false, problem: 'invalid_request' },
);
check(
  'rejects preview over 80 chars',
  bad({ ...MINIMAL, slots: [{ slotId: 's', preview: 'x'.repeat(81), body: ['b'] }] }),
  { ok: false, problem: 'invalid_request' },
);
check(
  'rejects 6 body lines',
  bad({ ...MINIMAL, slots: [{ slotId: 's', preview: 'p', body: ['a', 'b', 'c', 'd', 'e', 'f'] }] }),
  { ok: false, problem: 'invalid_request' },
);
check(
  'rejects body line over 220 chars',
  bad({ ...MINIMAL, slots: [{ slotId: 's', preview: 'p', body: ['x'.repeat(221)] }] }),
  { ok: false, problem: 'invalid_request' },
);
check('rejects null body', bad(null), { ok: false, problem: 'invalid_request' });
check('rejects array body', bad([]), { ok: false, problem: 'invalid_request' });

/* ---------------- anonymization of the prompt ---------------- */

check(
  'request carries only the allowed anonymized fields',
  Object.keys(MINIMAL).sort(),
  ['day', 'firstTimeMom', 'freshAngles', 'planHash', 'slots', 'symptomThemes', 'week'],
);

const userPrompt = buildUserPrompt({
  week: 28,
  day: 3,
  firstTimeMom: true,
  ageBand: '30-34',
  symptomThemes: ['backache', 'insomnia'],
  planHash: 'a1b2c3d4',
  freshAngles: [],
  slots: MINIMAL.slots,
});
check('user prompt names week/day', userPrompt.includes('week 28') && userPrompt.includes('day 3'), true);
check('user prompt carries themes as labels', userPrompt.includes('backache') && userPrompt.includes('insomnia'), true);
check('user prompt mentions first-time', userPrompt.includes('first-time'), true);
check('user prompt carries the curated slots', userPrompt.includes('routine-baby'), true);
check(
  'user prompt has no identifiers',
  /dueDate|email|@|\d{4}-\d{2}-\d{2}/.test(userPrompt),
  false,
);

const system = buildSystemInstruction();
check('system: never add claims', system.includes('NEVER add claims'), true);
check('system: general-info-only rule', system.includes('GENERAL INFORMATION ONLY'), true);
check('system: never personalize', system.includes('NEVER personalize'), true);
check('system: no diagnosis/triage', system.includes('NO diagnosis') && system.includes('NO triage'), true);
check('system: bans fetal nicknames', system.includes('fetal') && system.includes('nicknames'), true);
check('system: bans gendered assumptions', system.includes('sex'), true);
check('system: exact slotIds and order', system.includes('EXACT slotIds') && system.includes('EXACT order'), true);
check('system: same number of body lines', system.includes('SAME number of body lines'), true);
check('system: length limits', system.includes('≤ 80') && system.includes('≤ 220'), true);

/* ---------------- response validation (validatePhrasing) ---------------- */

function goodSlots() {
  return [
    { slotId: 'routine-baby', preview: 'Phrased baby preview', body: ['Phrased baby line.'] },
    { slotId: 'routine-body', preview: 'Phrased body preview', body: ['Line one.', 'Line two.'] },
  ];
}

function goodRequest(): PhraseRequest {
  return {
    week: 28,
    day: 3,
    firstTimeMom: true,
    symptomThemes: [],
    planHash: 'a1b2c3d4',
    freshAngles: [],
    slots: [
      { slotId: 'routine-baby', preview: 'Curated', body: ['Curated line.'] },
      { slotId: 'routine-body', preview: 'Curated', body: ['Curated one.', 'Curated two.'] },
    ],
  };
}

const TODAY = '2026-09-18';

const valid = validatePhrasing({ slots: goodSlots(), reviewDate: '1999-01-01' }, goodRequest(), TODAY);
check('valid phrasing passes', valid !== null, true);
check('reviewDate is the function today, not the model value', valid?.reviewDate, TODAY);
check('slot order preserved', valid?.slots.map((s) => s.slotId), ['routine-baby', 'routine-body']);
check('phrased preview kept', valid?.slots[0].preview, 'Phrased baby preview');

check(
  'rejects wrong slot order',
  validatePhrasing({ slots: [goodSlots()[1], goodSlots()[0]], reviewDate: 'x' }, goodRequest(), TODAY),
  null,
);
check(
  'rejects slot count mismatch',
  validatePhrasing({ slots: goodSlots().slice(0, 1), reviewDate: 'x' }, goodRequest(), TODAY),
  null,
);
check(
  'rejects unknown slot id',
  validatePhrasing(
    { slots: goodSlots().map((s, i) => (i === 0 ? { ...s, slotId: 'routine-oops' } : s)), reviewDate: 'x' },
    goodRequest(),
    TODAY,
  ),
  null,
);
check(
  'rejects body line count mismatch',
  validatePhrasing(
    { slots: goodSlots().map((s, i) => (i === 0 ? { ...s, body: ['One.', 'Two.'] } : s)), reviewDate: 'x' },
    goodRequest(),
    TODAY,
  ),
  null,
);
check(
  'rejects empty preview',
  validatePhrasing(
    { slots: goodSlots().map((s, i) => (i === 0 ? { ...s, preview: '  ' } : s)), reviewDate: 'x' },
    goodRequest(),
    TODAY,
  ),
  null,
);
check('rejects non-object', validatePhrasing('nope', goodRequest(), TODAY), null);

const long = validatePhrasing(
  {
    slots: goodSlots().map((s, i) =>
      i === 0
        ? { ...s, preview: 'x'.repeat(200), body: ['y '.repeat(150)] }
        : s,
    ),
    reviewDate: 'x',
  },
  goodRequest(),
  TODAY,
);
check('long preview clamped to ≤ 80', (long?.slots[0].preview.length ?? 999) <= 80, true);
check('long body line clamped to ≤ 220', (long?.slots[0].body[0].length ?? 999) <= 220, true);

/* ---------------- callGemini with a STUBBED fetch (never real network) ---------------- */

interface SeenCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function cannedModelOutput() {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify({ slots: goodSlots(), reviewDate: '1999-12-31' }) }] } }],
  };
}

/** Stub fetch: records calls, returns canned Gemini output. No real network. */
function stubFetch(canned: unknown, opts?: { ok?: boolean; status?: number; throws?: boolean }) {
  const seen: SeenCall[] = [];
  const impl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    seen.push({ url, init });
    if (opts?.throws) throw new Error('network down');
    return {
      ok: opts?.ok ?? true,
      status: opts?.status ?? 200,
      text: async () => (typeof canned === 'string' ? canned : JSON.stringify(canned)),
    };
  };
  return { seen, impl };
}

async function main(): Promise<void> {
  // --- happy path ---
  {
    const { seen, impl } = stubFetch(cannedModelOutput());
    const phrasing = await callGemini(goodRequest(), 'TEST_KEY', impl as never, TODAY);
    check('happy path returns phrased slots', phrasing.slots.length, 2);
    check('happy path slot ids in order', phrasing.slots.map((s) => s.slotId), ['routine-baby', 'routine-body']);
    check('happy path reviewDate = today', phrasing.reviewDate, TODAY);
    check('one fetch call', seen.length, 1);
    check('calls the flash model endpoint', seen[0].url.includes(MODEL) && seen[0].url.includes(':generateContent'), true);
    // Provider retires model names (gemini-2.0-flash and gemini-2.5-flash both
    // 404'd Sept 2026 with "use gemini-3.6-flash"). Pin the model exactly so a
    // future rename is a deliberate, re-verified change — never a silent 404.
    check('MODEL pins a verified-available model', MODEL, 'gemini-3.6-flash');
    check('key sent as header, not in URL', seen[0].init.headers['x-goog-api-key'] === 'TEST_KEY' && !seen[0].url.includes('TEST_KEY'), true);
    const payload = JSON.parse(seen[0].init.body) as {
      generationConfig: { responseMimeType: string; responseSchema: unknown };
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    check('requests JSON mime type', payload.generationConfig.responseMimeType, 'application/json');
    check('sends a response schema', typeof payload.generationConfig.responseSchema, 'object');
    // The Gemini v1beta Schema proto has no `additionalProperties` field —
    // sending it makes the whole request 400 INVALID_ARGUMENT (verified live
    // Sept 2026). Assert it appears nowhere in the schema, recursively.
    check('response schema has no additionalProperties', containsKey(payload.generationConfig.responseSchema, 'additionalProperties'), false);
    check('system instruction sent', payload.systemInstruction.parts[0].text.includes('NEVER add claims'), true);
    check('user prompt carries week', payload.contents[0].parts[0].text.includes('week 28'), true);
    check('user prompt carries slot ids', payload.contents[0].parts[0].text.includes('routine-baby'), true);
  }

  // --- repair retry: first output invalid, second valid ---
  {
    let n = 0;
    const seen: SeenCall[] = [];
    const impl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      seen.push({ url, init });
      n += 1;
      const canned = n === 1 ? cannedModelOutputInvalid() : cannedModelOutput();
      return { ok: true, status: 200, text: async () => JSON.stringify(canned) };
    };
    const phrasing = await callGemini(goodRequest(), 'TEST_KEY', impl as never, TODAY);
    check('repair retry recovers', phrasing.slots.length, 2);
    check('repair retry made 2 calls', seen.length, 2);
    check('repair note sent on retry', (JSON.parse(seen[1].init.body) as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0].parts[0].text.includes('CORRECTION'), true);
  }

  // --- provider failures → ProviderError (caller maps to 502) ---
  async function expectProviderError(name: string, canned: unknown, opts?: { ok?: boolean; status?: number; throws?: boolean }) {
    const { impl } = stubFetch(canned, opts);
    try {
      await callGemini(goodRequest(), 'TEST_KEY', impl as never, TODAY);
      check(name, 'no-throw', 'ProviderError');
    } catch (e) {
      check(name, e instanceof ProviderError, true);
    }
  }

  await expectProviderError('HTTP 500 → ProviderError', {}, { ok: false, status: 500 });
  await expectProviderError('network throw → ProviderError', {}, { throws: true });
  await expectProviderError('non-JSON body → ProviderError', 'this is not json');
  await expectProviderError('empty candidates → ProviderError', { candidates: [] });
  await expectProviderError(
    'invalid schema even after repair → ProviderError',
    cannedModelOutputInvalid(),
  );

  check('footer constant', BRIEFING_FOOTER, 'Not medical advice — general information only.');

  console.log(`\nweek_briefing: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

function cannedModelOutputInvalid() {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify({ slots: [] }) }] } }] };
}

void main();
