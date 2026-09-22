/**
 * Partner-removal confirmation dialog (mockup 33 partners-card, Anuraj
 * approved Sept 21, 2026).
 *
 * React Native Web's Alert.alert is a no-op, so — like feed-card
 * deletion (DeleteCardDialog) — partner removal confirms with an
 * in-app dialog that works identically on iOS and web. One centered
 * dialog; only the title/body/confirm labels change:
 *
 *   pending : "Remove this invite?" / "The invite and its code stop
 *             working. {name} won't be able to use it." / "Remove
 *             invite" + "Keep invite"
 *   accepted: "Remove {name}?" / "{name} loses access to everything
 *             you've shared — and can be invited again later." /
 *             "Remove partner" + "Keep sharing"
 *
 * Visuals follow DeleteCardDialog (mockup 18): dimmed scrim, card-style
 * dialog, coral-deep confirm button, quiet Keep.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, shadow, spacing, type as typeScale } from '../theme/tokens';
import type { PartnerInvite } from './inviteCodes';

interface RemoveConfirmDialogProps {
  /** The invite/partner pending removal, or null to hide the dialog. */
  invite: PartnerInvite | null;
  /** Dismiss without removing (scrim tap / Keep). */
  onDismiss: () => void;
  /** Confirm the removal. */
  onConfirm: () => void;
  /** Removal in flight — disables the confirm button. */
  busy?: boolean;
}

export default function RemoveConfirmDialog({
  invite,
  onDismiss,
  onConfirm,
  busy = false,
}: RemoveConfirmDialogProps) {
  if (!invite) return null;
  const pending = invite.status === 'pending';
  const title = pending ? 'Remove this invite?' : `Remove ${invite.name}?`;
  const body = pending
    ? `The invite and its code stop working. ${invite.name} won't be able to use it.`
    : `${invite.name} loses access to everything you've shared — and can be invited again later.`;
  const confirmLabel = pending ? 'Remove invite' : 'Remove partner';
  const keepLabel = pending ? 'Keep invite' : 'Keep sharing';
  return (
    <View style={styles.scrim} testID="remove-partner-dialog">
      <Pressable
        testID="remove-partner-scrim"
        accessibilityRole="button"
        accessibilityLabel="Dismiss remove confirmation"
        onPress={onDismiss}
        style={styles.scrimPress}
      />
      <View
        style={styles.dialog}
        accessibilityRole="alert"
        accessibilityLabel={title}
      >
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable
          testID="remove-partner-confirm"
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          onPress={onConfirm}
          disabled={busy}
          style={({ pressed }) => [
            styles.confirmBtn,
            pressed && styles.confirmPressed,
            busy && styles.busy,
          ]}
        >
          <Text style={styles.confirmText}>
            {busy ? 'Removing…' : confirmLabel}
          </Text>
        </Pressable>
        <Pressable
          testID="remove-partner-keep"
          accessibilityRole="button"
          accessibilityLabel={keepLabel}
          onPress={onDismiss}
          style={({ pressed }) => [styles.keepBtn, pressed && styles.keepPressed]}
        >
          <Text style={styles.keepText}>{keepLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(31, 26, 24, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  scrimPress: {
    ...StyleSheet.absoluteFill,
  },
  dialog: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.xl,
    marginHorizontal: spacing.xl,
    maxWidth: 340,
    width: '86%',
    ...shadow.card,
  },
  title: {
    ...typeScale.title,
    color: colors.ink,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    ...typeScale.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  confirmBtn: {
    backgroundColor: colors.coralDeep,
    borderRadius: radii.chip,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  confirmPressed: { opacity: 0.85 },
  busy: { opacity: 0.6 },
  confirmText: {
    ...typeScale.body,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  keepBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  keepPressed: { opacity: 0.7 },
  keepText: {
    ...typeScale.body,
    color: colors.ink,
    fontWeight: '600',
  },
});
