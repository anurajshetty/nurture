/**
 * Kick counter Home card (Willow, round 4 — Anuraj approved Sept 20, 2026;
 * design source of truth: mockup 21-kick-entry-rev2.html).
 *
 * Sits on the Week tab below the "Coming up" appointment cards and above
 * "Highlights this week", from displayed week 19. The card NEVER retires —
 * it persists permanently in both states:
 *
 * State A (no sessions this week): the "Start recording kicks" invitation.
 * State B (sessions this week): one warm summary line — "N sessions this
 * week · M movements" — plus a gentle week-scoped pattern note when 2+
 * sessions exist. No per-session rows, no verdicts, no streaks, no
 * red/green.
 *
 * The whole card taps to the week-scoped session list — NEVER the counting
 * screen (the floating kicks pill remains the counter entry).
 *
 * Hard acceptance criterion (Anuraj, Sept 20, 2026): kicker + link use
 * coralDeep, title ink #2F2B27, body #5C554D, sage top border — IDENTICAL
 * in State A and State B. The blue-titles issue was a mockup-only iOS
 * Safari artifact; the React Native styles below set explicit colors on
 * every text element in both states.
 */

import { StyleSheet, Text, View } from 'react-native';
import Card from '../components/Card';
import { colors, spacing, type as typeScale } from '../theme/tokens';
import { weekPatternNote } from './pattern';
import { formatWeekSummary } from './session';
import type { KickSession } from './types';

export function KickHomeCard({
  weekSessions,
  onPress,
}: {
  /** Sessions in the DISPLAYED week (week-scoped). State A when empty. */
  weekSessions: readonly KickSession[];
  onPress: () => void;
}) {
  const hasSessions = weekSessions.length > 0;
  const patternNote = hasSessions ? weekPatternNote(weekSessions) : null;
  return (
    <Card
      testID="week-kick-card"
      onPress={onPress}
      accessibilityLabel={
        hasSessions
          ? "This week's kick counts. Button."
          : 'Start recording kicks. Button.'
      }
      style={styles.card}
    >
      <Text style={styles.kicker}>Kick counting</Text>
      {hasSessions ? (
        <>
          <Text style={styles.title}>This week&apos;s kicks</Text>
          <Text style={styles.summary}>{formatWeekSummary(weekSessions)}</Text>
          {patternNote ? (
            <Text style={styles.pattern}>{patternNote}</Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.title}>Start recording kicks</Text>
          <Text style={styles.body}>
            Your baby is getting big enough for their movements to form a
            pattern. When they&apos;re usually active, tap the kicks button
            below and count along — one quiet session at a time.
          </Text>
        </>
      )}
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
    marginBottom: spacing.sm,
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
  summary: {
    fontSize: 16,
    fontWeight: '700',
    color: '#5C554D',
    lineHeight: 24,
    marginBottom: spacing.xs,
  },
  pattern: {
    fontSize: 13.5,
    color: colors.muted,
    lineHeight: 21,
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
