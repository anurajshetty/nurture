/**
 * pregnancy-chat — Ask Willow edge function (Anuraj, Sept 20, 2026).
 *
 * POST  /pregnancy-chat  { question, context }  →  200 { kind, text, disclaimer, remaining, dailyLimit }
 * GET   /pregnancy-chat                          →  200 { remaining, dailyLimit, configured }
 *
 * Contract:
 * - Auth (Anuraj, Sept 20, 2026): every install signs in anonymously at
 *   boot, so every app caller presents a server-issued JWT. The quota
 *   plan (lib.ts `resolveQuotaPlan`) is:
 *     · real (non-anonymous) identity → own quota rows, CHAT_DAILY_LIMIT
 *       (default 10/day);
 *     · anonymous identity → own quota rows keyed on the identity,
 *       CHAT_ANON_DAILY_LIMIT (default 30/day per install) — one
 *       install can never burn another's;
 *     · no identity at all → ONE small shared fallback bucket
 *       (CHAT_ANON_DAILY_LIMIT) — tight, because the endpoint URL is
 *       public and anyone with it can burn Gemini calls.
 *   No conversation content is ever stored.
 * - Quota is server-enforced and atomic: the `ai_chat_try_consume`
 *   (per-person) and `ai_chat_try_consume_anon` (shared bucket)
 *   Postgres functions check and increment the counter in one locked
 *   statement, so concurrent requests cannot over-admit.
 *   Per-person reads/writes go through the caller's JWT under an RLS
 *   policy (`auth.uid() = user_id`) — never a broad anon upsert. The
 *   anonymous bucket is touched ONLY through `security definer` RPCs
 *   granted to `anon` (the table itself has RLS enabled with no
 *   permissive policies, so direct PostgREST access is denied).
 * - 422 invalid_request — schema violation (unknown fields rejected).
 * - 429 limit_reached / rate_limited — daily cap (default 10, server-
 *   configurable via CHAT_DAILY_LIMIT) or 5-per-minute burst window.
 * - 503 not_configured — GEMINI_API_KEY not set. The client shows a
 *   quiet unavailable state; nothing about keys leaks.
 * - 503 quota_unavailable — quota store unreachable; fail closed. The
 *   client reports a plain send failure.
 * - 502 provider_unavailable — Gemini unreachable; generic, no raw
 *   provider errors. The consumed question is refunded.
 * - Urgent-symptom pre-check runs BEFORE quota: the care-team handoff
 *   still works at the limit and never consumes quota.
 *
 * Privacy: no request body, question, context, or answer is logged or
 * persisted. Only counters (status, latency) go to the logs.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import {
  ANON_DAILY_LIMIT_DEFAULT,
  handleChatPost,
  callGeminiJson,
  parseDailyLimit,
  resolveQuotaPlan,
  type QuotaStore,
} from './lib.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const started = Date.now();
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';

  // Identify the caller from their own JWT. Every install signs in
  // anonymously at boot (Anuraj, Sept 20, 2026), so app callers carry a
  // server-issued anonymous identity; callers with no JWT at all fall
  // back to the shared anonymous bucket. Nothing is 401'd.
  let userId: string | null = null;
  let isAnonymous = false;
  try {
    const sb = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await sb.auth.getUser();
    if (!error && data?.user?.id) {
      userId = data.user.id;
      isAnonymous = data.user.is_anonymous === true;
    }
  } catch {
    userId = null;
    isAnonymous = false;
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? null;
  const dailyLimit = parseDailyLimit(Deno.env.get('CHAT_DAILY_LIMIT'));
  const anonDailyLimit = parseDailyLimit(Deno.env.get('CHAT_ANON_DAILY_LIMIT'), ANON_DAILY_LIMIT_DEFAULT);
  // One plan drives both the GET display line and the POST consume
  // path: anonymous installs spend from their OWN rows (30/install),
  // real identities from their own rows (10/person), no-JWT callers
  // from the shared fallback bucket.
  const plan = resolveQuotaPlan({ userId, isAnonymous, dailyLimit, anonDailyLimit });

  if (method === 'GET') {
    if (!apiKey) return json(503, { error: 'not_configured' });
    const dayKey = new Date().toISOString().slice(0, 10);
    if (userId) {
      // Quota read under the caller's JWT: the RLS policy limits rows to
      // auth.uid() = user_id, so one identity can never see another's
      // count. Anonymous installs read their own 30/day rows here
      // (plan.dailyLimit); real identities read their 10/day rows.
      const cap = plan.dailyLimit;
      let remaining = cap;
      try {
        const sb = createClient(supabaseUrl, supabaseKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data, error } = await sb
          .from('ai_chat_quota')
          .select('count')
          .eq('user_id', userId)
          .eq('day', dayKey)
          .maybeSingle();
        if (!error && data) remaining = Math.max(0, cap - (data.count ?? 0));
      } catch {
        remaining = cap;
      }
      logCounters('GET', 200, Date.now() - started);
      return json(200, { remaining, dailyLimit: cap, configured: true });
    }
    // No identity at all: shared fallback bucket via the security-definer
    // peek RPC (the table itself has no anon RLS policy, so direct reads
    // are denied). Read errors fail open to the cap for display; the POST
    // path still fails closed on consume errors.
    let anonRemaining = anonDailyLimit;
    try {
      const sb = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await sb.rpc('ai_chat_anon_peek', { p_day: dayKey });
      if (!error && typeof data === 'number') anonRemaining = Math.max(0, anonDailyLimit - data);
    } catch {
      anonRemaining = anonDailyLimit;
    }
    logCounters('GET', 200, Date.now() - started);
    return json(200, { remaining: anonRemaining, dailyLimit: anonDailyLimit, configured: true });
  }

  if (method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return json(422, { error: 'invalid_request' });
  }

  const sbAuthed = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authHeader } },
  });
  // Per-plan quota spend: identities (real or anonymous) spend from
  // their own rows under their own JWT; no-JWT callers spend from the
  // shared fallback bucket.
  const sbAnon = createClient(supabaseUrl, supabaseKey);
  const store: QuotaStore =
    plan.kind === 'personal' ? supabaseQuotaStore(sbAuthed) : anonQuotaStore(sbAnon);
  const verdict = await handleChatPost({
    body,
    userId,
    apiKey,
    dailyLimit: plan.dailyLimit,
    store,
    nowISO: new Date().toISOString(),
    dayKey: new Date().toISOString().slice(0, 10),
    gemini: (messages, key) => callGeminiJson(messages, key, fetch),
  });
  logCounters('POST', verdict.status, Date.now() - started);
  return json(verdict.status, verdict.body);
});

/**
 * Per-person quota rows, one per user per day. Created by Anuraj's
 * one-time SQL (see README.md Step 1):
 *
 *   create table ai_chat_quota (
 *     user_id uuid not null,
 *     day date not null,
 *     count int not null default 0,
 *     window_start timestamptz,
 *     window_count int not null default 0,
 *     primary key (user_id, day)
 *   );
 *
 * RLS restricts every row to its owner (`auth.uid() = user_id`), and all
 * quota calls below run under the CALLER's JWT — never the anon key —
 * so one person can neither read nor move another's counter.
 * `ai_chat_try_consume` does the check-and-increment in one locked
 * statement (see README.md): concurrent requests cannot over-admit.
 * Conversations are never stored: this table carries counters only.
 */
function supabaseQuotaStore(sbAuthed: ReturnType<typeof createClient>): QuotaStore {
  return {
    async peekRemaining(userId, day, dailyLimit) {
      try {
        const { data, error } = await sbAuthed
          .from('ai_chat_quota')
          .select('count')
          .eq('user_id', userId)
          .eq('day', day)
          .maybeSingle();
        if (error || !data) return error ? null : dailyLimit;
        return Math.max(0, dailyLimit - (data.count ?? 0));
      } catch {
        return null;
      }
    },
    async tryConsume(userId, day, dailyLimit) {
      try {
        const { data, error } = await sbAuthed.rpc('ai_chat_try_consume', {
          p_user_id: userId,
          p_day: day,
          p_limit: dailyLimit,
        });
        if (error || !data || typeof data !== 'object') return { ok: false, kind: 'unavailable' };
        const r = data as { ok?: unknown; reason?: unknown; remaining?: unknown };
        if (r.ok === true)
          return { ok: true, remaining: typeof r.remaining === 'number' ? r.remaining : 0 };
        if (r.reason === 'daily') return { ok: false, kind: 'daily' };
        if (r.reason === 'burst') return { ok: false, kind: 'rate' };
        return { ok: false, kind: 'unavailable' };
      } catch {
        return { ok: false, kind: 'unavailable' };
      }
    },
    async refund(userId, day) {
      try {
        await sbAuthed.rpc('ai_chat_refund', { p_user_id: userId, p_day: day });
      } catch {
        // Best-effort: a missed refund over-counts by one — the safe
        // direction for enforcement.
      }
    },
  };
}

/**
 * Shared anonymous FALLBACK bucket: reached only by callers with no JWT
 * at all (Anuraj, Sept 20, 2026). App installs always carry an anonymous
 * identity and spend from their own per-identity rows instead — this
 * bucket exists because the endpoint URL is public, so unauthenticated
 * callers must stay capped. One row per day. Access goes ONLY through
 * the `ai_chat_*_anon` security definer RPCs granted to `anon` — the
 * `ai_chat_anon_quota` table has RLS enabled with no permissive
 * policies, so direct PostgREST reads/writes are denied. The cap
 * (CHAT_ANON_DAILY_LIMIT, default 30) stays modest: anyone with the URL
 * can burn this bucket, and the worst case is bounded to the cap in
 * Gemini calls per day. Rows carry day counters only — no IPs, no
 * identifiers.
 */
function anonQuotaStore(sbAnon: ReturnType<typeof createClient>): QuotaStore {
  return {
    async peekRemaining(_userId, day, dailyLimit) {
      try {
        const { data, error } = await sbAnon.rpc('ai_chat_anon_peek', { p_day: day });
        if (error || typeof data !== 'number') return error ? null : dailyLimit;
        return Math.max(0, dailyLimit - data);
      } catch {
        return null;
      }
    },
    async tryConsume(_userId, day, dailyLimit) {
      try {
        const { data, error } = await sbAnon.rpc('ai_chat_try_consume_anon', {
          p_day: day,
          p_limit: dailyLimit,
        });
        if (error || !data || typeof data !== 'object') return { ok: false, kind: 'unavailable' };
        const r = data as { ok?: unknown; reason?: unknown; remaining?: unknown };
        if (r.ok === true)
          return { ok: true, remaining: typeof r.remaining === 'number' ? r.remaining : 0 };
        if (r.reason === 'daily') return { ok: false, kind: 'daily' };
        if (r.reason === 'burst') return { ok: false, kind: 'rate' };
        return { ok: false, kind: 'unavailable' };
      } catch {
        return { ok: false, kind: 'unavailable' };
      }
    },
    async refund(_userId, day) {
      try {
        await sbAnon.rpc('ai_chat_refund_anon', { p_day: day });
      } catch {
        // Best-effort: a missed refund over-counts by one — the safe
        // direction for enforcement.
      }
    },
  };
}

/** Privacy-safe counters only: method, status, latency. No bodies,
 *  questions, answers, or user identifiers. */
function logCounters(method: string, status: number, ms: number): void {
  console.log(
    JSON.stringify({ fn: 'pregnancy-chat', method, status, latency_ms: ms }),
  );
}
