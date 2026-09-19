/**
 * Epic 9 — "Gentle reads" card for the afterwards Home.
 *
 * The compassionate support module that takes the weekly briefing's place
 * once the pregnancy has stopped. Titles are placeholders for the reviewed
 * content pack (see gentleReads.ts) — rows are tappable but open nothing
 * yet; the parent shows one honest line instead.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, shadow, spacing, type as typeScale } from '../theme/tokens';
import { GENTLE_READS, GENTLE_READS_INTRO } from './gentleReads';

const GLYPHS = ['◍', '♡', '✦'];

export default function GentleReadsCard({
  onOpenRead,
}: {
  /** Fired when a read row is tapped (content is placeholder — nothing opens). */
  onOpenRead?: (readId: string) => void;
}) {
  return (
    <View testID="gentle-reads-card" style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">
        Gentle reads
      </Text>
      <Text style={styles.intro}>{GENTLE_READS_INTRO}</Text>
      <View style={styles.rows}>
        {GENTLE_READS.map((read, i) => (
          <Pressable
            key={read.id}
            testID={`gentle-read-row-${read.id}`}
            onPress={() => onOpenRead?.(read.id)}
            accessibilityRole="button"
            accessibilityLabel={`${read.title}. ${read.blurb}`}
            style={({ pressed }) => [styles.row, i > 0 && styles.rowBorder, pressed && styles.pressed]}
          >
            <View style={styles.glyphTile} accessibilityElementsHidden>
              <Text style={styles.glyph}>{GLYPHS[i % GLYPHS.length]}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{read.title}</Text>
              <Text style={styles.rowBlurb}>{read.blurb}</Text>
            </View>
            <Text style={styles.chev} accessibilityElementsHidden>
              ›
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.cardLarge,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 18,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  intro: {
    ...typeScale.subhead,
    color: '#5C554D',
    lineHeight: 21,
    marginBottom: spacing.sm,
  },
  rows: {
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  pressed: {
    opacity: 0.7,
  },
  glyphTile: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  glyph: {
    fontSize: 17,
    color: colors.sageDeep,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: colors.ink,
  },
  rowBlurb: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 18,
  },
  chev: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.muted,
    marginLeft: spacing.sm,
  },
});
