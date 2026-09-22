/**
 * Partner sharing — her partners list (mockup 33 partners-card, Anuraj
 * approved Sept 21, 2026; one-popup add flow per his five points, same day).
 *
 * Named invites, up to 5 (pending + accepted). "Add a partner" opens ONE
 * popup (the shared BottomSheet): a name field ("Who is this code for?") +
 * "Create code" (quiet until a name is typed); creating swaps the popup to
 * show JUST the 6-char code with Copy — nothing else. The popup dismisses
 * via its ×, tap-outside, or pull-down; the new partner is then in the list
 * as "Name · Invited", with "Add a partner" below the list.
 *
 * Row rules (unchanged): pending rows show name + "· Invited" + ×, the
 * 6-char code + Copy ("Invite code — works once. Share it with them.");
 * accepted rows show name + per-partner sharing switch + × (code hidden).
 * Every × opens the confirmation dialog first. At 5/5 the add option gives
 * way to a warm note. Used from the You tab and from onboarding step 2
 * (which shows the same card and has no Continue — adding is inline).
 *
 * When the backend migration isn't applied yet, the surface says so
 * plainly and never crashes.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BottomSheet, Button } from '../components';
import SharedSwitch from '../components/SharedSwitch';
import { colors, minTouch, radii, shadow, spacing, type as typeScale } from '../theme/tokens';
import RemoveConfirmDialog from './RemoveConfirmDialog';
import {
  MAX_PARTNERS,
  createNamedInvite,
  getPartnerInvites,
  isValidName,
  revokePartnerInvite,
  setPartnerSharing,
  type PartnerInvite,
  type ServerStatus,
} from './inviteCodes';

declare const require: (id: string) => unknown;

const NOT_READY_COPY =
  'Partner sharing is getting ready — your partners will appear here once the backend is live.';
const MAX_COPY = "You've added 5 partners — the most Willow allows right now.";
/** Pending-row explainer under the code (mockup 33 partners-card, verbatim). */
const PENDING_CODE_NOTE = 'Invite code — works once. Share it with them.';

/**
 * The partners sheet caps at 86% of the window (BottomSheet). Five tall
 * rows (code + Copy + remove) exceed that — without a bounded scroller
 * the Add button and the max note would be unreachable. The ScrollView
 * sizes to content when short and scrolls when tall; keyboard taps still
 * land on buttons while the name field is focused.
 */
const SHEET_SCROLL_MAX = Math.max(
  320,
  Math.round(Dimensions.get('window').height * 0.86) - 120,
);

/** Best-effort clipboard copy: web API, then optional expo-clipboard, else false. Never throws. */
async function copyCode(text: string): Promise<boolean> {
  try {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } })
      .navigator;
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through.
  }
  try {
    const Clipboard = require('expo-clipboard') as {
      setStringAsync?: (t: string) => Promise<void>;
    };
    if (Clipboard?.setStringAsync) {
      await Clipboard.setStringAsync(text);
      return true;
    }
  } catch {
    // expo-clipboard isn't in this build — tell her to copy manually.
  }
  return false;
}

/**
 * The add-partner popup: name step first ("Who is this code for?" +
 * "Create code"), then — after creating — just the 6-char code with Copy.
 * A separate component so each phase is directly testable; the × (plus the
 * sheet's tap-outside / pull-down) dismisses from either phase.
 */
export function AddPartnerPopup({
  phase,
  name,
  code,
  creating,
  onNameChange,
  onCreate,
  onCopy,
  onClose,
}: {
  /** 'name' = name field + Create code · 'code' = just the code + Copy. */
  phase: 'name' | 'code';
  name: string;
  code: string | null;
  creating: boolean;
  onNameChange: (t: string) => void;
  onCreate: () => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.popup} testID="partner-add-popup">
      <View style={styles.popupHead}>
        <View style={styles.popupHeadSpacer} />
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [styles.popupX, pressed && styles.pressed]}
          testID="partner-popup-close"
        >
          <Text style={styles.popupXGlyph}>×</Text>
        </Pressable>
      </View>
      {phase === 'name' ? (
        <View testID="partner-popup-name-step">
          <Text style={styles.popupTitle} accessibilityRole="header">
            Add a partner
          </Text>
          <Text style={styles.popupHint}>Who is this code for?</Text>
          <TextInput
            value={name}
            onChangeText={onNameChange}
            placeholder="Partner's name"
            placeholderTextColor={colors.muted}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={30}
            style={styles.popupInput}
            accessibilityLabel="Partner's name"
            testID="partner-popup-name"
          />
          <View style={styles.popupCta}>
            <Button
              title={creating ? 'Creating…' : 'Create code'}
              onPress={onCreate}
              disabled={!isValidName(name) || creating}
              loading={creating}
              testID="partner-popup-create"
            />
          </View>
        </View>
      ) : (
        <View style={styles.popupCodeWrap} testID="partner-popup-code-step">
          <Text
            style={styles.popupCode}
            selectable
            accessibilityRole="text"
            accessibilityLabel={`Invite code ${code ?? ''}`}
            testID="partner-popup-code"
          >
            {code ?? '······'}
          </Text>
          <View style={styles.popupCta}>
            <Button title="Copy" onPress={onCopy} testID="partner-popup-copy" />
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * The "Your partners" card: header + counter, then one row per invite.
 * Pure presentational — invites arrive as props so every list state
 * (empty, pending, accepted, mixed) is directly testable. The empty card
 * shows just the header; "Add a partner" lives below the card.
 */
export function PartnersListCard({
  invites,
  server,
  revokingId,
  togglingId,
  onRemove,
  onCopyCode,
  onToggle,
}: {
  invites: PartnerInvite[] | null;
  server: ServerStatus;
  revokingId: string | null;
  togglingId: string | null;
  onRemove: (invite: PartnerInvite) => void;
  onCopyCode: (invite: PartnerInvite) => void;
  onToggle: (invite: PartnerInvite, next: boolean) => void;
}) {
  return (
    <View style={styles.card} testID="partners-list-card">
      <View style={styles.headrow}>
        <Text style={styles.head} accessibilityRole="header">
          Your partners
        </Text>
        <Text style={styles.count} testID="partners-list-count">
          {invites === null
            ? ''
            : invites.length === 0
              ? 'None yet'
              : `${invites.length} of ${MAX_PARTNERS}`}
        </Text>
      </View>

      {invites === null ? (
        server === 'ok' ? (
          <Text style={styles.loading} testID="partners-list-loading">
            Getting your partners…
          </Text>
        ) : (
          <Text style={styles.note} testID="partners-list-not-ready">
            {NOT_READY_COPY}
          </Text>
        )
      ) : (
        invites.map((invite) =>
          invite.status === 'pending' ? (
            <View key={invite.id} style={styles.row} testID={`partner-row-${invite.id}`}>
              <View style={styles.rowHead}>
                <Text style={[styles.rowName, styles.shrink]} testID={`partner-row-name-${invite.id}`}>
                  {invite.name} <Text style={styles.rowInvited}>· Invited</Text>
                </Text>
                <Pressable
                  onPress={() => onRemove(invite)}
                  disabled={revokingId === invite.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove invite for ${invite.name}`}
                  style={({ pressed }) => [styles.rowX, pressed && styles.pressed]}
                  testID={`partner-row-remove-${invite.id}`}
                >
                  <Text style={styles.rowXGlyph}>×</Text>
                </Pressable>
              </View>
              <View style={styles.codeRow}>
                <Text style={styles.codeText} selectable testID={`partner-row-code-${invite.id}`}>
                  {invite.code ?? '······'}
                </Text>
                <Pressable
                  onPress={() => onCopyCode(invite)}
                  disabled={!invite.code}
                  accessibilityRole="button"
                  accessibilityLabel={`Copy ${invite.name}'s invite code`}
                  style={({ pressed }) => [styles.copyBtn, pressed && styles.pressed]}
                  testID={`partner-row-copy-${invite.id}`}
                >
                  <Text style={styles.copyText}>Copy</Text>
                </Pressable>
              </View>
              <Text style={styles.codeNote}>{PENDING_CODE_NOTE}</Text>
            </View>
          ) : (
            <View key={invite.id} style={styles.row} testID={`partner-row-${invite.id}`}>
              <View style={styles.acceptedHead}>
                <Text style={[styles.rowName, styles.shrink]} testID={`partner-row-name-${invite.id}`}>
                  {invite.name}
                </Text>
                <SharedSwitch
                  value={invite.sharingEnabled}
                  disabled={togglingId === invite.id}
                  onChange={(next) => onToggle(invite, next)}
                  accessibilityLabel={`Sharing for ${invite.name}`}
                  testID={`partner-row-switch-${invite.id}`}
                />
                <Pressable
                  onPress={() => onRemove(invite)}
                  disabled={revokingId === invite.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${invite.name}`}
                  style={({ pressed }) => [styles.rowX, pressed && styles.pressed]}
                  testID={`partner-row-remove-${invite.id}`}
                >
                  <Text style={styles.rowXGlyph}>×</Text>
                </Pressable>
              </View>
            </View>
          ),
        )
      )}
    </View>
  );
}

export default function ShareCodeScreen({
  onBack,
  onToast,
  onChanged,
}: {
  /** Omit inside onboarding (no back row there). */
  onBack?: () => void;
  onToast: (message: string) => void;
  /** Fires after the invite list changes (create/revoke) so the parent refreshes. */
  onChanged?: () => void;
}) {
  const [invites, setInvites] = useState<PartnerInvite[] | null>(null);
  const [server, setServer] = useState<ServerStatus>('ok');
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // In-app removal confirmation (mockup 33 partners-card). React Native
  // Web's Alert.alert is a no-op, so the dialog renders inside the sheet
  // and works identically on iOS and web.
  const [confirming, setConfirming] = useState<PartnerInvite | null>(null);
  // One-popup add flow (mockup 33 rev, Anuraj's five points): name step,
  // then the code-only step. Dismissing lands back on the list, where the
  // new partner already appears (the list reloads on create).
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupName, setPopupName] = useState('');
  const [popupPhase, setPopupPhase] = useState<'name' | 'code'>('name');
  const [popupCode, setPopupCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getPartnerInvites();
    setServer(r.status);
    setInvites(r.status === 'ok' ? r.invites ?? [] : null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const live = invites ?? [];
  const full = live.length >= MAX_PARTNERS;

  const openPopup = useCallback(() => {
    setPopupName('');
    setPopupCode(null);
    setPopupPhase('name');
    setPopupOpen(true);
  }, []);

  const closePopup = useCallback(() => {
    setPopupOpen(false);
  }, []);

  const createCode = useCallback(async () => {
    if (!isValidName(popupName) || creating) return;
    setCreating(true);
    const r = await createNamedInvite(popupName);
    setCreating(false);
    if (r.status === 'ok' && r.code) {
      setPopupCode(r.code);
      setPopupPhase('code');
      setPopupName('');
      onChanged?.();
      // Reload behind the popup: dismissing lands on a list that already
      // shows the new partner as "Name · Invited".
      load();
      return;
    }
    if (r.status === 'max_partners') {
      onToast(MAX_COPY);
      setPopupOpen(false);
      load();
      return;
    }
    if (r.status === 'name_required') {
      onToast('Give the invite a name first.');
      return;
    }
    if (r.status === 'not_ready' || r.status === 'not_configured') {
      onToast(NOT_READY_COPY);
      return;
    }
    onToast('That didn’t go through — try again in a bit.');
  }, [popupName, creating, onToast, onChanged, load]);

  /** Copy the popup's code (mockup 33: "Code copied."). */
  const handleCopyPopupCode = useCallback(async () => {
    if (!popupCode) return;
    const ok = await copyCode(popupCode);
    onToast(ok ? 'Code copied.' : 'Copy the code above to share it yourself.');
  }, [popupCode, onToast]);

  /** Copy a pending row's code (mockup 33 partners-card: "Code copied."). */
  const handleCopyRowCode = useCallback(
    async (invite: PartnerInvite) => {
      if (!invite.code) return;
      const ok = await copyCode(invite.code);
      onToast(ok ? 'Code copied.' : 'Copy the code above to share it yourself.');
    },
    [onToast],
  );

  /**
   * Per-partner sharing switch (mockup 33 partners-card). Optimistic
   * flip with revert on failure; toasts name the partner.
   */
  const handleSharingToggle = useCallback(
    async (invite: PartnerInvite, next: boolean) => {
      setTogglingId(invite.id);
      setInvites((prev) =>
        prev === null
          ? prev
          : prev.map((i) => (i.id === invite.id ? { ...i, sharingEnabled: next } : i)),
      );
      const r = await setPartnerSharing(invite.id, next);
      setTogglingId(null);
      if (r.status === 'ok') {
        onToast(next ? `Sharing back on for ${invite.name}.` : `Sharing paused for ${invite.name}.`);
        onChanged?.();
        return;
      }
      // Revert the optimistic flip.
      setInvites((prev) =>
        prev === null
          ? prev
          : prev.map((i) => (i.id === invite.id ? { ...i, sharingEnabled: !next } : i)),
      );
      if (r.status === 'no_partner_link') {
        onToast('That partner is already gone.');
        load();
      } else {
        onToast('That didn’t go through — try again in a bit.');
      }
    },
    [onToast, onChanged, load],
  );

  /**
   * Removal, two steps (mockup 33 partners-card): tapping the row ×
   * opens the in-app confirmation dialog; confirming revokes and
   * toasts. Pending removal says the invite/code stops working;
   * accepted removal says the partner loses access and can be
   * invited again.
   */
  const confirmRemove = useCallback(async () => {
    const invite = confirming;
    if (!invite) return;
    const pending = invite.status === 'pending';
    setRevokingId(invite.id);
    const result = await revokePartnerInvite(invite.id);
    setRevokingId(null);
    setConfirming(null);
    if (result.status === 'ok') {
      onToast(pending ? 'Invite removed.' : 'Partner removed.');
      onChanged?.();
      load();
    } else if (result.status === 'no_partner_link') {
      onToast('That partner is already gone.');
      load();
    } else {
      onToast('That didn’t go through — try again in a bit.');
    }
  }, [confirming, onToast, onChanged, load]);

  return (
    <View style={styles.host}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.wrap}
        keyboardShouldPersistTaps="handled"
        testID="partners-list"
      >
        {onBack ? (
          <View style={styles.backrow}>
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={styles.back}
              testID="partners-list-back"
            >
              <Text style={styles.backGlyph}>‹</Text>
            </Pressable>
            <Text style={styles.backTitle}>Share with your partner</Text>
          </View>
        ) : null}

        <PartnersListCard
          invites={invites}
          server={server}
          revokingId={revokingId}
          togglingId={togglingId}
          onRemove={setConfirming}
          onCopyCode={(invite) => void handleCopyRowCode(invite)}
          onToggle={(invite, next) => void handleSharingToggle(invite, next)}
        />

        {invites !== null && server === 'ok' && !full ? (
          <View style={styles.stack}>
            <Button title="Add a partner" variant="ghost" onPress={openPopup} testID="partners-list-add" />
          </View>
        ) : null}

        {invites !== null && server === 'ok' && full ? (
          <Text style={styles.maxnote} testID="partners-list-max">
            {MAX_COPY}
          </Text>
        ) : null}
      </ScrollView>

      <BottomSheet
        visible={popupOpen}
        onClose={closePopup}
        accessibilityLabel="Add a partner"
        testID="partner-add-sheet"
      >
        <AddPartnerPopup
          phase={popupPhase}
          name={popupName}
          code={popupCode}
          creating={creating}
          onNameChange={setPopupName}
          onCreate={() => void createCode()}
          onCopy={() => void handleCopyPopupCode()}
          onClose={closePopup}
        />
      </BottomSheet>

      <RemoveConfirmDialog
        invite={confirming}
        onDismiss={() => setConfirming(null)}
        onConfirm={() => void confirmRemove()}
        busy={revokingId !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'relative' },
  scroll: { maxHeight: SHEET_SCROLL_MAX },
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backrow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTouch,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  back: { width: minTouch, height: minTouch, alignItems: 'flex-start', justifyContent: 'center' },
  backGlyph: { fontSize: 30, color: colors.ink, lineHeight: 32 },
  backTitle: { ...typeScale.headline, color: colors.ink, fontWeight: '700' },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginTop: spacing.md,
    ...shadow.card,
  },
  headrow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  head: { ...typeScale.headline, color: colors.ink, fontWeight: '700' },
  count: { ...typeScale.subhead, color: colors.muted, fontWeight: '600' },
  loading: { ...typeScale.body, color: colors.muted, marginTop: spacing.md },
  note: { ...typeScale.body, color: colors.muted, marginTop: spacing.sm, lineHeight: 22 },
  row: {
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: spacing.sm,
  },
  rowName: { ...typeScale.body, color: colors.ink, fontWeight: '700', fontSize: 17 },
  rowInvited: { color: colors.muted, fontWeight: '400' },
  shrink: { flexShrink: 1 },
  // Partner-row head: name line with the × remove on its right end.
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Pending row: code + Copy on one line (mockup 33 partners-card).
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  codeText: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 6,
    color: colors.ink,
  },
  copyBtn: {
    minWidth: minTouch,
    minHeight: minTouch,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: spacing.md,
  },
  copyText: { ...typeScale.body, color: colors.coralDeep, fontWeight: '700' },
  codeNote: { ...typeScale.footnote, color: colors.muted, marginTop: spacing.xs },
  // Accepted row: name + per-partner switch + ×.
  acceptedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  /** Row × remove: 44×44 hit area, muted stone glyph (feed-card × language). */
  rowX: {
    width: minTouch,
    height: minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  rowXGlyph: {
    fontSize: 22,
    lineHeight: 26,
    color: '#B7ACA0',
  },
  pressed: { opacity: 0.7 },
  stack: { marginTop: spacing.lg },
  maxnote: {
    ...typeScale.body,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: spacing.lg,
  },
  // Add-partner popup (shared BottomSheet): name step, then code-only step.
  popup: { paddingBottom: spacing.md },
  popupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: minTouch,
  },
  popupHeadSpacer: { flex: 1 },
  popupX: {
    width: minTouch,
    height: minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  popupXGlyph: {
    fontSize: 24,
    lineHeight: 28,
    color: colors.muted,
  },
  popupTitle: { ...typeScale.title, color: colors.ink, fontWeight: '700', textAlign: 'center' },
  popupHint: {
    ...typeScale.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  popupInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    height: 60,
    fontSize: 18,
    color: colors.ink,
    marginTop: spacing.md,
  },
  popupCta: { marginTop: spacing.md },
  popupCodeWrap: { alignItems: 'center', paddingTop: spacing.sm },
  popupCode: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: 10,
    color: colors.ink,
    marginTop: spacing.sm,
  },
});
