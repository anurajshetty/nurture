import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import BottomSheet from '../components/BottomSheet';
import { colors, radii as radius, spacing, type } from '../theme/tokens';
import {
  CONSENT_BULLETS,
  CONSENT_LEDE,
  CONSENT_NOT_NOW,
  CONSENT_TITLE,
  CONSENT_UNDERSTAND,
} from './copy';

/**
 * Ask Willow first-use consent (Anuraj, Sept 20, 2026): verbatim copy.
 * Shows on EVERY ask tap until the first question is actually sent —
 * accepting alone does not suppress it. "Not now" dismisses.
 */
export function ConsentSheet({
  visible,
  onNotNow,
  onUnderstand,
}: {
  visible: boolean;
  onNotNow: () => void;
  onUnderstand: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onNotNow} testID="consent-sheet">
      <View style={styles.wrap}>
        <Text style={styles.title}>{CONSENT_TITLE}</Text>
        <Text style={styles.lede}>{CONSENT_LEDE}</Text>
        <View style={styles.bullets}>
          {CONSENT_BULLETS.map((b) => (
            <View key={b} style={styles.bulletRow}>
              <Text style={styles.dot}>•</Text>
              <Text style={styles.bullet}>{b}</Text>
            </View>
          ))}
        </View>
        <View style={styles.buttons}>
          <Pressable
            testID="consent-not-now"
            accessibilityRole="button"
            onPress={onNotNow}
            style={({ pressed }) => [styles.ghost, pressed && styles.ghostPressed]}
          >
            <Text style={styles.ghostLabel}>{CONSENT_NOT_NOW}</Text>
          </Pressable>
          <Pressable
            testID="consent-understand"
            accessibilityRole="button"
            onPress={onUnderstand}
            style={({ pressed }) => [styles.solid, pressed && styles.solidPressed]}
          >
            <Text style={styles.solidLabel}>{CONSENT_UNDERSTAND}</Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  title: { ...type.headline, color: colors.ink, marginBottom: spacing.sm },
  lede: { ...type.body, color: colors.ink, marginBottom: spacing.md },
  bullets: { gap: spacing.sm, marginBottom: spacing.lg },
  bulletRow: { flexDirection: 'row', gap: spacing.sm },
  dot: { ...type.body, color: colors.coralDeep },
  bullet: { ...type.body, color: colors.ink, flex: 1 },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  ghost: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  ghostPressed: { backgroundColor: colors.blush },
  ghostLabel: { ...type.body, fontWeight: '600', color: colors.ink },
  solid: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.coral,
  },
  solidPressed: { backgroundColor: colors.coralDeep },
  solidLabel: { ...type.body, fontWeight: '600', color: '#FFFFFF' },
});
