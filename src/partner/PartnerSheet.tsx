/**
 * Partner sharing sheet (Epic 7) — the real partner section, built from
 * the approved design/07-partner.html (v2).
 *
 * States walk the mockup's steps:
 *  none     → "Share the journey, your way" + Invite your partner
 *  invited  → the 24-hour single-use link (Copy / Send via share sheet /
 *             Cancel), the expiry countdown, then the owner-confirmation
 *             gate ("They've joined — confirm access" → "Confirm & start
 *             sharing"). Nothing is visible to the partner until the owner
 *             confirms — no auto-link by email alone.
 *  active   → partner profile, Your view / Partner's view preview toggle,
 *             the on-screen limitations, real access history, the honest
 *             downloaded-content warning, and one-tap revoke.
 *  revoked  → quiet note + invite again.
 *
 * Stop flag (contract C3): when tracking is stopped, inviting and
 * confirming are disabled and a quiet note says sharing is paused.
 *
 * Rendered inside a BottomSheet by the You tab; calls `onChanged` after
 * every state transition so the settings row subtitle stays current.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Button, Segmented } from '../components';
import { colors, radii, spacing, type as typeScale } from '../theme/tokens';
import {
  PARTNER_PLACEHOLDER_NAME,
  canPartnerSeeEvent,
  getPartnerLink,
  listPartnerHistory,
  partnerSyncAllowed,
  relativeTime,
  PARTNER_LIMITATIONS_COPY,
  PARTNER_ALLOWED_REACTIONS,
  type PartnerHistoryKind,
  type PartnerLink,
} from './model';
import {
  cancelInvite,
  claimInvite,
  confirmPartner,
  createInvite,
  getPendingInvite,
  InviteError,
  isInviteUsable,
  type PartnerInvite,
} from './invite';
import { REVOKE_WARNING_COPY, revokeConfirmCopy, revokePartner } from './revoke';
import type { LocalEvent, Visibility } from '../lib/types';

declare const require: (id: string) => unknown;

type Preview = 'owner' | 'partner';

const HISTORY_ICONS: Record<PartnerHistoryKind, string> = {
  invite_sent: '✉️',
  invite_cancelled: '🚫',
  partner_confirmed: '💞',
  revoked: '🔒',
  view: '👁',
  reaction: '💌',
  contribution: '📷',
};

const VISIBILITY_BADGE: Record<Visibility, string> = {
  private: '🔒 Only you',
  shared: '👥 Shared',
  export: '📄 +Export',
};

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCountdown(expiresAt: string, now: Date): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 1) return `expires in ${minutes}m`;
  return `expires in ${hours}h ${minutes}m`;
}

/** First line of an event for the preview lists. */
function eventSnippet(event: LocalEvent): string {
  const data = event.data ?? {};
  const text = data.text ?? data.title ?? data.note;
  if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 120);
  if (Array.isArray(data.symptoms)) return data.symptoms.join(' · ').slice(0, 120);
  return event.type.replace(/_/g, ' ');
}

function typeLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Up to N most recent events, newest first. Never throws. */
function recentEvents(limit: number): LocalEvent[] {
  try {
    const store = require('../sync/store') as {
      listEvents(limit: number): LocalEvent[];
    };
    return store.listEvents(limit);
  } catch {
    return [];
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } })
      .navigator;
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the manual-copy hint.
  }
  return false;
}

export default function PartnerSheet({ onChanged }: { onChanged: () => void }) {
  const [link, setLink] = useState<PartnerLink>(() => getPartnerLink());
  const [invite, setInvite] = useState<PartnerInvite | null>(() => getPendingInvite());
  const [preview, setPreview] = useState<Preview>('owner');
  const [confirmingJoin, setConfirmingJoin] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [syncAllowed, setSyncAllowed] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSyncAllowed(partnerSyncAllowed());
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const refresh = useCallback(() => {
    setLink(getPartnerLink());
    setInvite(getPendingInvite());
    setSyncAllowed(partnerSyncAllowed());
    onChanged();
  }, [onChanged]);

  const handleInvite = useCallback(() => {
    try {
      const created = createInvite();
      setInvite(created);
      setLink(getPartnerLink());
      onChanged();
    } catch (e) {
      showToast(e instanceof InviteError ? e.message : 'That didn\u2019t go through — nothing changed.');
    }
  }, [onChanged, showToast]);

  const handleCopy = useCallback(async () => {
    if (!invite) return;
    const ok = await copyText(invite.url);
    showToast(ok ? 'Link copied' : 'Long-press the link to copy it');
  }, [invite, showToast]);

  const handleSend = useCallback(async () => {
    if (!invite || sharing) return;
    setSharing(true);
    try {
      const result = await Share.share({
        message: `Join me on Willow: ${invite.url}`,
      });
      if (result.action === Share.sharedAction) showToast('Invite sent');
    } catch {
      const ok = await copyText(invite.url);
      showToast(ok ? 'Sharing isn\u2019t available here — link copied instead' : 'Sharing isn\u2019t available here');
    } finally {
      setSharing(false);
    }
  }, [invite, sharing, showToast]);

  const handleCancelInvite = useCallback(() => {
    cancelInvite();
    setConfirmingJoin(false);
    refresh();
    showToast('Invite cancelled — nothing was shared.');
  }, [refresh, showToast]);

  /** Owner confirms the partner account: the gate before anything is visible. */
  const handleConfirmJoin = useCallback(() => {
    try {
      // In v1 the partner app reports acceptance by claiming the link;
      // claiming here models that handshake before confirmation.
      const pending = getPendingInvite();
      if (pending && isInviteUsable(pending)) claimInvite(pending);
      confirmPartner();
      setConfirmingJoin(false);
      refresh();
      showToast('Sharing with Alex is on');
    } catch (e) {
      showToast(e instanceof InviteError ? e.message : 'That didn\u2019t go through — nothing changed.');
    }
  }, [refresh, showToast]);

  const handleRevoke = useCallback(() => {
    revokePartner();
    setConfirmingRevoke(false);
    setPreview('owner');
    refresh();
    showToast('Access revoked');
  }, [refresh, showToast]);

  const events = recentEvents(8);
  const sharedEvents = events.filter((e) => canPartnerSeeEvent(e.visibility, link));

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title} accessibilityRole="header">
        Partner
      </Text>

      {!syncAllowed ? (
        <View style={styles.stoppedNote} testID="partner-stopped-note">
          <Text style={styles.stoppedText}>
            Partner sharing is paused — tracking has stopped. Your story stays exactly as it is.
          </Text>
        </View>
      ) : null}

      {link.status === 'none' || link.status === 'revoked' ? (
        <InviteIntro
          revoked={link.status === 'revoked'}
          disabled={!syncAllowed}
          onInvite={handleInvite}
          testIDPrefix="partner"
        />
      ) : null}

      {link.status === 'invited' && !confirmingJoin ? (
        <PendingInviteCard
          invite={invite}
          syncAllowed={syncAllowed}
          onCopy={handleCopy}
          onSend={handleSend}
          sharing={sharing}
          onConfirmJoin={() => setConfirmingJoin(true)}
          onCancel={handleCancelInvite}
        />
      ) : null}

      {link.status === 'invited' && confirmingJoin ? (
        <ConfirmJoinCard
          partnerName={link.partnerName}
          onConfirm={handleConfirmJoin}
          onBack={() => setConfirmingJoin(false)}
        />
      ) : null}

      {link.status === 'active' && !confirmingRevoke ? (
        <ConnectedSection
          link={link}
          preview={preview}
          onPreviewChange={setPreview}
          events={events}
          sharedEvents={sharedEvents}
          onRevoke={() => setConfirmingRevoke(true)}
        />
      ) : null}

      {link.status === 'active' && confirmingRevoke ? (
        <RevokeConfirmCard
          partnerName={link.partnerName}
          onRevoke={handleRevoke}
          onKeep={() => setConfirmingRevoke(false)}
        />
      ) : null}

      {toast ? (
        <View style={styles.toast} testID="partner-toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */

function InviteIntro({
  revoked,
  disabled,
  onInvite,
  testIDPrefix,
}: {
  revoked: boolean;
  disabled: boolean;
  onInvite: () => void;
  testIDPrefix: string;
}) {
  return (
    <View>
      {revoked ? (
        <View style={styles.revokedNote}>
          <Text style={styles.revokedText}>Access revoked — nothing is shared right now.</Text>
        </View>
      ) : null}
      <View style={styles.centerCard}>
        <View style={styles.avatar} accessibilityElementsHidden>
          <Text style={styles.avatarHeart}>♡</Text>
        </View>
        <Text style={styles.cardTitle}>Share the journey, your way</Text>
        <Text style={styles.cardCopy}>
          Invite your partner to see the moments you choose to share — and add a few of their
          own. Health logs always stay private unless you say otherwise.
        </Text>
        <Button
          title="Invite your partner"
          onPress={onInvite}
          disabled={disabled}
          testID={`${testIDPrefix}-invite-button`}
          style={styles.fullButton}
        />
      </View>
      <Text style={styles.kicker}>How it works</Text>
      <View style={styles.card}>
        <Text style={styles.cardCopy}>
          ① One invite link, usable once, expires in 24 hours.{'\n'}
          ② You confirm their account before anything is shared.{'\n'}
          ③ Every entry is private until you mark it shared.{'\n'}
          ④ You can take it all back in one tap, anytime.
        </Text>
      </View>
    </View>
  );
}

function PendingInviteCard({
  invite,
  syncAllowed,
  onCopy,
  onSend,
  sharing,
  onConfirmJoin,
  onCancel,
}: {
  invite: PartnerInvite | null;
  syncAllowed: boolean;
  onCopy: () => void;
  onSend: () => void;
  sharing: boolean;
  onConfirmJoin: () => void;
  onCancel: () => void;
}) {
  const usable = invite !== null && isInviteUsable(invite);
  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your invite</Text>
        <Text style={styles.cardCopy}>
          One link, one use, 24 hours. Send it to your partner however you like. Nothing is
          shared until you confirm their account.
        </Text>
        {invite ? (
          <View style={styles.linkBox} testID="partner-link-box">
            <Text style={styles.linkText} selectable numberOfLines={1}>
              {invite.url.replace(/^https:\/\//, '')}
            </Text>
            <Pressable
              onPress={onCopy}
              accessibilityRole="button"
              accessibilityLabel="Copy invite link"
              testID="partner-copy-button"
              style={({ pressed }) => [styles.miniButton, pressed && styles.pressed]}
            >
              <Text style={styles.miniButtonText}>Copy</Text>
            </Pressable>
          </View>
        ) : null}
        <Text style={styles.expiry} testID="partner-invite-expiry">
          {invite
            ? usable
              ? `Waiting for your partner · ${formatCountdown(invite.expiresAt, new Date())}`
              : 'This invite has expired — cancel it and send a fresh one.'
            : 'Preparing your invite…'}
        </Text>
        <Button
          title={sharing ? 'Opening…' : 'Send invite…'}
          onPress={onSend}
          disabled={!usable || sharing}
          testID="partner-send-button"
          style={styles.fullButton}
        />
        {usable ? (
          <Button
            title="They've joined — confirm access"
            variant="ghost"
            onPress={onConfirmJoin}
            disabled={!syncAllowed}
            testID="partner-confirm-join-button"
            style={styles.fullButton}
          />
        ) : null}
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel invite"
          testID="partner-cancel-invite"
          style={({ pressed }) => [styles.quietButton, pressed && styles.pressed]}
        >
          <Text style={styles.quietButtonText}>Cancel invite</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ConfirmJoinCard({
  partnerName,
  onConfirm,
  onBack,
}: {
  partnerName: string;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <View style={[styles.card, styles.centerCard]}>
      <View style={styles.avatar} accessibilityElementsHidden>
        <Text style={styles.avatarInitial}>{partnerName.charAt(0)}</Text>
      </View>
      <Text style={styles.cardTitle}>{partnerName} accepted your invite</Text>
      <Text style={styles.cardCopy}>
        Confirm to begin sharing. Only entries you mark <Text style={styles.bold}>shared</Text>{' '}
        will ever be visible — everything else stays only yours.
      </Text>
      <Button
        title="Confirm & start sharing"
        onPress={onConfirm}
        testID="partner-confirm-start-button"
        style={styles.fullButton}
      />
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Not now"
        testID="partner-confirm-not-now"
        style={({ pressed }) => [styles.quietButton, pressed && styles.pressed]}
      >
        <Text style={styles.quietButtonText}>Not now</Text>
      </Pressable>
    </View>
  );
}

function ConnectedSection({
  link,
  preview,
  onPreviewChange,
  events,
  sharedEvents,
  onRevoke,
}: {
  link: PartnerLink;
  preview: Preview;
  onPreviewChange: (p: Preview) => void;
  events: LocalEvent[];
  sharedEvents: LocalEvent[];
  onRevoke: () => void;
}) {
  const history = listPartnerHistory();
  return (
    <View>
      <View style={styles.card}>
        <View style={styles.profileRow}>
          <View style={styles.avatar} accessibilityElementsHidden>
            <Text style={styles.avatarInitial}>{link.partnerName.charAt(0)}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName}>{link.partnerName}</Text>
            <Text style={styles.profileSub}>Connected · can see shared moments</Text>
          </View>
        </View>
        <Segmented
          options={['owner', 'partner'] as const}
          value={preview}
          onChange={onPreviewChange}
          labels={{ owner: 'Your view', partner: 'Partner\u2019s view' }}
          accessibilityLabel="Preview sharing"
          testID="partner-preview-toggle"
          style={styles.previewToggle}
        />
        <Text style={styles.cardCopy} testID="partner-preview-note">
          {preview === 'partner'
            ? `This is exactly what ${link.partnerName} sees — shared moments only.`
            : 'This is what you see — every entry, with its sharing state.'}
        </Text>
        <Text style={styles.limitations} testID="partner-limitations">
          {PARTNER_LIMITATIONS_COPY}
        </Text>
      </View>

      {preview === 'owner' ? (
        <View>
          <Text style={styles.kicker}>Your moments</Text>
          {events.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardCopy}>
                Nothing saved yet — your moments will appear here with their sharing state.
              </Text>
            </View>
          ) : (
            events.slice(0, 5).map((e) => (
              <View key={e.id} style={styles.card} testID={`partner-owner-entry-${e.id}`}>
                <View style={styles.entryMeta}>
                  <Text style={styles.entryType}>{typeLabel(e.type)}</Text>
                  <Text style={styles.entryDate}>{formatDay(e.occurredAt)}</Text>
                  <Text style={styles.entryBadge}>{VISIBILITY_BADGE[e.visibility]}</Text>
                </View>
                <Text style={styles.entrySnippet} numberOfLines={2}>
                  {eventSnippet(e)}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : (
        <View>
          <Text style={styles.kicker}>What {link.partnerName} sees</Text>
          {sharedEvents.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardCopy}>
                Nothing shared yet — mark a moment Shared and it will appear here. Private
                moments, symptoms, and health logs are simply absent.
              </Text>
            </View>
          ) : (
            sharedEvents.slice(0, 5).map((e) => (
              <View key={e.id} style={styles.card} testID={`partner-shared-entry-${e.id}`}>
                <View style={styles.entryMeta}>
                  <Text style={styles.entryType}>{typeLabel(e.type)}</Text>
                  <Text style={styles.entryDate}>{formatDay(e.occurredAt)}</Text>
                </View>
                <Text style={styles.entrySnippet} numberOfLines={2}>
                  {eventSnippet(e)}
                </Text>
              </View>
            ))
          )}
          <View style={styles.card}>
            <Text style={styles.cardCopy}>
              {link.partnerName} can add notes and photos, and send one{' '}
              {PARTNER_ALLOWED_REACTIONS[0]} reaction on a shared moment — no comment feed, no
              threads.
            </Text>
          </View>
        </View>
      )}

      <Text style={styles.kicker}>Access history</Text>
      <View style={styles.card} testID="partner-access-history">
        {history.length === 0 ? (
          <Text style={styles.cardCopy}>Nothing here yet — views and activity will appear with time.</Text>
        ) : (
          history.slice(0, 8).map((h) => (
            <View key={h.id} style={styles.historyRow}>
              <View style={styles.historyIcon} accessibilityElementsHidden>
                <Text>{HISTORY_ICONS[h.kind] ?? '·'}</Text>
              </View>
              <View style={styles.historyText}>
                <Text style={styles.historyTitle}>{h.title}</Text>
                <Text style={styles.historyTime}>{relativeTime(h.at)}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.warnBox} testID="partner-revoke-warning">
        <Text style={styles.warnText}>{REVOKE_WARNING_COPY}</Text>
      </View>
      <Button
        title="Revoke access"
        variant="ghost"
        onPress={onRevoke}
        testID="partner-revoke-button"
        style={styles.fullButton}
      />
    </View>
  );
}

function RevokeConfirmCard({
  partnerName,
  onRevoke,
  onKeep,
}: {
  partnerName: string;
  onRevoke: () => void;
  onKeep: () => void;
}) {
  return (
    <View style={styles.card} testID="partner-revoke-confirm-card">
      <Text style={styles.cardTitle}>Revoke {partnerName}&#39;s access?</Text>
      <Text style={styles.cardCopy}>{revokeConfirmCopy(partnerName)}</Text>
      <View style={styles.warnBox}>
        <Text style={styles.warnText}>{REVOKE_WARNING_COPY}</Text>
      </View>
      <Button
        title="Yes, revoke access"
        onPress={onRevoke}
        testID="partner-revoke-confirm"
        style={styles.fullButton}
      />
      <Button
        title="Keep sharing"
        variant="ghost"
        onPress={onKeep}
        testID="partner-revoke-cancel"
        style={styles.fullButton}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xl,
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...{ shadowColor: '#2F2B27', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  },
  centerCard: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  cardTitle: {
    fontFamily: 'Georgia',
    fontSize: 19,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  cardCopy: {
    ...typeScale.subhead,
    color: colors.muted,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  bold: {
    fontWeight: '700',
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.blueTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarHeart: {
    fontSize: 28,
    color: colors.blue,
  },
  avatarInitial: {
    fontFamily: 'Georgia',
    fontSize: 26,
    color: colors.blue,
  },
  fullButton: {
    width: '100%',
    marginTop: spacing.sm,
  },
  stoppedNote: {
    backgroundColor: colors.blush,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  stoppedText: {
    ...typeScale.subhead,
    color: colors.coralDeep,
    lineHeight: 21,
    textAlign: 'center',
  },
  revokedNote: {
    backgroundColor: colors.sageTint,
    borderRadius: radii.card,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  revokedText: {
    ...typeScale.subhead,
    color: colors.sageDeep,
    textAlign: 'center',
  },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: 14,
    padding: spacing.sm,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  linkText: {
    flex: 1,
    ...typeScale.subhead,
    color: colors.muted,
    fontWeight: '600',
  },
  miniButton: {
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniButtonText: {
    ...typeScale.subhead,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  pressed: {
    opacity: 0.6,
  },
  expiry: {
    ...typeScale.footnote,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  quietButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  quietButtonText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.muted,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  profileText: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
  },
  profileSub: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: 2,
  },
  previewToggle: {
    marginTop: spacing.md,
  },
  limitations: {
    ...typeScale.footnote,
    color: colors.muted,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  entryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    flexWrap: 'wrap',
  },
  entryType: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.coralDeep,
  },
  entryDate: {
    ...typeScale.footnote,
    color: colors.muted,
  },
  entryBadge: {
    ...typeScale.footnote,
    color: colors.muted,
    fontWeight: '600',
    marginLeft: 'auto',
  },
  entrySnippet: {
    ...typeScale.subhead,
    color: colors.ink,
    lineHeight: 21,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  historyIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyText: {
    flex: 1,
  },
  historyTitle: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 20,
  },
  historyTime: {
    ...typeScale.footnote,
    color: colors.muted,
    marginTop: 2,
  },
  warnBox: {
    backgroundColor: '#FAF3DF',
    borderWidth: 1,
    borderColor: '#EBD9A8',
    borderRadius: radii.card,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  warnText: {
    ...typeScale.footnote,
    color: '#7A5E16',
    lineHeight: 19,
  },
  toast: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
