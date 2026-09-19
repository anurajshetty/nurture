/**
 * Epic 9 — Home, afterwards (contract C3).
 *
 * Rendered by BriefingScreen when `pregnancy.status === 'stopped'`.
 * Holds NO developmental content: no week numbers, no size comparisons,
 * no tips, no celebratory copy. Her timeline stays as memories; the
 * "Gentle reads" module takes the briefing's place.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, radii, shadow, spacing, fontDisplay, type as typeScale } from '../theme/tokens';
import GentleReadsCard from './GentleReadsCard';
import { GENTLE_READ_COMING_SOON } from './gentleReads';
import { countMoments } from './aftermath';
import {
  AFTERWARDS_KICK,
  AFTERWARDS_LEDE_EMPTY,
  AFTERWARDS_LEDE_WITH_MEMORIES,
  AFTERWARDS_QUIET_NOTE,
  AFTERWARDS_SETTINGS_SUB,
  AFTERWARDS_SETTINGS_TITLE,
  AFTERWARDS_TIMELINE_SUB,
  AFTERWARDS_TITLE,
} from './afterwardsCopy';

export default function AfterwardsHome() {
  const [moments, setMoments] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      setMoments(countMoments());
    } catch {
      // Count unreadable — the screen still renders without the timeline row.
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const momentWord = moments === 1 ? 'moment' : 'moments';

  return (
    <View testID="afterwards-home" style={styles.root}>
      <Text testID="afterwards-title" style={styles.title} accessibilityRole="header">
        {AFTERWARDS_TITLE}
      </Text>
      <Text testID="afterwards-lede" style={styles.lede}>
        {moments > 0 ? AFTERWARDS_LEDE_WITH_MEMORIES : AFTERWARDS_LEDE_EMPTY}
      </Text>

      {moments > 0 ? (
        <Pressable
          testID="afterwards-timeline-row"
          onPress={() => router.push('/logs')}
          accessibilityRole="button"
          accessibilityLabel={`Timeline, ${moments} ${momentWord}. Open your timeline.`}
          style={({ pressed }) => [styles.setrow, pressed && styles.pressed]}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Timeline · {moments} {momentWord}</Text>
            <Text style={styles.rowSub}>{AFTERWARDS_TIMELINE_SUB}</Text>
          </View>
          <Text style={styles.chev} accessibilityElementsHidden>
            ›
          </Text>
        </Pressable>
      ) : null}

      <Text testID="afterwards-kick" style={styles.kick}>
        {AFTERWARDS_KICK}
      </Text>

      <GentleReadsCard onOpenRead={() => setToast(GENTLE_READ_COMING_SOON)} />

      <View testID="afterwards-quiet-note" style={styles.quietNote}>
        <Text style={styles.quietNoteText}>{AFTERWARDS_QUIET_NOTE}</Text>
      </View>

      <Pressable
        testID="afterwards-settings-row"
        onPress={() => router.push('/you')}
        accessibilityRole="button"
        accessibilityLabel="App settings. Notifications, privacy, your data."
        style={({ pressed }) => [styles.setrow, pressed && styles.pressed]}
      >
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{AFTERWARDS_SETTINGS_TITLE}</Text>
          <Text style={styles.rowSub}>{AFTERWARDS_SETTINGS_SUB}</Text>
        </View>
        <Text style={styles.chev} accessibilityElementsHidden>
          ›
        </Text>
      </Pressable>

      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingTop: spacing.sm,
  },
  title: {
    fontFamily: fontDisplay,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  lede: {
    fontSize: 15,
    lineHeight: 24,
    color: '#5C554D',
    marginBottom: spacing.md,
  },
  kick: {
    fontSize: 12,
    letterSpacing: 1.44,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  setrow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.md,
    paddingHorizontal: 16,
    marginBottom: spacing.sm,
    minHeight: 64,
    ...shadow.card,
  },
  pressed: {
    opacity: 0.7,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  rowSub: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 3,
    lineHeight: 19,
  },
  chev: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.muted,
    marginLeft: spacing.sm,
  },
  quietNote: {
    backgroundColor: colors.sageTint,
    borderRadius: 16,
    padding: 13,
    paddingHorizontal: 15,
    marginBottom: spacing.md,
  },
  quietNoteText: {
    fontSize: 13.5,
    lineHeight: 21,
    color: '#4C5A4B',
  },
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 120,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  toast: {
    backgroundColor: colors.ink,
    borderRadius: radii.chip,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    maxWidth: 340,
  },
  toastText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
