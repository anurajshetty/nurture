/**
 * Partner sharing — her partners list (mockup 33 partners-card,
 * Anuraj approved Sept 21, 2026).
 *
 * Named invites, up to 5 (pending + accepted). Adding asks "Who is this
 * code for?" — the code is not created or listed until a name is given.
 * Pending rows show the 6-char code + Copy ("Invite code — works once.
 * Share it with them.") and "Remove invite"; accepted rows show the
 * real per-partner switch ("Sees your shared entries" / "Paused —
 * sees nothing for now") and "Remove". Removing anything asks first.
 * At 5/5 the Add button gives way to a warm note. Used from the You tab
 * and from onboarding step 2; onboarding passes showListCard={false}
 * and shows no list card at all — just the name input + Cancel/Create
 * code, with the new code revealed below (per Anuraj, Sept 2026).
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
import { Button } from '../components';
import SharedSwitch from '../components/SharedSwitch';
import { colors, minTouch, radii, shadow, spacing, type as typeScale } from '../theme/tokens';
import RemoveConfirmDialog from './RemoveConfirmDialog';
import {
  MAX_PARTNERS,
  createNamedInvite,
  getPartnerInvites,
  isValidName,
  normalizeName,
  revokePartnerInvite,
  setPartnerSharing,
  type PartnerInvite,
  type ServerStatus,
} from './inviteCodes';
import { HANDSHAKE_COPY } from './sharing';

declare const require: (id: string) => unknown;

const NOT_READY_COPY =
  'Partner sharing is getting ready — your partners will appear here once the backend is live.';
const MAX_COPY = "You've added 5 partners — the most Willow allows right now.";
/** Pending-row explainer under the code (mockup 33 partners-card, verbatim). */
const PENDING_CODE_NOTE = 'Invite code — works once. Share it with them.';
const OWN_CODE_NOTE = 'Each partner enters their own code in Willow on their phone.';

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

export default function ShareCodeScreen({
  onBack,
  onToast,
  onChanged,
  showListCard = true,
}: {
  /** Omit inside onboarding (no back row there). */
  onBack?: () => void;
  onToast: (message: string) => void;
  /** Fires after the invite list changes (create/revoke) so the parent refreshes. */
  onChanged?: () => void;
  /**
   * Onboarding step 2 shows no "Your partners" card — just the name
   * input + Cancel/Create code (the name-first invite composer is
   * always open there). The You-tab sheet keeps the full list card.
   */
  showListCard?: boolean;
}) {
  const [invites, setInvites] = useState<PartnerInvite[] | null>(null);
  const [server, setServer] = useState<ServerStatus>('ok');
  const [adding, setAdding] = useState(!showListCard);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState<{ name: string; code: string } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // In-app removal confirmation (mockup 33 partners-card). React Native
  // Web's Alert.alert is a no-op, so the dialog renders inside the sheet
  // and works identically on iOS and web.
  const [confirming, setConfirming] = useState<PartnerInvite | null>(null);

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

  const beginAdd = useCallback(() => {
    setNewCode(null);
    setName('');
    setAdding(true);
  }, []);

  const createCode = useCallback(async () => {
    if (!isValidName(name) || creating) return;
    setCreating(true);
    const r = await createNamedInvite(name);
    setCreating(false);
    if (r.status === 'ok' && r.code) {
      const created = { name: normalizeName(name), code: r.code };
      // In onboarding (no list card) the new code reveals below the
      // composer. In the You tab the new pending row shows its code
      // inline, so no separate reveal card is needed.
      if (showListCard) {
        setNewCode(null);
        setAdding(false);
      } else {
        setNewCode(created);
      }
      setName('');
      onChanged?.();
      load();
      return;
    }
    if (r.status === 'max_partners') {
      onToast(MAX_COPY);
      if (showListCard) setAdding(false);
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
  }, [name, creating, onToast, onChanged, load, showListCard]);

  const handleCopy = useCallback(async () => {
    if (!newCode) return;
    const ok = await copyCode(newCode.code);
    onToast(ok ? 'Code copied.' : 'Copy the code above to share it yourself.');
  }, [newCode, onToast]);

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
   * Per-partner sharing switch (mockup 33 partners-card): "Sees your
   * shared entries" / "Paused — sees nothing for now". Optimistic flip
   * with revert on failure; toasts name the partner.
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
   * Removal, two steps (mockup 33 partners-card): tapping "Remove
   * invite"/"Remove" opens the in-app confirmation dialog; confirming
   * revokes and toasts. Pending removal says the invite/code stops
   * working; accepted removal says the partner loses access and can be
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

      {showListCard ? (
      <View style={styles.card}>
        <View style={styles.headrow}>
          <Text style={styles.head} accessibilityRole="header">
            Your partners
          </Text>
          <Text style={styles.count} testID="partners-list-count">
            {invites === null ? '' : live.length === 0 ? 'None yet' : `${live.length} of ${MAX_PARTNERS}`}
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
        ) : live.length === 0 ? (
          <Text style={styles.note} testID="partners-list-empty">
            Invite the people you want following along — each gets a personal code that works once.
          </Text>
        ) : (
          live.map((invite) =>
            invite.status === 'pending' ? (
              <View key={invite.id} style={styles.row} testID={`partner-row-${invite.id}`}>
                <Text style={styles.rowName} testID={`partner-row-name-${invite.id}`}>
                  {invite.name} <Text style={styles.rowInvited}>· Invited</Text>
                </Text>
                <View style={styles.codeRow}>
                  <Text style={styles.codeText} selectable testID={`partner-row-code-${invite.id}`}>
                    {invite.code ?? '······'}
                  </Text>
                  <Pressable
                    onPress={() => handleCopyRowCode(invite)}
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
                <View style={styles.rowDivider} />
                <Pressable
                  onPress={() => setConfirming(invite)}
                  disabled={revokingId === invite.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove invite for ${invite.name}`}
                  style={({ pressed }) => [styles.rowRemove, pressed && styles.pressed]}
                  testID={`partner-row-remove-${invite.id}`}
                >
                  <Text style={styles.removeText}>
                    {revokingId === invite.id ? 'Removing…' : 'Remove invite'}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View key={invite.id} style={styles.row} testID={`partner-row-${invite.id}`}>
                <View style={styles.acceptedHead}>
                  <Text style={styles.rowName} testID={`partner-row-name-${invite.id}`}>
                    {invite.name}
                  </Text>
                  <SharedSwitch
                    value={invite.sharingEnabled}
                    disabled={togglingId === invite.id}
                    onChange={(next) => handleSharingToggle(invite, next)}
                    accessibilityLabel={`Sharing for ${invite.name}`}
                    testID={`partner-row-switch-${invite.id}`}
                  />
                </View>
                <Text
                  style={[styles.shareSub, !invite.sharingEnabled && styles.shareSubPaused]}
                  testID={`partner-row-share-sub-${invite.id}`}
                >
                  {invite.sharingEnabled
                    ? 'Sees your shared entries'
                    : 'Paused — sees nothing for now'}
                </Text>
                <View style={styles.rowDivider} />
                <Pressable
                  onPress={() => setConfirming(invite)}
                  disabled={revokingId === invite.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${invite.name}`}
                  style={({ pressed }) => [styles.rowRemove, pressed && styles.pressed]}
                  testID={`partner-row-remove-${invite.id}`}
                >
                  <Text style={styles.removeText}>
                    {revokingId === invite.id ? 'Removing…' : 'Remove'}
                  </Text>
                </Pressable>
              </View>
            ),
          )
        )}

        {invites !== null && server === 'ok' ? (
          <View style={styles.explainer} testID="partners-list-explainer">
            <Text style={styles.explainerText}>{HANDSHAKE_COPY}</Text>
            <Text style={styles.explainerNote}>{OWN_CODE_NOTE}</Text>
          </View>
        ) : null}
      </View>
      ) : null}

      {newCode ? (
        <View style={styles.codebig} testID="partner-new-code">
          <Text style={styles.cbLabel}>{newCode.name}'s invite code</Text>
          <Text style={styles.cbCode} selectable testID="partner-new-code-value">
            {newCode.code}
          </Text>
          <Text style={styles.note}>This code works once — share it with {newCode.name}.</Text>
          <View style={styles.copyrow}>
            <Button title="Copy" onPress={handleCopy} testID="partner-new-code-copy" />
          </View>
        </View>
      ) : null}

      {adding ? (
        <View style={styles.addbox} testID="partner-add">
          <Text style={styles.fieldLabel}>Who is this code for?</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Their name"
            placeholderTextColor={colors.muted}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={30}
            style={styles.input}
            accessibilityLabel="Partner name"
            testID="partner-add-name"
          />
          <View style={styles.addrow}>
            <Button
              title="Cancel"
              variant="ghost"
              // Onboarding shows the composer permanently: Cancel just
              // clears the draft name instead of dismissing the box.
              onPress={() => (showListCard ? setAdding(false) : setName(''))}
              testID="partner-add-cancel"
            />
            <View style={styles.addspacer} />
            <Button
              title={creating ? 'Creating…' : 'Create code'}
              onPress={createCode}
              disabled={!isValidName(name) || creating}
              loading={creating}
              testID="partner-add-create"
            />
          </View>
        </View>
      ) : null}

      {invites !== null && server === 'ok' && !adding && !full ? (
        <View style={styles.stack}>
          <Button title="Add a partner" variant="ghost" onPress={beginAdd} testID="partners-list-add" />
        </View>
      ) : null}

      {invites !== null && server === 'ok' && full ? (
        <Text style={styles.maxnote} testID="partners-list-max">
          {MAX_COPY}
        </Text>
      ) : null}
      </ScrollView>

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
  // Accepted row: name + per-partner switch.
  acceptedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shareSub: { ...typeScale.subhead, color: colors.muted, marginTop: spacing.xs },
  shareSubPaused: { color: colors.coralDeep, fontWeight: '600' },
  rowDivider: {
    height: 1,
    backgroundColor: colors.line,
    marginTop: spacing.md,
  },
  rowRemove: {
    minHeight: minTouch,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: spacing.sm,
  },
  pressed: { opacity: 0.7 },
  removeText: { ...typeScale.body, color: colors.coralDeep, fontWeight: '600' },
  explainer: {
    backgroundColor: colors.blush,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  explainerText: {
    ...typeScale.footnote,
    color: colors.coralDeep,
    textAlign: 'center',
    lineHeight: 18,
  },
  explainerNote: {
    ...typeScale.footnote,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  codebig: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    marginTop: spacing.md,
    ...shadow.card,
  },
  cbLabel: { ...typeScale.subhead, color: colors.muted },
  cbCode: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: 10,
    color: colors.ink,
    marginTop: spacing.sm,
  },
  copyrow: { marginTop: spacing.md, alignSelf: 'stretch' },
  addbox: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  fieldLabel: {
    ...typeScale.subhead,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    height: 60,
    fontSize: 18,
    color: colors.ink,
  },
  addrow: { flexDirection: 'row', marginTop: spacing.md, alignItems: 'center' },
  addspacer: { width: spacing.sm },
  stack: { marginTop: spacing.lg },
  maxnote: {
    ...typeScale.body,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: spacing.lg,
  },
});
