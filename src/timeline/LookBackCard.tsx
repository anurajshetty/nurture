/**
 * Memory look-back card (Epic 3.3): the "4 weeks ago today" moment from the
 * approved 03-timeline mockup.
 *
 * Sage-tinted rounded card: small-caps sage-deep kicker, serif italic quote,
 * muted subline ("First ultrasound · Aug 20 · tap to revisit"), and an ×
 * dismiss button top-right. The whole card is pressable to revisit the memory.
 *
 * Dismissal persistence is owned by the timeline screen (kv store) — this
 * component only fires onDismiss. Never a push notification.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontDisplay, minTouch, radii, spacing, type as typeScale } from '../theme/tokens';
import type { LocalEvent } from '../lib/types';
import type { LookBack } from '../timeline/lookback';

interface Props {
  lookback: LookBack;
  onDismiss(): void;
  onRevisit(event: LocalEvent): void;
}

export default function LookBackCard({ lookback, onDismiss, onRevisit }: Props) {
  const kicker = `${lookback.weeksAgo} weeks ago today`;
  return (
    <Pressable
      testID="lookback-card"
      accessibilityRole="button"
      accessibilityLabel={`Revisit memory: ${lookback.quote}`}
      onPress={() => onRevisit(lookback.event)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <Pressable
        testID="lookback-dismiss"
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={8}
        onPress={onDismiss}
        style={({ pressed }) => [styles.dismiss, pressed && styles.dismissPressed]}>
        <Text style={styles.dismissGlyph}>×</Text>
      </Pressable>
      <Text style={styles.kicker}>{kicker}</Text>
      <Text style={styles.quote}>"{lookback.quote}"</Text>
      <Text style={styles.subline}>{lookback.subline}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.sageTint,
    borderRadius: radii.cardLarge,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    position: 'relative',
  },
  cardPressed: {
    opacity: 0.92,
  },
  kicker: {
    fontSize: 11.5,
    letterSpacing: 1.15,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: colors.sageDeep,
    paddingRight: 44, // clear of the dismiss button
    marginBottom: spacing.sm,
  },
  quote: {
    fontFamily: fontDisplay,
    fontStyle: 'italic',
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  subline: {
    ...typeScale.subhead,
    color: colors.sageDeep,
  },
  dismiss: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: Math.max(minTouch - 4, 44),
    height: Math.max(minTouch - 4, 44),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  dismissPressed: {
    backgroundColor: 'rgba(111,143,110,0.15)',
  },
  dismissGlyph: {
    fontSize: 22,
    lineHeight: 24,
    color: colors.sageDeep,
    fontWeight: '400',
  },
});
