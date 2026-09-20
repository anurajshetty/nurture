/**
 * Report-summary tests: edge-function logic
 * (supabase/functions/report-summary/lib.ts) — the document summarizer.
 *
 * EPHEMERAL contract (Anuraj Sept 2026): the app sends the document
 * bytes INLINE (`{ dataBase64, mimeType }`); the function decodes them,
 * forwards them to Gemini, and drops them. Nothing is written to
 * Supabase Storage.
 *
 * The Gemini API is NEVER touched here: `callGemini` takes an injected
 * fetch, and every test below passes a stub. Run with:
 *
 *   npx tsc tests/report_summary.test.ts supabase/functions/report-summary/lib.ts \
 *     src/reportSummary/flow.ts \
 *     --outDir /tmp/nurture-tests-rs --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-rs/tests/report_summary.test.js
 */

import {
  base64Encode,
  buildSystemInstruction,
  buildUserPrompt,
  callGemini,
  decodeRequestDocument,
  DocumentError,
  MAX_DOCUMENT_BYTES,
  MODEL,
  ProviderError,
  REPORT_DISCLAIMER,
  validateRequest,
  validateSummary,
  type ReportSummaryRequest,
} from '../supabase/functions/report-summary/lib';
import {
  base64EncodeBytes,
  readReportSummaryState,
  REPORT_SUMMARY_DISCLAIMER,
  runReportSummaryFlow,
  type ReportBytes,
  type ReportFlowStore,
  type ReportSummaryInput,
  type ReportSummaryResult,
  type ReportSummaryState,
} from '../src/reportSummary/flow';

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

/* ---------------- request validation (ephemeral contract) ---------------- */

const MINIMAL: ReportSummaryRequest = {
  dataBase64: base64Encode(new Uint8Array([1, 2, 3, 4])),
  mimeType: 'application/pdf',
};

const bad = (body: unknown) => validateRequest(body);

check('valid minimal request', validateRequest({ ...MINIMAL }), { ok: true, value: { ...MINIMAL } });
check(
  'mimeType normalized to lowercase',
  validateRequest({ ...MINIMAL, mimeType: 'IMAGE/PNG' }),
  { ok: true, value: { ...MINIMAL, mimeType: 'image/png' } },
);
check('rejects extra field (eventId)', bad({ ...MINIMAL, eventId: 'e1' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects extra field (bucket)', bad({ ...MINIMAL, bucket: 'files' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects extra field (storagePath)', bad({ ...MINIMAL, storagePath: 'reports/a.pdf' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects missing dataBase64', bad({ mimeType: 'application/pdf' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects empty dataBase64', bad({ ...MINIMAL, dataBase64: '' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects oversize dataBase64', bad({ ...MINIMAL, dataBase64: 'A'.repeat(15_000_001) }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects gif as unsupported_type', bad({ ...MINIMAL, mimeType: 'image/gif' }), {
  ok: false,
  problem: 'unsupported_type',
});
check('rejects text/plain as unsupported_type', bad({ ...MINIMAL, mimeType: 'text/plain' }), {
  ok: false,
  problem: 'unsupported_type',
});
check('rejects missing mimeType', bad({ dataBase64: 'QUJD' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects null body', bad(null), { ok: false, problem: 'invalid_request' });
check('rejects array body', bad([]), { ok: false, problem: 'invalid_request' });

check(
  'request carries only the two allowed fields',
  Object.keys(MINIMAL).sort(),
  ['dataBase64', 'mimeType'],
);

/* ---------------- inline document decode ---------------- */

function expectUnreadable(name: string, payload: string) {
  try {
    decodeRequestDocument(payload);
    check(name, 'no-throw', 'DocumentError');
  } catch (e) {
    check(name, e instanceof DocumentError, true);
  }
}

{
  const bytes = new Uint8Array([10, 20, 30, 40, 50]);
  const decoded = decodeRequestDocument(base64Encode(bytes));
  check('decode round-trips the bytes', Array.from(decoded), [10, 20, 30, 40, 50]);
}
expectUnreadable('rejects non-base64 chars', '!!!not-base64!!!');
expectUnreadable('rejects empty payload', '');
expectUnreadable('rejects bad padding length', 'ABC');
check('MAX_DOCUMENT_BYTES is 12MB', MAX_DOCUMENT_BYTES, 12 * 1024 * 1024);
// Oversize decode → unreadable without allocating the giant buffer: craft a
// payload whose DECODED length exceeds the cap (4/3 * 17MB chars ≈
// 12.75MB > 12MB cap). The guard runs before any allocation.
expectUnreadable('rejects payload decoding past the cap', 'A'.repeat(17 * 1024 * 1024));

/* ---------------- prompt: Anuraj's content rule + safety ---------------- */

const system = buildSystemInstruction();
check('system: short-and-precise rule', system.includes('SHORT and precise'), true);
check('system: lead with what needs attention', system.includes('Lead with anything'), true);
check('system: two to three sentences max', system.includes('two to three short sentences maximum'), true);
check('system: 400 char cap', system.includes('400 characters'), true);
check('system: general information only', system.includes('GENERAL INFORMATION ONLY'), true);
check('system: no diagnosis', system.includes('No diagnosis'), true);
check('system: no triage', system.includes('no triage'), true);
check('system: no prescribing', system.includes('no prescribing'), true);
check('system: no risk rates', system.includes('no risk rates'), true);
check('system: bans you should/shouldn\'t', system.includes('"you should"'), true);
check('system: care-team framing', system.includes('care team'), true);
check('system: never invent values', system.includes('Never invent values'), true);
check('system: never repeat API keys', system.includes('Never repeat API keys'), true);
check('system: JSON-only output', system.includes('Output JSON only'), true);

const userPrompt = buildUserPrompt('September 19, 2026');
check('user prompt carries today', userPrompt.includes('September 19, 2026'), true);
check('user prompt names the document kinds', userPrompt.includes('lab report'), true);
check('user prompt is JSON-only', userPrompt.includes('Output JSON only'), true);

/* ---------------- base64 (Deno-free, no btoa/Buffer) ---------------- */

function nodeB64(bytes: Uint8Array): string {
  // Test-only reference implementation via Buffer.
  return (globalThis as unknown as { Buffer: { from(b: Uint8Array): { toString(e: string): string } } }).Buffer.from(
    bytes,
  ).toString('base64');
}

for (const len of [0, 1, 2, 3, 4, 5, 100, 1000]) {
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) % 256;
  check(`base64Encode matches Buffer (len ${len})`, base64Encode(bytes), nodeB64(bytes));
}

/* ---------------- response validation (validateSummary) ---------------- */

function goodModelJson() {
  return {
    title: 'Glucose results',
    summary: 'Your glucose screening came back in the typical range. Nothing in it asks anything of you right now.',
    attachmentName: 'Glucose screening – Sep 19',
    needsAttention: false,
  };
}

const valid = validateSummary(goodModelJson());
check('valid summary passes', valid !== null, true);
check('title kept', valid?.title, 'Glucose results');
check('needsAttention kept', valid?.needsAttention, false);

check('rejects missing needsAttention', validateSummary({ ...goodModelJson(), needsAttention: undefined }), null);
check('rejects string needsAttention', validateSummary({ ...goodModelJson(), needsAttention: 'yes' }), null);
check('rejects empty title', validateSummary({ ...goodModelJson(), title: '  ' }), null);
check('rejects empty summary', validateSummary({ ...goodModelJson(), summary: '' }), null);
check('rejects empty attachmentName', validateSummary({ ...goodModelJson(), attachmentName: '' }), null);
check('rejects non-object', validateSummary('nope'), null);
check('rejects null', validateSummary(null), null);

const clamped = validateSummary({
  ...goodModelJson(),
  title: 'x'.repeat(60),
  summary: 'y '.repeat(250),
  attachmentName: 'z'.repeat(80),
});
check('title clamped to ≤ 50', (clamped?.title.length ?? 999) <= 50, true);
check('summary clamped to ≤ 400', (clamped?.summary.length ?? 999) <= 400, true);
check('attachmentName clamped to ≤ 60', (clamped?.attachmentName.length ?? 999) <= 60, true);
check('clamped values keep word-boundary ellipsis', clamped?.title.endsWith('…'), true);

async function main(): Promise<void> {
  /* ---------------- callGemini with a STUBBED fetch (never real network) ---------------- */

  interface SeenCall {
    url: string;
    init: { method: string; headers: Record<string, string>; body: string };
  }

  function cannedModelOutput() {
    return {
      candidates: [{ content: { parts: [{ text: JSON.stringify(goodModelJson()) }] } }],
    };
  }

  function stubFetch(canned: unknown, opts?: { ok?: boolean; status?: number; throws?: boolean }) {
    const seen: SeenCall[] = [];
    const impl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      seen.push({ url, init });
      if (opts?.throws) throw new Error('network down');
      return {
        ok: opts?.ok ?? true,
        status: opts?.status ?? 200,
        text: async () => (typeof canned === 'string' ? canned : JSON.stringify(canned)),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    return { seen, impl };
  }

  const docBytes = new Uint8Array([10, 20, 30]);
  const todayLong = 'September 19, 2026';

  // --- happy path ---
  {
    const { seen, impl } = stubFetch(cannedModelOutput());
    const summary = await callGemini('application/pdf', docBytes, todayLong, 'TEST_KEY', impl as never);
    check('happy path returns the summary', summary.summary, goodModelJson().summary);
    check('happy path returns the title', summary.title, 'Glucose results');
    check('happy path returns attachmentName', summary.attachmentName, 'Glucose screening – Sep 19');
    check('happy path returns needsAttention', summary.needsAttention, false);
    check('one fetch call', seen.length, 1);
    check('calls the flash model endpoint', seen[0].url.includes(MODEL) && seen[0].url.includes(':generateContent'), true);
    // Provider retires model names (gemini-2.0-flash and gemini-2.5-flash both
    // 404'd Sept 2026 with "use gemini-3.6-flash"). Pin the model exactly so a
    // future rename is a deliberate, re-verified change — never a silent 404.
    check('MODEL pins a verified-available model', MODEL, 'gemini-3.6-flash');
    check('key sent as header, not in URL', seen[0].init.headers['x-goog-api-key'] === 'TEST_KEY' && !seen[0].url.includes('TEST_KEY'), true);
    const payload = JSON.parse(seen[0].init.body) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
      generationConfig: { responseMimeType: string; responseSchema: unknown; temperature: number };
    };
    check('system instruction carries the content rule', payload.systemInstruction.parts[0].text.includes('SHORT and precise'), true);
    const inline = payload.contents[0].parts.find((p) => p.inlineData);
    check('document sent as inline_data', !!inline, true);
    check('inline_data mimeType', inline?.inlineData?.mimeType, 'application/pdf');
    check('inline_data is base64 of the bytes', inline?.inlineData?.data, base64Encode(docBytes));
    check('response is JSON', payload.generationConfig.responseMimeType, 'application/json');
    check('response schema requires the four fields', true, true);
    const schema = payload.generationConfig.responseSchema as { required: string[] };
    check('schema requires title/summary/attachmentName/needsAttention', schema.required.sort(), ['attachmentName', 'needsAttention', 'summary', 'title']);
    const userText = payload.contents[0].parts.map((p) => p.text ?? '').join('');
    check('user prompt carries today', userText.includes(todayLong), true);
  }

  // --- repair retry: first output structurally invalid, second valid ---
  {
    const invalid = { candidates: [{ content: { parts: [{ text: JSON.stringify({ title: 'x' }) }] } }] };
    const calls: SeenCall[] = [];
    const impl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      const n = calls.length;
      calls.push({ url, init });
      const canned = n === 0 ? invalid : cannedModelOutput();
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(canned),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    const summary = await callGemini('image/jpeg', docBytes, todayLong, 'TEST_KEY', impl as never);
    check('repair retry recovers', summary.title, 'Glucose results');
    check('repair retry made two calls', calls.length, 2);
    const secondPayload = JSON.parse(calls[1].init.body) as {
      contents: Array<{ parts: Array<{ text?: string }> }>;
    };
    const secondText = secondPayload.contents[0].parts.map((p) => p.text ?? '').join('');
    check('second call carries the correction note', secondText.includes('CORRECTION'), true);
  }

  // --- provider failures → ProviderError ---
  async function expectProviderError(name: string, canned: unknown, opts?: { ok?: boolean; status?: number; throws?: boolean }) {
    const { impl } = stubFetch(canned, opts);
    try {
      await callGemini('application/pdf', docBytes, todayLong, 'TEST_KEY', impl as never);
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
    { candidates: [{ content: { parts: [{ text: JSON.stringify({ title: 'x' }) }] } }] },
  );

  check('disclaimer constant', REPORT_DISCLAIMER, "This isn't medical advice — check with your care team.");

  // Locked app-side copy (Anuraj, Sept 19, 2026): the summary card renders
  // the FIXED "This isn't medical advice." — the model never writes it.
  check('app-side disclaimer is the locked copy', REPORT_SUMMARY_DISCLAIMER, "This isn't medical advice.");

  /* ---------------- pure flow (src/reportSummary/flow.ts) ----------------
   * The ephemeral state machine, driven with doubles — no store, no
   * transport, no persistence of bytes anywhere. */

  function makeFlowHarness(initial: ReportSummaryState | null) {
    const writes: ReportSummaryState[] = [];
    let state = initial;
    let entryName: string | undefined;
    const store: ReportFlowStore = {
      readState: () => state,
      writeState: (s) => {
        state = s;
        writes.push(s);
      },
      setEntryName: (n) => {
        entryName = n;
      },
    };
    return { store, writes, getState: () => state, getEntryName: () => entryName };
  }

  const FLOW_RESULT: ReportSummaryResult = {
    title: 'Growth scan',
    summary: 'Typical for this stage.',
    attachmentName: 'Growth scan – Sep 19',
    needsAttention: false,
    disclaimer: REPORT_DISCLAIMER,
  };

  // --- success: interim first, inline bytes only, ready + bytes dropped ---
  {
    const h = makeFlowHarness({ status: 'summarizing' });
    const stash = new Map<string, ReportBytes>([
      ['flow-e1', { dataBase64: 'QUJD', mimeType: 'application/pdf' }],
    ]);
    let cleared = false;
    const seenInputs: ReportSummaryInput[] = [];
    let resolveSummarize!: (r: ReportSummaryResult) => void;
    const pending = new Promise<ReportSummaryResult>((res) => {
      resolveSummarize = res;
    });
    const flowPromise = runReportSummaryFlow({
      eventId: 'flow-e1',
      store: h.store,
      takeBytes: () => stash.get('flow-e1') ?? null,
      clearBytes: () => {
        cleared = true;
        stash.delete('flow-e1');
      },
      summarize: (input) => {
        seenInputs.push(input);
        return pending;
      },
    });
    // Interim is written synchronously — before the promise resolves.
    check('flow writes summarizing before the summary resolves', h.writes[0], {
      status: 'summarizing',
    });
    resolveSummarize(FLOW_RESULT);
    const outcome = await flowPromise;
    check('flow success resolves ready', outcome, 'ready');
    check('invoke receives ONLY inline bytes + mime', seenInputs[0], {
      dataBase64: 'QUJD',
      mimeType: 'application/pdf',
    });
    check('flow writes the ready state', h.getState(), { status: 'ready', ...FLOW_RESULT });
    check('bytes are dropped after success', cleared, true);
    check('entry takes the LLM-derived name', h.getEntryName(), 'Growth scan – Sep 19');
  }

  // --- failure: failed state, bytes RETAINED for Try again ---
  {
    const h = makeFlowHarness({ status: 'summarizing' });
    const stash = new Map<string, ReportBytes>([
      ['flow-e2', { dataBase64: 'QUJD', mimeType: 'application/pdf' }],
    ]);
    let cleared = false;
    const outcome = await runReportSummaryFlow({
      eventId: 'flow-e2',
      store: h.store,
      takeBytes: () => stash.get('flow-e2') ?? null,
      clearBytes: () => {
        cleared = true;
        stash.delete('flow-e2');
      },
      summarize: () => Promise.reject(new Error('provider down')),
    });
    check('flow failure resolves failed', outcome, 'failed');
    check('flow writes the failed state', h.getState(), { status: 'failed' });
    check('bytes are RETAINED after failure (retry can re-send)', cleared, false);
    check('stashed bytes survive the failure', stash.has('flow-e2'), true);
  }

  // --- not_configured: backend not deployed → setup state, no retry copy ---
  {
    const h = makeFlowHarness({ status: 'summarizing' });
    const notConfigured = new Error('edge function has no provider key');
    notConfigured.name = 'ReportSummaryError';
    (notConfigured as { code?: string }).code = 'not_configured';
    const outcome = await runReportSummaryFlow({
      eventId: 'flow-e2b',
      store: h.store,
      takeBytes: () => ({ dataBase64: 'QUJD', mimeType: 'application/pdf' }),
      clearBytes: () => {},
      summarize: () => Promise.reject(notConfigured),
    });
    check('not_configured failure resolves failed', outcome, 'failed');
    check('not_configured persists the reason', h.getState(), {
      status: 'failed',
      reason: 'not_configured',
    });
  }

  // --- stale entry: no stashed bytes → failed, summarize never called ---
  {
    const h = makeFlowHarness({ status: 'summarizing' });
    let summarizeCalled = false;
    const outcome = await runReportSummaryFlow({
      eventId: 'flow-e3',
      store: h.store,
      takeBytes: () => null,
      clearBytes: () => {},
      summarize: () => {
        summarizeCalled = true;
        return Promise.resolve(FLOW_RESULT);
      },
    });
    check('stale entry (no bytes) resolves failed', outcome, 'failed');
    check('stale entry marked failed, never hangs', h.getState(), { status: 'failed' });
    check('summarize is never called without bytes', summarizeCalled, false);
  }

  // --- a finished summary is never re-run ---
  {
    const h = makeFlowHarness({ status: 'ready', ...FLOW_RESULT });
    let summarizeCalled = false;
    const outcome = await runReportSummaryFlow({
      eventId: 'flow-e4',
      store: h.store,
      takeBytes: () => ({ dataBase64: 'QUJD', mimeType: 'application/pdf' }),
      clearBytes: () => {},
      summarize: () => {
        summarizeCalled = true;
        return Promise.resolve(FLOW_RESULT);
      },
    });
    check('ready entry is skipped', outcome, 'skipped');
    check('no writes on skip', h.writes.length, 0);
    check('no re-summarize on skip', summarizeCalled, false);
  }

  // --- state parsing: legacy 'reading' → summarizing; garbage → null ---
  check('legacy reading maps to summarizing', readReportSummaryState({ reportSummary: { status: 'reading' } }), {
    status: 'summarizing',
  });
  check('absent state is null', readReportSummaryState({}), null);
  check('malformed ready state is null', readReportSummaryState({ reportSummary: { status: 'ready' } }), null);
  check('not_configured reason survives the round-trip',
    readReportSummaryState({ reportSummary: { status: 'failed', reason: 'not_configured' } }),
    { status: 'failed', reason: 'not_configured' });
  check('generic failure reads back with no reason',
    readReportSummaryState({ reportSummary: { status: 'failed' } }),
    { status: 'failed' });
  check('unknown reason is dropped (generic copy + retry)',
    readReportSummaryState({ reportSummary: { status: 'failed', reason: 'bogus' } }),
    { status: 'failed' });

  // --- chunked base64 encoder round-trips a large payload ---
  {
    const big = new Uint8Array(100_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 37 + 11) % 256;
    check('base64EncodeBytes round-trips 100KB', base64EncodeBytes(big), nodeB64(big));
  }

  console.log(`\nreport_summary: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
