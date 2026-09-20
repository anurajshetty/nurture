/**
 * Labor readiness hub (Willow, Sept 2026).
 *
 * Shared entry point: three entry cards linking to the three
 * labor-readiness sections. Reached from the Week-tab "Labor readiness"
 * card (one tap); any section is reachable in two taps from Week.
 *
 * Sibling routes are linked only — their screens are built by their own
 * tracks; nothing is stubbed here.
 */

import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, Screen } from '../src/components';
import { colors, minTouch, spacing } from '../src/theme/tokens';
import { HUB_COPY as C, LABOR_DISCLAIMER } from '../src/labor/copy';

const HUB_CARDS = [
  {
    route: '/labor/contractions' as const,
    testID: 'labor-hub-contractions',
    title: C.timerTitle,
    body: C.timerBody,
  },
  {
    route: '/labor/breathing' as const,
    testID: 'labor-hub-breathing',
    title: C.breathingTitle,
    body: C.breathingBody,
  },
  {
    route: '/labor/pelvicfloor' as const,
    testID: 'labor-hub-pelvicfloor',
    title: C.pelvicFloorTitle,
    body: C.pelvicFloorBody,
  },
] as const;

export default function LaborHubScreen() {
  const router = useRouter();

  return (
    <Screen testID="labor-hub" bottomPadding={spacing.xxxl}>
      <View style={styles.topnav}>
        <Pressable
          testID="labor-hub-back"
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [
            styles.iconBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.iconGlyph}>‹</Text>
        </Pressable>
        <View style={styles.navSpacer} />
      </View>

      <Text style={styles.kicker}>{C.kicker}</Text>
      <Text style={styles.title}>{C.title}</Text>
      <Text style={styles.lede}>{C.lede}</Text>

      {HUB_CARDS.map((card) => (
        <Card
          key={card.testID}
          testID={card.testID}
          onPress={() => router.push(card.route)}
          accessibilityLabel={`${card.title}. Button.`}
          style={{ marginBottom: spacing.md }}
        >
          <View style={styles.cardRow}>
            <View style={styles.grow}>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardBody}>{card.body}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </View>
        </Card>
      ))}

      <Text style={styles.disclaimer}>{LABOR_DISCLAIMER}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topnav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouch,
    marginHorizontal: -spacing.xs,
  },
  navSpacer: { width: minTouch },
  iconBtn: {
    width: minTouch,
    height: minTouch,
    borderRadius: minTouch / 2,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 22, fontWeight: '600', lineHeight: 24, color: colors.ink },
  kicker: {
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: colors.coralDeep,
    marginTop: spacing.sm,
    marginBottom: 6,
    marginHorizontal: 2,
  } as TextStyle,
  title: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: '600',
    lineHeight: 32,
    color: colors.ink,
    marginBottom: 6,
  } as TextStyle,
  lede: {
    fontSize: 15,
    lineHeight: 23,
    color: '#5C554D',
    marginBottom: spacing.lg,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  cardBody: { fontSize: 14, lineHeight: 22, color: '#5C554D' },
  chev: { fontSize: 20, fontWeight: '600', color: colors.muted },
  disclaimer: {
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xl,
    marginHorizontal: 2,
  } as TextStyle,
});
