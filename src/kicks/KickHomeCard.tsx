/**
 * Kick counter Home card (Willow, Anuraj approved Sept 20, 2026).
 *
 * Sits on the Week tab directly below the "Highlights this week" kicker
 * (above the highlights card), from displayed week 19. Tapping it opens
 * the weekly session list ("Her pattern") — NOT the counting screen.
 * Retires permanently after her first saved session.
 */

import { StyleSheet, Text, View } from 'react-native';
import Card from '../components/Card';
import { colors, spacing, type as typeScale } from '../theme/tokens';

export function KickHomeCard({ onPress }: { onPress: () => void }) {
  return (
    <Card
      testID="week-kick-card"
      onPress={onPress}
      accessibilityLabel="Kick counting. See this week's counts."
      style={styles.card}
    >
      <Text style={styles.kicker}>Kick counting</Text>
      <Text style={styles.title}>Get to know her pattern</Text>
      <Text style={styles.body}>
        She&apos;s getting big enough for her movements to form a pattern.
        When she&apos;s usually active, settle in and tap along — one quiet
        session at a time.
      </Text>
      <View style={styles.row}>
        <Text style={styles.link}>See this week&apos;s counts ›</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderTopWidth: 4,
    borderTopColor: colors.sage,
    marginBottom: spacing.md,
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 20,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  body: {
    ...typeScale.body,
    color: '#5C554D',
    lineHeight: 24,
  },
  row: {
    marginTop: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  link: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.coralDeep,
  },
});
