/**
 * Partner sharing — her invite-code surface (mockup 33, screen ⑤).
 *
 * The big personal code, Copy + system Share, the warm notes, and the
 * connected status with a "Remove partner" option. Used from the You tab
 * ("Share with your partner" row) and from onboarding step 2.
 *
 * When the backend migration isn't applied yet, the code area explains
 * plainly that sharing is still getting ready — it never crashes.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components';
import { colors, minTouch, radii, shadow, spacing, type as typeScale } from '../theme/tokens';
import {
  getMyInviteCode,
  getOwnerLinkStatus,
  revokePartnerLink,
  type InviteCodeResult,
  type OwnerLinkResult,
} from './inviteCodes';

declare const require: (id: string) => unknown;

const NOT_READY_COPY = 'Partner sharing is getting ready — your code will appear here once the backend is live.';

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
    // expo-clipboard isn't in this build — the share sheet is the fallback.
  }
  return false;
}

export default function ShareCodeScreen({
  onBack,
  onToast,
  onChanged,
}: {
  /** Omit inside onboarding (no back row there). */
  onBack?: () => void;
  onToast: (message: string) => void;
  /** Fires after the link state changes (revoke) so the parent refreshes. */
  onChanged?: () => void;
}) {
  const [invite, setInvite] = useState<InviteCodeResult | null>(null);
  const [link, setLink] = useState<OwnerLinkResult | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    const [i, l] = await Promise.all([getMyInviteCode(), getOwnerLinkStatus()]);
    setInvite(i);
    setLink(l);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const code = invite?.status === 'ok' ? invite.code : null;
  const connected = link?.status === 'ok' && link.connected === true;

  const handleCopy = useCallback(async () => {
    if (!code) return;
    const ok = await copyCode(code);
    if (ok) {
      onToast('Code copied.');
    } else {
      // No clipboard here — the share sheet lets her copy it manually.
      try {
        await Share.share({ message: `Here's my Willow invite code: ${code}` });
      } catch {
        onToast('Copy the code above to share it yourself.');
      }
    }
  }, [code, onToast]);

  const handleShare = useCallback(async () => {
    if (!code) return;
    const message = `Here's my Willow invite code: ${code} — enter it in Willow to follow along.`;
    try {
      await Share.share({ message });
    } catch {
      onToast('Sharing is not available here — copy the code above instead.');
    }
  }, [code, onToast]);

  const handleRemove = useCallback(() => {
    Alert.alert(
      'Remove partner?',
      'Your partner will lose access to everything you shared. This can’t be undone.',
      [
        { text: 'Keep sharing', style: 'cancel' },
        {
          text: 'Remove partner',
          style: 'destructive',
          onPress: async () => {
            setRevoking(true);
            const result = await revokePartnerLink();
            setRevoking(false);
            if (result.status === 'ok') {
              onToast('Partner removed.');
              onChanged?.();
              load();
            } else if (result.status === 'no_partner_link') {
              onToast('No partner is connected right now.');
              load();
            } else {
              onToast('That didn’t go through — try again in a bit.');
            }
          },
        },
      ],
    );
  }, [onToast, onChanged, load]);

  return (
    <View style={styles.wrap} testID="share-code">
      {onBack ? (
        <View style={styles.backrow}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.back}
            testID="share-code-back"
          >
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <Text style={styles.backTitle}>Share with your partner</Text>
        </View>
      ) : null}

      <View style={styles.codebig}>
        <Text style={styles.cbLabel}>Your invite code</Text>
        {!invite ? (
          <Text style={styles.cbLoading} testID="share-code-loading">
            Getting your code…
          </Text>
        ) : code ? (
          <Text style={styles.cbCode} selectable testID="share-code-value">
            {code}
          </Text>
        ) : (
          <Text style={styles.cbNote} testID="share-code-not-ready">
            {NOT_READY_COPY}
          </Text>
        )}
        {invite?.status === 'ok' ? (
          <Text style={styles.status} testID="share-code-status">
            {connected ? 'Connected — your partner can see what you share.' : 'Not connected yet — share your code to link up.'}
          </Text>
        ) : null}
      </View>

      {code ? (
        <>
          <Text style={styles.note}>Your partner enters this code in Willow on their phone.</Text>
          <Text style={styles.note}>This is your personal code — share it only with your partner.</Text>
          <Text style={styles.note}>This code works once — it stops being valid the moment your partner connects.</Text>
        </>
      ) : null}

      <View style={styles.stack}>
        <Button
          title={Platform.OS === 'ios' || Platform.OS === 'android' ? 'Share…' : 'Share'}
          onPress={handleShare}
          disabled={!code}
          testID="share-code-share"
        />
        <Button title="Copy code" variant="ghost" onPress={handleCopy} disabled={!code} testID="share-code-copy" />
      </View>

      {connected ? (
        <Pressable
          onPress={handleRemove}
          disabled={revoking}
          accessibilityRole="button"
          accessibilityLabel="Remove partner"
          style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
          testID="share-code-remove"
        >
          <Text style={styles.removeText}>{revoking ? 'Removing…' : 'Remove partner'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backrow: { flexDirection: 'row', alignItems: 'center', minHeight: minTouch, marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg },
  back: { width: minTouch, height: minTouch, alignItems: 'flex-start', justifyContent: 'center' },
  backGlyph: { fontSize: 30, color: colors.ink, lineHeight: 32 },
  backTitle: { ...typeScale.headline, color: colors.ink, fontWeight: '700' },
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
  cbLoading: { ...typeScale.body, color: colors.muted, marginTop: spacing.sm },
  cbNote: { ...typeScale.body, color: colors.muted, marginTop: spacing.sm, textAlign: 'center', lineHeight: 22 },
  status: { ...typeScale.subhead, color: colors.sageDeep, marginTop: spacing.sm, textAlign: 'center' },
  note: { ...typeScale.body, color: colors.muted, marginTop: spacing.sm, lineHeight: 22 },
  stack: { marginTop: spacing.lg, gap: spacing.sm },
  remove: {
    marginTop: spacing.xl,
    minHeight: minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  removeText: { ...typeScale.body, color: colors.coralDeep, fontWeight: '600' },
});
