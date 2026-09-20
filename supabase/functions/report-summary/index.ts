/**
 * report-summary — Supabase Edge Function (Deno).
 *
 * Sends an uploaded pregnancy health document to the Gemini API for a
 * short plain-language summary, and returns a short title plus an
 * auto-derived attachment name. The API key NEVER leaves this function:
 * it is read from the `GEMINI_API_KEY` env secret (Supabase dashboard →
 * nurture project → Edge Functions → Secrets).
 *
 * Thin wrapper: env + CORS + HTTP status mapping live here; everything
 * else (validation, prompt, Storage download, Gemini call) is in lib.ts,
 * which is unit-tested (`tests/report_summary.test.ts`).
 *
 * Deploy: `supabase functions deploy report-summary`
 * (from the repo root, with the Supabase CLI logged in to the nurture project).
 */

import {
  callGemini,
  DocumentError,
  fetchDocumentBytes,
  ProviderError,
  REPORT_DISCLAIMER,
  validateRequest,
  type RequestProblem,
} from './lib.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const PROBLEM_STATUS: Record<RequestProblem, number> = {
  invalid_json: 400,
  invalid_request: 400,
  unsupported_type: 400,
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    // Secret not set yet — the app degrades gracefully (see README).
    return json(503, { error: 'not_configured' });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    // Both are auto-provided in edge functions; missing means the runtime
    // is broken.
    console.error('report-summary missing_supabase_env');
    return json(502, { error: 'provider_error' });
  }

  // Privacy: the body is validated but NEVER logged, in any path.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const validated = validateRequest(body);
  if (!validated.ok) {
    return json(PROBLEM_STATUS[validated.problem], { error: validated.problem });
  }
  const r = validated.value;

  const startedAt = Date.now();
  try {
    // Read the bytes from Storage server-side; the caller's Authorization
    // header is forwarded so Storage RLS applies to this read.
    const bytes = await fetchDocumentBytes(
      {
        supabaseUrl,
        anonKey: supabaseAnonKey,
        authHeader: req.headers.get('authorization'),
        bucket: r.bucket,
        storagePath: r.storagePath,
      },
      fetch,
    );
    const todayLong = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const summary = await callGemini(r.mimeType, bytes, todayLong, apiKey, fetch);
    // Privacy: log only success + latency — no request fields, no document
    // content, no identifiers.
    console.log(`report-summary ok latency_ms=${Date.now() - startedAt}`);
    return json(200, { ...summary, disclaimer: REPORT_DISCLAIMER });
  } catch (e) {
    if (e instanceof DocumentError) {
      // The object is missing, forbidden, empty, or too large — the app
      // shows the "Couldn't read this one" card immediately.
      console.error('report-summary unreadable');
      return json(422, { error: 'unreadable' });
    }
    if (e instanceof ProviderError) {
      // Privacy: no provider internals (status, body) are logged or returned.
      console.error('report-summary provider_error');
      return json(502, { error: 'provider_error' });
    }
    console.error('report-summary unexpected_error');
    return json(502, { error: 'provider_error' });
  }
});
