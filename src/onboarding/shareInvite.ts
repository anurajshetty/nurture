/**
 * Partner-invite sharing from onboarding Screen 2 (Epic 7 wiring).
 *
 * The invite itself is created through the existing Epic 7 system
 * (`createInvite()` in src/partner/invite.ts) — this module only owns the
 * handoff: figuring out what the typed contact is, and composing the warm
 * message + the mailto:/sms: targets. Everything here is pure (no React
 * Native imports) so it unit-tests under node; the screen performs the
 * actual Share/Linking calls.
 *
 * No new backend sending service: the share sheet (or the pre-filled mail
 * / SMS compose) is the entire sending mechanism.
 */

export type ContactKind = 'email' | 'phone';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 'email' | 'phone' | null for the raw field value. Simple heuristic:
 * anything with an @ must be a valid-looking email, otherwise enough
 * digits means a phone number. Empty or unrecognizable reads as null.
 */
export function detectContactKind(raw: string): ContactKind | null {
  const v = raw.trim();
  if (v.length === 0) return null;
  if (v.includes('@')) return EMAIL_RE.test(v) ? 'email' : null;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 7 ? 'phone' : null;
}

/** First name, trimmed — or null when she didn't give one. */
function cleanName(ownerName: string | null | undefined): string | null {
  const t = typeof ownerName === 'string' ? ownerName.trim() : '';
  return t.length > 0 ? t : null;
}

/**
 * The warm pre-written invite message handed to the share sheet / mail /
 * SMS compose, with the invite link attached. Human voice throughout.
 */
export function buildInviteMessage(ownerName: string | null | undefined, inviteUrl: string): string {
  const who = cleanName(ownerName);
  const lead = who
    ? `${who} is keeping a little pregnancy journal in Willow and would love to share the journey with you.`
    : 'You are invited to share a pregnancy journey on Willow.';
  return `${lead} Here is the invite: ${inviteUrl}`;
}

/** Subject line for the pre-filled email compose. */
export function buildInviteSubject(ownerName: string | null | undefined): string {
  const who = cleanName(ownerName);
  return who
    ? `${who} invited you to share her pregnancy journey`
    : 'An invitation to share a pregnancy journey';
}

/** Pre-filled mail compose target carrying the warm message + link. */
export function buildMailtoUrl(email: string, subject: string, body: string): string {
  return (
    `mailto:${email.trim()}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}

/**
 * Pre-filled SMS compose target carrying the warm message + link.
 * iOS wants `&body=` after the number; Android wants `?body=`.
 */
export function buildSmsUrl(phone: string, body: string, platform: string): string {
  const sep = platform === 'ios' ? '&' : '?';
  return `sms:${phone.trim()}${sep}body=${encodeURIComponent(body)}`;
}

/**
 * Records the share target Screen 2 chose on the interactive test harness
 * (kind: 'share-sheet' | 'mailto' | 'sms' | 'web-link'). No-op in
 * production — the hook only exists when `?testhooks=1` installed it.
 */
export function noteInviteShareTarget(kind: string, target: string): void {
  try {
    const harness = (
      globalThis as {
        __nurtureTest?: { noteInviteShare?: (kind: string, target: string) => void };
      }
    ).__nurtureTest;
    harness?.noteInviteShare?.(kind, target);
  } catch {
    // Never let test instrumentation break the real flow.
  }
}
