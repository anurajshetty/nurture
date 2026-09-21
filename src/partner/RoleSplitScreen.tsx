/**
 * Partner sharing — welcome role split (mockup 33, screen ①).
 *
 * Comes before onboarding step 0: two big options — "I'm pregnant" and
 * "I'm a partner". Tapping one shows a quiet note about where it leads;
 * the parent decides when to advance. Gender-neutral throughout: the
 * partner is "your partner", never he/she.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, shadow, spacing, type as typeScale } from '../theme/tokens';
import type { OnboardingRole } from './inviteCodes';

export default function RoleSplitScreen({ onSelect }: { onSelect: (role: OnboardingRole) => void }) {
  const [picked, setPicked] = useState<OnboardingRole | null>(null);

  const pick = (role: OnboardingRole) => {
    setPicked(role);
    onSelect(role);
  };

  return (
    <View style={styles.wrap} testID="role-split">
      <Text style={styles.kicker}>Willow</Text>
      <Text style={styles.h1} accessibilityRole="header">
        Who's joining?
      </Text>
      <Text style={styles.lede}>A little different for each of you — pick the one that fits.</Text>

      <Pressable
        onPress={() => pick('mom')}
        accessibilityRole="button"
        accessibilityLabel="I'm pregnant"
        style={({ pressed }) => [
          styles.rolecard,
          picked === 'mom' && styles.rolecardSel,
          pressed && styles.pressed,
        ]}
        testID="role-split-mom"
      >
        <View style={[styles.ric, { backgroundColor: colors.blush }]}>
          <Text style={styles.ricGlyph} accessibilityLabel="">
            ○
          </Text>
        </View>
        <View style={styles.rtext}>
          <Text style={styles.rtitle}>I'm pregnant</Text>
          <Text style={styles.rsub}>Your journal, your week, your story.</Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => pick('partner')}
        accessibilityRole="button"
        accessibilityLabel="I'm a partner"
        style={({ pressed }) => [
          styles.rolecard,
          picked === 'partner' && styles.rolecardSel,
          pressed && styles.pressed,
        ]}
        testID="role-split-partner"
      >
        <View style={[styles.ric, { backgroundColor: colors.sageTint }]}>
          <Text style={[styles.ricGlyph, { color: colors.sageDeep }]} accessibilityLabel="">
            ∞
          </Text>
        </View>
        <View style={styles.rtext}>
          <Text style={styles.rtitle}>I'm a partner</Text>
          <Text style={styles.rsub}>Connect with your partner's invite code and follow along.</Text>
        </View>
      </Pressable>

      {picked === 'mom' ? (
        <Text style={styles.note} testID="role-split-note-mom">
          That's you — you'll continue into setup just as Willow works today.
        </Text>
      ) : null}
      {picked === 'partner' ? (
        <Text style={styles.note} testID="role-split-note-partner">
          Welcome in. You'll enter the invite code your partner shared with you next.
        </Text>
      ) : null}

      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  kicker: {
    ...typeScale.footnote,
    color: colors.coralDeep,
    textTransform: 'uppercase',
    letterSpacing: 2,
    fontWeight: '700',
  },
  h1: { ...typeScale.title, color: colors.ink, marginTop: spacing.xs },
  lede: { ...typeScale.body, color: colors.muted, marginTop: spacing.xs, lineHeight: 22 },
  rolecard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginTop: spacing.md,
    minHeight: 96,
    ...shadow.card,
  },
  rolecardSel: { borderColor: colors.coralDeep, borderWidth: 1.5, backgroundColor: '#FDF6F1' },
  pressed: { opacity: 0.96 },
  ric: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ricGlyph: { fontSize: 24, color: colors.coralDeep },
  rtext: { flex: 1 },
  rtitle: { ...typeScale.headline, color: colors.ink, fontWeight: '700' },
  rsub: { ...typeScale.body, color: colors.muted, marginTop: 2, lineHeight: 20 },
  note: {
    ...typeScale.body,
    color: colors.sageDeep,
    backgroundColor: colors.sageTint,
    borderRadius: radii.card,
    padding: spacing.sm,
    marginTop: spacing.md,
    lineHeight: 21,
  },
  spacer: { flex: 1, minHeight: spacing.lg },
});
