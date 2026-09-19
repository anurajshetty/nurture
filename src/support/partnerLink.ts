/**
 * Epic 9 — Epic 7 partner-model integration (contract C2).
 *
 * Reads Epic 7's partner model read-only: the owner sees the partner's
 * display name and chooses whether previously shared memories stay with
 * the partner. Partner state is NEVER changed here except through Epic 7's
 * own exported functions — "Remove access" calls Epic 7's revokePartner(),
 * whose semantics (already-synced partner data marked for removal on next
 * sync) are exactly "remove the partner's access to shared memories".
 *
 * Both functions take injectable fns so unit tests never need Epic 7's
 * module; every call is guarded so a missing/changed export degrades to a
 * plain "no partner" state instead of crashing.
 */

import { getPartnerLink } from '../partner/model';
import { revokePartner } from '../partner/revoke';

export type PartnerStatus = 'none' | 'invited' | 'active' | 'revoked';

export interface PartnerSnapshot {
  status: PartnerStatus;
  partnerName: string;
}

interface PartnerLinkLike {
  status: PartnerStatus;
  partnerName: string;
}

/** Read-only snapshot of the partner link (contract C2). Null = no usable link. */
export function readPartnerSnapshot(
  reader: () => PartnerLinkLike | null = getPartnerLink as () => PartnerLinkLike | null,
): PartnerSnapshot | null {
  try {
    const link = reader();
    if (!link || typeof link !== 'object') return null;
    const name = typeof link.partnerName === 'string' && link.partnerName ? link.partnerName : 'your partner';
    return { status: link.status ?? 'none', partnerName: name };
  } catch {
    return null;
  }
}

/** True when the partner-memory row should appear (there is someone to decide about). */
export function hasPartnerToDecideAbout(snapshot: PartnerSnapshot | null): boolean {
  return snapshot !== null && (snapshot.status === 'invited' || snapshot.status === 'active');
}

/**
 * "Remove {name}'s access" — through Epic 7's revokePartner() only.
 * Returns true when the revoke was actually invoked.
 */
export function removePartnerAccess(revoke: (() => unknown) | undefined = revokePartner): boolean {
  try {
    if (typeof revoke !== 'function') return false;
    revoke();
    return true;
  } catch {
    return false;
  }
}
