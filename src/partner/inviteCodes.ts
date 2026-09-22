/**
 * Partner invite codes — server-backed client (mockup 33, named-invite
 * model, Sept 2026).
 *
 * The server side lives repo-only in
 * supabase/migrations/20260921120000_partner_invites.sql (NOT applied to
 * production yet). This module wraps those SECURITY DEFINER functions:
 *
 *   create_partner_invite(p_name)  → mint a fresh named invite (max 5)
 *   redeem_partner_invite(p_code, p_name) → partner links by code+name
 *   revoke_partner(p_invite_id)    → owner severs one partner link
 *   my_partner_invites()           → owner's named invites (name + status)
 *   my_partner_link()              → owner id this device is linked to, or null
 *
 * Everything degrades gracefully when the migration hasn't been applied
 * (functions missing → 'not_ready') or the backend isn't configured —
 * surfaces show a clear message and never crash.
 *
 * Code contract (Anuraj, Sept 21 2026): 6 chars, uppercase, unambiguous
 * alphabet (no 0/O/1/I), single-use, no expiry — a code is either valid
 * or invalid, nothing in between. Every code is a NAMED invite: the name
 * is required at creation and binds at redemption (wrong name = invalid,
 * same as a wrong code). The partner is always gender-neutral in copy
 * ("your partner", never he/she).
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

/** Trimmed partner name, capped at 30 chars (list-row label). */
export function normalizeName(raw: string): string {
  return (raw ?? '').trim().slice(0, 30);
}

/** True when the name has at least one non-space character. */
export function isValidName(name: string): boolean {
  return normalizeName(name).length > 0;
}

/** Max partners per account: pending + accepted named invites. */
export const MAX_PARTNERS = 5;

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

/** One named invite on the owner's partners list. */
export interface PartnerInvite {
  /** Server invite id (for revoke). */
  id: string;
  /** The name she gave the invite ("who is this code for?"). */
  name: string;
  /** 'pending' until redeemed, 'accepted' after. */
  status: 'pending' | 'accepted';
  /**
   * The 6-char code while the invite is pending (the server returns it
   * from my_partner_invites so she can copy it again). Accepted rows
   * never carry a code (undefined).
   */
  code?: string;
  /**
   * Per-partner sharing switch. Defaults true for legacy rows; the
   * partners card flips it via set_partner_sharing.
   */
  sharingEnabled: boolean;
}

export interface CreateInviteResult {
  status: 'ok' | 'name_required' | 'max_partners' | 'not_configured' | 'not_ready' | 'network' | 'unknown';
  code?: string;
}

/**
 * Mint a fresh NAMED invite. The name is required — a code abandoned
 * before naming never exists server-side. 'max_partners' when the owner
 * already has 5 live named invites (pending + accepted). Never throws.
 */
export async function createNamedInvite(
  name: string,
  rpc: PartnerRpc | null = defaultRpc(),
): Promise<CreateInviteResult> {
  const clean = normalizeName(name);
  if (!isValidName(clean)) return { status: 'name_required' };
  if (!rpc) return { status: 'not_configured' };
  try {
    const { data, error } = await rpc.rpc('create_partner_invite', { p_name: clean });
    if (error) {
      if (/max_partners_reached/i.test(error.message)) return { status: 'max_partners' };
      if (/name_required/i.test(error.message)) return { status: 'name_required' };
      return { status: classifyRpcError(error) };
    }
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

export interface InvitesResult {
  status: ServerStatus;
  invites?: PartnerInvite[];
}

/**
 * The owner's partners list: named invites with per-invite status.
 * Pending invites show "Name · Invited"; accepted show name + remove.
 * Unnamed codes can't exist server-side, so the list is named-only.
 * Never throws.
 */
export async function getPartnerInvites(
  rpc: PartnerRpc | null = defaultRpc(),
): Promise<InvitesResult> {
  if (!rpc) return { status: 'not_configured' };
  try {
    const { data, error } = await rpc.rpc('my_partner_invites');
    if (error) return { status: classifyRpcError(error) };
    const rows = Array.isArray(data) ? data : [];
    const invites: PartnerInvite[] = [];
    for (const r of rows) {
      if (r === null || typeof r !== 'object') continue;
      const rec = r as {
        invite_id?: unknown;
        partner_name?: unknown;
        status?: unknown;
        code?: unknown;
        sharing_enabled?: unknown;
      };
      const id = String(rec.invite_id ?? '');
      const name = String(rec.partner_name ?? '');
      const status = rec.status === 'accepted' ? 'accepted' : 'pending';
      if (!id || !name) continue; // unnamed rows never belong in the list
      // The code is only ever exposed on pending rows (accepted codes are
      // spent and the server returns NULL for them).
      const rawCode = typeof rec.code === 'string' ? rec.code.trim().toUpperCase() : '';
      const code = status === 'pending' && isValidCodeFormat(rawCode) ? rawCode : undefined;
      const sharingEnabled =
        typeof rec.sharing_enabled === 'boolean' ? rec.sharing_enabled : true;
      invites.push({ id, name, status, code, sharingEnabled });
    }
    return { status: 'ok', invites };
  } catch (e) {
    return { status: classifyRpcError(e) };
  }
}

export interface RedeemResult {
  status: 'ok' | 'invalid_code' | 'not_configured' | 'not_ready' | 'network' | 'unknown';
}

/**
 * Partner redeems a named invite. The name binds to the code: a wrong
 * name is 'invalid_code', same as a wrong or already-used code
 * (single-use; valid-or-invalid only). Never throws.
 */
export async function redeemInvite(
  code: string,
  name: string,
  rpc: PartnerRpc | null = defaultRpc(),
): Promise<RedeemResult> {
  const normalized = normalizeCode(code);
  const clean = normalizeName(name);
  if (!rpc) return { status: 'not_configured' };
  if (!isValidCodeFormat(normalized) || !isValidName(clean))
    return { status: 'invalid_code' };
  try {
    const { error } = await rpc.rpc('redeem_partner_invite', {
      p_code: normalized,
      p_name: clean,
    });
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

/** Result of flipping one partner's sharing switch. */
export interface SetSharingResult {
  status: 'ok' | 'no_partner_link' | 'not_configured' | 'not_ready' | 'network' | 'unknown';
}

/**
 * Owner-only per-partner sharing switch (mockup 33 partners-card,
 * Anuraj approved Sept 21, 2026): "Sees your shared entries" /
 * "Paused — sees nothing for now". Turning sharing off keeps the
 * relationship but blocks every shared entry; turning it back on
 * restores access. The server raises no_partner_link when the invite
 * is gone (already removed).
 */
export async function setPartnerSharing(
  inviteId: string,
  enabled: boolean,
  rpc: PartnerRpc | null = defaultRpc(),
): Promise<SetSharingResult> {
  if (!rpc) return { status: 'not_ready' };
  try {
    const { error } = await rpc.rpc('set_partner_sharing', {
      p_invite_id: inviteId,
      p_enabled: enabled,
    });
    if (error) {
      if (/no_partner_link/i.test(error.message)) return { status: 'no_partner_link' };
      return { status: classifyRpcError(error) } as SetSharingResult;
    }
    return { status: 'ok' };
  } catch (e) {
    return { status: classifyRpcError(e) } as SetSharingResult;
  }
}

/** Owner severs one partner link (per invite). Never throws. */
export async function revokePartnerInvite(
  inviteId: string,
  rpc: PartnerRpc | null = defaultRpc(),
): Promise<RevokeResult> {
  if (!rpc) return { status: 'not_configured' };
  try {
    const { error } = await rpc.rpc('revoke_partner', { p_invite_id: inviteId });
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
