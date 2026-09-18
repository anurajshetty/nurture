import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { colors, spacing } from '../theme/tokens';

type SectionHeaderProps = {
  title: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
};

/** Small-caps coral-deep kicker that opens each settings section. */
export default function SectionHeader({ title, style, testID }: SectionHeaderProps) {
  return (
    <Text testID={testID} style={[styles.kicker, style]} accessibilityRole="header">
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  kicker: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: colors.coralDeep,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
});
