/**
 * Ask Willow client: transport to the `pregnancy-chat` edge function
 * (Anuraj, Sept 20, 2026).
 *
 * - Strict request schema (matches the server's validateChatRequest) and
 *   strict response validation — a malformed server reply is an
 *   invalid_response, never rendered.
 * - Quota numbers (remaining / dailyLimit) come ONLY from the server;
 *   the client never hardcodes the 10/day cap.
 * - No sign-in gate: every install holds an invisible anonymous Supabase
 *   identity (issued at boot, Anuraj Sept 20, 2026), and the server keys
 *   the quota per identity — 30/day per install, server-enforced.
 *   Callers with no identity at all fall back to the server's small
 *   shared anonymous bucket.
 * - Injectable seam mirrors src/reportSummary/client.ts: production
 *   goes through supabase functions.invoke (POST) + a plain GET for
 *   quota; the interactive suite sets `window.__askWillowTestTransport =
 *   { invoke, getQuota }` so the app still crosses a real fetch boundary
 *   stubbed at the network layer. Gated on `?testhooks=1`; inert in
 *   production.
 */

export const ASK_WILLOW_FUNCTION_NAME = 'pregnancy-chat';
export const ASK_WILLOW_TIMEOUT_MS = 30_000;

export type ChatResponseKind = 'answer' | 'refusal' | 'handoff' | 'crisis';

export interface ChatResponse {
  kind: ChatResponseKind;
  text: string;
  disclaimer: string;
  remaining: number;
  dailyLimit: number;
}

export interface ChatQuota {
  remaining: number;
  dailyLimit: number;
}

export interface ChatHistoryTurn {
  role: 'user' | 'willow';
  text: string;
}

export interface AskWillowContext {
  week: number | null;
  stage: string;
  dueDate: string | null;
  babyName: string | null;
  recentLogs: string[];
  reportSummaries: string[];
  history: ChatHistoryTurn[];
}

export type AskWillowErrorCode =
  | 'not_configured'
  | 'network'
  | 'invalid_response'
  | 'limit_reached'
  | 'rate_limited';

export class AskWillowError extends Error {
  readonly code: AskWillowErrorCode;
  /** The server's configured daily cap — only present on limit errors. */
  readonly dailyLimit?: number;
  constructor(code: AskWillowErrorCode, dailyLimit?: number) {
    super(`ask_willow_${code}`);
    this.code = code;
    this.dailyLimit = dailyLimit;
  }
}

export interface AskWillowDeps {
  configured?: boolean;
  invoke?: (body: unknown) => Promise<{ data: unknown; error: unknown }>;
  getQuota?: () => Promise<unknown>;
  timeoutMs?: number;
}

type InvokeFn = (body: unknown) => Promise<{ data: unknown; error: unknown }>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Test-only transport override, gated on the repo's `?testhooks=1` flag
 * (see src/testhooks.ts). The interactive suite sets
 * `window.__askWillowTestTransport = { invoke, getQuota }`.
 */
function readTestTransport():
  | { invoke?: InvokeFn; getQuota?: () => Promise<unknown> }
  | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as Record<string, unknown>;
  const search = (w.location as { search?: string } | undefined)?.search;
  if (typeof search !== 'string' || !search.includes('testhooks=1')) return undefined;
  const t = w.__askWillowTestTransport as
    | { invoke?: unknown; getQuota?: unknown }
    | undefined;
  if (!t) return undefined;
  return {
    invoke: typeof t.invoke === 'function' ? (t.invoke as InvokeFn) : undefined,
    getQuota:
      typeof t.getQuota === 'function' ? (t.getQuota as () => Promise<unknown>) : undefined,
  };
}

interface SupabaseShape {
  isConfigured: boolean;
  supabase: {
    supabaseUrl: string;
    supabaseKey: string;
    auth: { getSession: () => Promise<{ data: { session: { access_token: string } | null } }> };
    functions: {
      invoke: (name: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;
    };
  } | null;
}

function readSupabase(): SupabaseShape {
  return require('../lib/supabase') as SupabaseShape;
}

function resolveTransport(deps: AskWillowDeps): {
  configured: boolean;
  invoke: InvokeFn;
  getQuota: () => Promise<unknown>;
  timeoutMs: number;
} {
  const test = deps.invoke || deps.getQuota ? undefined : readTestTransport();
  const testInvoke = deps.invoke ?? test?.invoke;
  const testGetQuota = deps.getQuota ?? test?.getQuota;
  let configured = deps.configured;
  let invoke: InvokeFn | undefined = testInvoke;
  let getQuota: (() => Promise<unknown>) | undefined = testGetQuota;
  if (configured === undefined || invoke === undefined || getQuota === undefined) {
    const sb = readSupabase();
    if (configured === undefined) configured = testInvoke ? true : sb.isConfigured;
    if (invoke === undefined) {
      const client = sb.supabase;
      invoke = async (body) => {
        const { data, error } = await client!.functions.invoke(ASK_WILLOW_FUNCTION_NAME, {
          body,
        });
        return { data, error };
      };
    }
    if (getQuota === undefined) {
      getQuota = async () => {
        const client = sb.supabase!;
        const session = await client.auth.getSession();
        const token = session.data.session?.access_token;
        const res = await fetch(`${client.supabaseUrl}/functions/v1/${ASK_WILLOW_FUNCTION_NAME}`, {
          headers: {
            apikey: client.supabaseKey,
            Authorization: token ? `Bearer ${token}` : '',
          },
        });
        let data: unknown = null;
        try {
          data = await res.json();
        } catch {
          /* ignore */
        }
        if (!res.ok) {
          const err = new Error(`quota http ${res.status}`) as Error & {
            context?: { status: number };
          };
          err.context = { status: res.status };
          throw err;
        }
        return data;
      };
    }
  }
  return { configured: configured ?? false, invoke: invoke!, getQuota: getQuota!, timeoutMs: deps.timeoutMs ?? ASK_WILLOW_TIMEOUT_MS };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new AskWillowError('network')), ms);
    promise.then(
      (v) => {
        if (timer) clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (timer) clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function statusOf(error: unknown): number | undefined {
  return (error as { context?: { status?: number } } | null)?.context?.status;
}

function validateQuotaShape(data: unknown): ChatQuota {
  if (!isRecord(data)) throw new AskWillowError('invalid_response');
  const { remaining, dailyLimit } = data;
  if (
    typeof remaining !== 'number' ||
    !Number.isInteger(remaining) ||
    remaining < 0 ||
    typeof dailyLimit !== 'number' ||
    !Number.isInteger(dailyLimit) ||
    dailyLimit < 1 ||
    dailyLimit > 100
  ) {
    throw new AskWillowError('invalid_response');
  }
  return { remaining, dailyLimit };
}

function validateChatResponse(data: unknown): ChatResponse {
  if (!isRecord(data)) throw new AskWillowError('invalid_response');
  const { kind, text, disclaimer, remaining, dailyLimit } = data;
  if (kind !== 'answer' && kind !== 'refusal' && kind !== 'handoff' && kind !== 'crisis')
    throw new AskWillowError('invalid_response');
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 2000)
    throw new AskWillowError('invalid_response');
  if (typeof disclaimer !== 'string' || disclaimer.length === 0 || disclaimer.length > 200)
    throw new AskWillowError('invalid_response');
  const quota = validateQuotaShape({ remaining, dailyLimit });
  return { kind, text: text.trim(), disclaimer, ...quota };
}

function classifyInvokeFailure(error: unknown, data: unknown): AskWillowError {
  // Edge-function verdict bodies win over bare statuses.
  if (isRecord(data)) {
    if (data.error === 'limit_reached')
      return new AskWillowError(
        'limit_reached',
        typeof data.dailyLimit === 'number' ? data.dailyLimit : undefined,
      );
    if (data.error === 'rate_limited')
      return new AskWillowError(
        'rate_limited',
        typeof data.dailyLimit === 'number' ? data.dailyLimit : undefined,
      );
    if (data.error === 'not_configured') return new AskWillowError('not_configured');
    // Quota-store outage: fail closed on the server; the client just
    // reports a send failure — no backend detail leaks.
    if (data.error === 'quota_unavailable') return new AskWillowError('network');
  }
  const status = statusOf(error);
  if (status === 503) return new AskWillowError('not_configured');
  if (status === 429) return new AskWillowError('limit_reached');
  // Any other HTTP failure (including an unexpected 401) is a plain
  // send failure — there is no sign-in gate (Anuraj, Sept 20, 2026).
  return new AskWillowError('network');
}

/**
 * Ask one question of Willow. Sends `{ question, context }` — no photos,
 * no full history, no identifiers beyond the context the server needs.
 * Throws AskWillowError on any failure; never logs the question.
 */
export async function askWillow(
  question: string,
  context: AskWillowContext,
  deps: AskWillowDeps = {},
): Promise<ChatResponse> {
  const { configured, invoke, timeoutMs } = resolveTransport(deps);
  if (!configured) throw new AskWillowError('not_configured');
  let data: unknown;
  let error: unknown;
  try {
    const result = await withTimeout(invoke({ question, context }), timeoutMs);
    data = result.data;
    error = result.error;
  } catch (e) {
    if (e instanceof AskWillowError) throw e;
    throw new AskWillowError('network');
  }
  if (error) throw classifyInvokeFailure(error, data);
  return validateChatResponse(data);
}

/**
 * Read today's quota from the server. Throws AskWillowError on failure.
 */
export async function getChatQuota(deps: AskWillowDeps = {}): Promise<ChatQuota> {
  const { configured, getQuota, timeoutMs } = resolveTransport(deps);
  if (!configured) throw new AskWillowError('not_configured');
  try {
    const data = await withTimeout(getQuota(), timeoutMs);
    return validateQuotaShape(data);
  } catch (e) {
    if (e instanceof AskWillowError) throw e;
    const status = statusOf(e);
    if (status === 503) throw new AskWillowError('not_configured');
    // A failed quota load never gates the chat: the screen stays
    // usable and the send path shows a plain failure instead.
    throw new AskWillowError('network');
  }
}
