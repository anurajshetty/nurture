/**
 * Partner sharing — her partners list (mockup 33 rev C).
 *
 * Named invites, up to 5 (pending + accepted). Adding asks "Who is this
 * code for?" — the code is not created or listed until a name is given,
 * then the 6-character code reveals with Copy below (no system Share).
 * Pending invites show "Name · Invited" (muted, no remove); accepted
 * partners show name + Remove. At 5/5 the Add button gives way to a warm
 * note. Used from the You tab and from onboarding step 2; onboarding
 * passes showListCard={false} and shows no list card at all — just the
 * name input + Cancel/Create code, per Anuraj (Sept 2026).
 *
 * When the backend migration isn't applied yet, the surface says so
 * plainly and never crashes.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../components';
import { colors, minTouch, radii, shadow, spacing, type as typeScale } from '../theme/tokens';
import {
  MAX_PARTNERS,
  createNamedInvite,
  getPartnerInvites,
  isValidName,
  normalizeName,
  revokePartnerInvite,
  type PartnerInvite,
  type ServerStatus,
} from './inviteCodes';

declare const require: (id: string) => unknown;

const NOT_READY_COPY =
  'Partner sharing is getting ready — your partners will appear here once the backend is live.';
const MAX_COPY = "You've added 5 partners — the most Willow allows right now.";
const SHARED_NOTE = 'They see only the moments you mark as shared.';

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
      setNewCode({ name: normalizeName(name), code: r.code });
      // In onboarding the composer stays open after creating; elsewhere
      // it closes back to the list card.
      if (showListCard) setAdding(false);
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

  const handleRemove = useCallback(
    (invite: PartnerInvite) => {
      Alert.alert(
        `Remove ${invite.name}?`,
        'Your partner will lose access to everything you shared. This can’t be undone.',
        [
          { text: 'Keep sharing', style: 'cancel' },
          {
            text: 'Remove partner',
            style: 'destructive',
            onPress: async () => {
              setRevokingId(invite.id);
              const result = await revokePartnerInvite(invite.id);
              setRevokingId(null);
              if (result.status === 'ok') {
                onToast('Partner removed.');
                onChanged?.();
                load();
              } else if (result.status === 'no_partner_link') {
                onToast('That partner is already gone.');
                load();
              } else {
                onToast('That didn’t go through — try again in a bit.');
              }
            },
          },
        ],
      );
    },
    [onToast, onChanged, load],
  );

  return (
    <View style={styles.wrap} testID="partners-list">
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
          live.map((invite) => (
            <View key={invite.id} style={styles.row} testID={`partner-row-${invite.id}`}>
              {invite.status === 'accepted' ? (
                <>
                  <Text style={styles.rowName} testID={`partner-row-name-${invite.id}`}>
                    {invite.name}
                  </Text>
                  <Pressable
                    onPress={() => handleRemove(invite)}
                    disabled={revokingId === invite.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${invite.name}`}
                    style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                    testID={`partner-row-remove-${invite.id}`}
                  >
                    <Text style={styles.removeText}>
                      {revokingId === invite.id ? 'Removing…' : 'Remove'}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.rowPending} testID={`partner-row-pending-${invite.id}`}>
                  {invite.name} <Text style={styles.rowInvited}>· Invited</Text>
                </Text>
              )}
            </View>
          ))
        )}

        {invites !== null && server === 'ok' ? (
          <Text style={styles.note}>{SHARED_NOTE}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: spacing.sm,
    minHeight: minTouch,
  },
  rowName: { ...typeScale.body, color: colors.ink, fontWeight: '600', flex: 1 },
  rowPending: { ...typeScale.body, color: colors.muted, flex: 1 },
  rowInvited: { color: colors.muted },
  remove: {
    minWidth: minTouch,
    minHeight: minTouch,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: spacing.md,
  },
  pressed: { opacity: 0.7 },
  removeText: { ...typeScale.body, color: colors.coralDeep, fontWeight: '600' },
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
