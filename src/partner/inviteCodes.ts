/**
 * Partner invite codes — server-backed client (mockup 33, Sept 2026).
 *
 * The server side lives repo-only in
 * supabase/migrations/20260921120000_partner_invites.sql (NOT applied to
 * production yet). This module wraps those SECURITY DEFINER functions:
 *
 *   create_partner_invite()  → her personal 6-char code (idempotent)
 *   redeem_partner_invite(p_code) → partner links by code (single-use)
 *   revoke_partner()         → owner severs the partner link
 *   my_partner_link()        → owner id this device is linked to, or null
 *
 * Everything degrades gracefully when the migration hasn't been applied
 * (functions missing → 'not_ready') or the backend isn't configured —
 * surfaces show a clear message and never crash.
 *
 * Code contract (Anuraj, Sept 21 2026): 6 chars, uppercase, unambiguous
 * alphabet (no 0/O/1/I), single-use, no expiry — a code is either valid
 * or invalid, nothing in between. The partner is always gender-neutral in
 * copy ("your partner", never he/she).
 */

declare const require: (id: string) => unknown;

/** Minimal kv surface so tests can inject a fake store. */
export interface InviteKv {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Minimal RPC surface (supabase-js shape). */
export interface PartnerRpc {
  rpc(
    fn: string,
    params?: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
  from?(table: string): {
    select(
      columns: string,
    ): PromiseLike<{
      data: unknown;
      error: { code?: string; message: string } | null;
    }>;
  };
}

export const ONBOARDING_ROLE_KEY = 'partner.onboarding_role';
export const PARTNER_LINKED_KEY = 'partner.linked';
/**
 * Set once the partner taps Done on the connected confirmation. The
 * connected screen is the partner's resting state until the partner view
 * ships — this flag records that the welcome flow finished, so the role
 * split never re-asks. Never gates the mom's flow.
 */
export const PARTNER_ONBOARDING_DONE_KEY = 'partner.onboarding_done';

export type OnboardingRole = 'mom' | 'partner';

export function getOnboardingRole(kv: InviteKv): OnboardingRole | null {
  try {
    const v = kv.get(ONBOARDING_ROLE_KEY);
    return v === 'mom' || v === 'partner' ? v : null;
  } catch {
    return null;
  }
}

export function setOnboardingRole(kv: InviteKv, role: OnboardingRole): void {
  try {
    kv.set(ONBOARDING_ROLE_KEY, role);
  } catch {
    // Best-effort — the flow works without persistence.
  }
}

/** True once this device successfully redeemed a partner code. */
export function isPartnerLinked(kv: InviteKv): boolean {
  try {
    return kv.get(PARTNER_LINKED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPartnerLinked(kv: InviteKv): void {
  try {
    kv.set(PARTNER_LINKED_KEY, '1');
  } catch {
    // Best-effort.
  }
}

/** True once the partner tapped Done on the connected confirmation. */
export function isPartnerOnboardingDone(kv: InviteKv): boolean {
  try {
    return kv.get(PARTNER_ONBOARDING_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPartnerOnboardingDone(kv: InviteKv): void {
  try {
    kv.set(PARTNER_ONBOARDING_DONE_KEY, '1');
  } catch {
    // Best-effort — the confirmation shows regardless.
  }
}

/** Forget the chosen role (backing out of the partner code entry). */
export function clearOnboardingRole(kv: InviteKv): void {
  try {
    kv.set(ONBOARDING_ROLE_KEY, '');
  } catch {
    // Best-effort.
  }
}

/** The code alphabet: uppercase, unambiguous (no 0/O/1/I). */
export const CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Trimmed, uppercased, stripped of anything outside A–Z0–9, max 6 chars. */
export function normalizeCode(raw: string): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

/** True for exactly 6 chars from the unambiguous alphabet. */
export function isValidCodeFormat(code: string): boolean {
  return (
    code.length === CODE_LENGTH &&
    [...code].every((ch) => CODE_ALPHABET.includes(ch))
  );
}

export type ServerStatus = 'ok' | 'not_configured' | 'not_ready' | 'network' | 'unknown';

/**
 * Classifies a failed RPC into a UI-displayable status.
 *  - 'not_ready': the partner functions don't exist yet (migration not applied)
 *  - 'network': the request never reached the server
 *  - 'unknown': anything else server-side
 */
export function classifyRpcError(err: unknown): Exclude<ServerStatus, 'ok' | 'not_configured'> {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message ?? '')
      : String(err ?? '');
  if (code === '42883' || /does not exist|could not find the function/i.test(message))
    return 'not_ready';
  if (/failed to fetch|network request failed|networkerror|load failed/i.test(message))
    return 'network';
  return 'unknown';
}

let cachedClient: PartnerRpc | null | undefined;

function defaultRpc(): PartnerRpc | null {
  if (cachedClient !== undefined) return cachedClient;
  try {
    const mod = require('../lib/supabase') as { supabase?: PartnerRpc | null };
    cachedClient = mod.supabase ?? null;
  } catch {
    cachedClient = null;
  }
  return cachedClient;
}

export interface InviteCodeResult {
  status: ServerStatus;
  code?: string;
}

/**
 * Her personal invite code (idempotent — returns the existing active code
 * when one is already out). 'not_ready' when the migration isn't applied;
 * 'not_configured' when the backend isn't wired up. Never throws.
 */
export async function getMyInviteCode(
  rpc: PartnerRpc | null = defaultRpc(),
): Promise<InviteCodeResult> {
  if (!rpc) return { status: 'not_configured' };
  try {
    const { data, error } = await rpc.rpc('create_partner_invite');
    if (error) return { status: classifyRpcError(error) };
    const row = Array.isArray(data) ? data[0] : data;
    const code =
      row && typeof row === 'object' && 'code' in row
        ? String((row as { code?: unknown }).code ?? '')
        : '';
    if (!isValidCodeFormat(code)) return { status: 'unknown' };
    return { status: 'ok', code };
  } catch (e) {
    return { status: classifyRpcError(e) };
  }
}

export interface RedeemResult {
  status: 'ok' | 'invalid_code' | 'not_configured' | 'not_ready' | 'network' | 'unknown';
}

/**
 * Partner redeems a code. Unknown codes and already-used codes both come
 * back as 'invalid_code' (single-use; valid-or-invalid only). Never throws.
 */
export async function redeemInviteCode(
  code: string,
  rpc: PartnerRpc | null = defaultRpc(),
): Promise<RedeemResult> {
  const normalized = normalizeCode(code);
  if (!rpc) return { status: 'not_configured' };
  if (!isValidCodeFormat(normalized)) return { status: 'invalid_code' };
  try {
    const { error } = await rpc.rpc('redeem_partner_invite', { p_code: normalized });
    if (error) {
      if (/invalid_code/i.test(error.message)) return { status: 'invalid_code' };
      return { status: classifyRpcError(error) };
    }
    return { status: 'ok' };
  } catch (e) {
    return { status: classifyRpcError(e) };
  }
}

export interface RevokeResult {
  status: 'ok' | 'no_partner_link' | 'not_configured' | 'not_ready' | 'network' | 'unknown';
}

/** Owner severs the partner link. Never throws. */
export async function revokePartnerLink(
  rpc: PartnerRpc | null = defaultRpc(),
): Promise<RevokeResult> {
  if (!rpc) return { status: 'not_configured' };
  try {
    const { error } = await rpc.rpc('revoke_partner');
    if (error) {
      if (/no_partner_link/i.test(error.message)) return { status: 'no_partner_link' };
      return { status: classifyRpcError(error) };
    }
    return { status: 'ok' };
  } catch (e) {
    return { status: classifyRpcError(e) };
  }
}

export interface PartnerLinkResult {
  status: ServerStatus;
  /** The owner id this device is linked to, or null when not linked. */
  ownerId?: string | null;
}

/** Which owner this device is linked to as a partner (null when none). Never throws. */
export async function getLinkedOwnerId(
  rpc: PartnerRpc | null = defaultRpc(),
): Promise<PartnerLinkResult> {
  if (!rpc) return { status: 'not_configured' };
  try {
    const { data, error } = await rpc.rpc('my_partner_link');
    if (error) return { status: classifyRpcError(error) };
    const ownerId = typeof data === 'string' && data ? data : null;
    return { status: 'ok', ownerId };
  } catch (e) {
    return { status: classifyRpcError(e) };
  }
}

export interface OwnerLinkResult {
  status: ServerStatus;
  /** True when a partner has redeemed one of this owner's codes and hasn't been revoked. */
  connected?: boolean;
}

/**
 * Owner-side: is a partner currently linked to this account? Reads the
 * owner's own partner_invites rows (RLS: owners read their own only) and
 * looks for a redeemed, unrevoked invite. Never throws.
 */
export async function getOwnerLinkStatus(
  rpc: PartnerRpc | null = defaultRpc(),
): Promise<OwnerLinkResult> {
  if (!rpc || !rpc.from) return { status: 'not_configured' };
  try {
    const { data, error } = await rpc.from('partner_invites').select('redeemed_by, revoked_at');
    if (error) return { status: classifyRpcError(error) };
    const rows = Array.isArray(data) ? data : [];
    const connected = rows.some(
      (r) =>
        r !== null &&
        typeof r === 'object' &&
        (r as { redeemed_by?: unknown }).redeemed_by != null &&
        (r as { revoked_at?: unknown }).revoked_at == null,
    );
    return { status: 'ok', connected };
  } catch (e) {
    return { status: classifyRpcError(e) };
  }
}
