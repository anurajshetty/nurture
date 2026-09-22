/**
 * Shared delete confirmation dialog (Willow, mockup 18 pattern generalized
 * by mockup 30 — Anuraj approved Sept 20, 2026).
 *
 * ONE centered dialog for every feed card type; only the named item, the
 * consequence line, and the delete-button label change (per-type copy from
 * `deleteCopyFor`). Delete first, Keep it second; scrim tap and Keep it
 * dismiss; no undo — the confirmation IS the safety net.
 *
 * Visuals match mockup 18 exactly (the centered dialog the appointment
 * flow already shipped): dimmed scrim, card-style dialog, coral-deep
 * delete button, quiet Keep it.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontDisplay } from '../theme/tokens';
import type { DeleteCopy } from './deleteCopy';

interface DeleteCardDialogProps {
  /** The per-type copy, or null to hide the dialog. */
  copy: DeleteCopy | null;
  /** Dismiss without deleting (scrim tap / Keep it). */
  onDismiss: () => void;
  /** Confirm the delete. */
  onConfirm: () => void;
}

export default function DeleteCardDialog({ copy, onDismiss, onConfirm }: DeleteCardDialogProps) {
  if (!copy) return null;
  return (
    <View style={styles.delScrim} testID="delete-card-dialog">
      <Pressable
        testID="delete-card-scrim"
        accessibilityRole="button"
        accessibilityLabel="Dismiss delete confirmation"
        onPress={onDismiss}
        style={styles.delScrimPress}
      />
      <View
        style={styles.delDialog}
        accessibilityRole="alert"
        accessibilityLabel={copy.title}
      >
        <Text style={styles.delTitle}>{copy.title}</Text>
        <Text style={styles.delBody}>{copy.body}</Text>
        <Pressable
          testID="delete-card-confirm"
          accessibilityRole="button"
          accessibilityLabel={copy.confirmLabel}
          onPress={onConfirm}
          style={({ pressed }) => [styles.delBtn, pressed && styles.delBtnPressed]}
        >
          <Text style={styles.delBtnText}>{copy.confirmLabel}</Text>
        </Pressable>
        <Pressable
          testID="delete-card-keep"
          accessibilityRole="button"
          accessibilityLabel="Keep"
          onPress={onDismiss}
          style={({ pressed }) => [styles.keepBtn, pressed && styles.keepPressed]}
        >
          <Text style={styles.keepText}>Keep</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  delScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(90,74,62,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  delScrimPress: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  delDialog: {
    position: 'relative',
    width: '85%',
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 26,
  },
  delTitle: {
    fontFamily: fontDisplay,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 10,
  },
  delBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
    marginBottom: 22,
  },
  delBtn: {
    backgroundColor: colors.coralDeep,
    borderRadius: 16,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  delBtnPressed: {
    opacity: 0.85,
  },
  delBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  keepBtn: {
    backgroundColor: '#FAF6F0',
    borderRadius: 16,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepPressed: {
    opacity: 0.7,
  },
  keepText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '600',
  },
});

/** Toast styles shared with the Logs screen (same mockup-18 look). */
export const deleteToastStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center',
    zIndex: 60,
  },
  pill: {
    backgroundColor: '#3A332E',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
});

