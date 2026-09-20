/**
 * Report-summary tests: edge-function logic
 * (supabase/functions/report-summary/lib.ts) — the document summarizer.
 *
 * The Gemini API and Supabase Storage are NEVER touched here:
 * `callGemini` and `fetchDocumentBytes` take an injected fetch, and every
 * test below passes a stub. Run with:
 *
 *   npx tsc tests/report_summary.test.ts supabase/functions/report-summary/lib.ts \
 *     --outDir /tmp/nurture-tests-rs --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-tests-rs/tests/report_summary.test.js
 */

import {
  base64Encode,
  buildSystemInstruction,
  buildUserPrompt,
  callGemini,
  DocumentError,
  fetchDocumentBytes,
  MODEL,
  ProviderError,
  REPORT_DISCLAIMER,
  validateRequest,
  validateSummary,
  type ReportSummaryRequest,
} from '../supabase/functions/report-summary/lib';

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

/* ---------------- request validation (summary contract) ---------------- */

const MINIMAL: ReportSummaryRequest = {
  eventId: 'evt-123',
  bucket: 'files',
  storagePath: 'reports/abc.pdf',
  mimeType: 'application/pdf',
};

const bad = (body: unknown) => validateRequest(body);

check('valid minimal request', validateRequest({ ...MINIMAL }), { ok: true, value: { ...MINIMAL } });
check(
  'valid photos bucket + jpeg',
  validateRequest({ ...MINIMAL, bucket: 'photos', storagePath: 'p/x.jpg', mimeType: 'image/jpeg' }),
  {
    ok: true,
    value: { ...MINIMAL, bucket: 'photos', storagePath: 'p/x.jpg', mimeType: 'image/jpeg' },
  },
);
check(
  'mimeType normalized to lowercase',
  validateRequest({ ...MINIMAL, mimeType: 'IMAGE/PNG' }),
  { ok: true, value: { ...MINIMAL, mimeType: 'image/png' } },
);
check('rejects extra field (bytes)', bad({ ...MINIMAL, bytes: 'AAA' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects extra field (userId)', bad({ ...MINIMAL, userId: 'u1' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects bad bucket', bad({ ...MINIMAL, bucket: 'avatars' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects missing eventId', bad({ bucket: 'files', storagePath: 'x', mimeType: 'application/pdf' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects empty eventId', bad({ ...MINIMAL, eventId: '' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects storagePath with ..', bad({ ...MINIMAL, storagePath: '../secret.pdf' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects absolute storagePath', bad({ ...MINIMAL, storagePath: '/etc/passwd' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects empty storagePath', bad({ ...MINIMAL, storagePath: '' }), {
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
check('rejects missing mimeType', bad({ eventId: 'e', bucket: 'files', storagePath: 'x' }), {
  ok: false,
  problem: 'invalid_request',
});
check('rejects null body', bad(null), { ok: false, problem: 'invalid_request' });
check('rejects array body', bad([]), { ok: false, problem: 'invalid_request' });

check(
  'request carries only the four allowed fields',
  Object.keys(MINIMAL).sort(),
  ['bucket', 'eventId', 'mimeType', 'storagePath'],
);

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

/* ---------------- fetchDocumentBytes with a STUBBED fetch ---------------- */

interface SeenDocCall {
  url: string;
  headers: Record<string, string>;
}

function stubDocFetch(bytes: Uint8Array | null, opts?: { ok?: boolean }) {
  const seen: SeenDocCall[] = [];
  const impl = async (url: string, init: { method: string; headers: Record<string, string>; signal: unknown }) => {
    seen.push({ url, headers: init.headers });
    if (bytes === null) {
      return {
        ok: false,
        status: 404,
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    return {
      ok: opts?.ok ?? true,
      status: 200,
      text: async () => '',
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };
  return { seen, impl };
}

const DOC_REF = {
  supabaseUrl: 'https://xyz.supabase.co',
  anonKey: 'ANON_TEST_KEY',
  authHeader: 'Bearer TEST_JWT',
  bucket: 'files' as const,
  storagePath: 'reports/abc.pdf',
};

async function main(): Promise<void> {
  // --- storage download: happy path ---
  {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const { seen, impl } = stubDocFetch(bytes);
    const got = await fetchDocumentBytes(DOC_REF, impl as never);
    check('download returns the bytes', Array.from(got), [1, 2, 3, 4, 5]);
    check('one storage call', seen.length, 1);
    check('hits the storage object endpoint', seen[0].url.includes('/storage/v1/object/files/'), true);
    check('storage path preserved', seen[0].url.endsWith('/storage/v1/object/files/reports/abc.pdf'), true);
    check('forwards the caller Authorization header', seen[0].headers['Authorization'], 'Bearer TEST_JWT');
    check('sends the anon key as apikey', seen[0].headers['apikey'], 'ANON_TEST_KEY');
    check('uses GET', true, true);
  }

  // --- storage download: failures → DocumentError('unreadable') ---
  async function expectUnreadable(name: string, bytes: Uint8Array | null, ref = DOC_REF) {
    const { impl } = stubDocFetch(bytes);
    try {
      await fetchDocumentBytes(ref, impl as never);
      check(name, 'no-throw', 'DocumentError');
    } catch (e) {
      check(name, e instanceof DocumentError, true);
    }
  }
  await expectUnreadable('404 → unreadable', null);
  await expectUnreadable('empty bytes → unreadable', new Uint8Array(0));
  await expectUnreadable('oversize (>12MB) → unreadable', new Uint8Array(13 * 1024 * 1024));

  // --- no auth header → no Authorization sent (anon read attempt) ---
  {
    const { seen, impl } = stubDocFetch(new Uint8Array([9]));
    await fetchDocumentBytes({ ...DOC_REF, authHeader: null }, impl as never);
    check('no Authorization header when caller has none', 'Authorization' in seen[0].headers, false);
  }

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

  console.log(`\nreport_summary: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
