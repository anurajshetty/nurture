/**
 * week-briefing — Supabase Edge Function (Deno), v1.1: LLM-as-phraser.
 *
 * The app curates the facts on-device (the 40-week matrix) and the rules
 * engine chooses the slots and their order. This function only PHRASES the
 * curated slots warmly via the Gemini API — it never invents facts.
 * The key NEVER leaves this function: it is read from the `GEMINI_API_KEY`
 * env secret (Supabase dashboard → nurture project → Edge Functions → Secrets).
 *
 * Thin wrapper: env + CORS + HTTP status mapping live here; everything
 * else (validation, prompt, Gemini call) is in lib.ts, which is unit-tested.
 *
 * Deploy: `supabase functions deploy week-briefing`
 * (from the repo root, with the Supabase CLI logged in to the nurture project).
 */

import {
  BRIEFING_FOOTER,
  callGemini,
  ProviderError,
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

  const today = new Date().toISOString().slice(0, 10); // reviewDate = today (UTC)
  try {
    const phrasing = await callGemini(validated.value, apiKey, fetch, today);
    return json(200, { ...phrasing, footer: BRIEFING_FOOTER });
  } catch (e) {
    if (e instanceof ProviderError) {
      // Privacy: no provider internals (status, body) are logged or returned.
      console.error('week-briefing provider_error');
      return json(502, { error: 'provider_error' });
    }
    console.error('week-briefing unexpected_error');
    return json(502, { error: 'provider_error' });
  }
});
