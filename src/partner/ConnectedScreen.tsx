/**
 * Partner sharing — connected confirmation (mockup 33, screen ③).
 *
 * Shown right after the partner redeems a valid code. The partner view
 * itself is still being built; this screen says so plainly.
 */

import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components';
import { colors, radii, shadow, spacing, type as typeScale } from '../theme/tokens';

export default function ConnectedScreen({ onDone }: { onDone: () => void }) {
  return (
    <View style={styles.wrap} testID="partner-connected">
      <View style={styles.card}>
        <View style={styles.check}>
          <Text style={styles.checkGlyph} accessibilityLabel="">
            ✓
          </Text>
        </View>
        <Text style={styles.h3} accessibilityRole="header">
          You're connected
        </Text>
        <Text style={styles.body}>
          You're linked up with your partner's Willow. The partner view is still being built —
          shared moments will appear here when it lands.
        </Text>
      </View>
      <View style={styles.spacer} />
      <Button title="Done" onPress={onDone} testID="partner-connected-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xxl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.xxxl,
    alignItems: 'center',
    ...shadow.card,
  },
  check: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  checkGlyph: { fontSize: 34, color: colors.sageDeep, fontWeight: '700' },
  h3: { ...typeScale.title, color: colors.ink, textAlign: 'center' },
  body: { ...typeScale.body, color: colors.muted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22 },
  spacer: { flex: 1, minHeight: spacing.lg },
});
