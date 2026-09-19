/**
 * Briefing screen (track 2: briefing UI) — the new Home tab.
 *
 * Renders the week-aware morning briefing: Baby's development → Your body
 * this week → Good to know → Tips. Cards only — no composer, no mic, no
 * input of any kind; nothing tappable except the tab bar.
 *
 * Consumes `useBriefing()` (owned by the refresh-logic agent) for the real
 * data; the tab agent's new app/(tabs)/index.tsx renders this component.
 */

import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Screen from '../components/Screen';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import { colors, fontDisplay, radii, shadow, spacing, type as typeScale } from '../theme/tokens';
import { useOnboarding } from '../onboarding/useOnboarding';
import { useBriefing } from './useBriefing';
import { useBriefingTestOverride } from './testSeam';
import type { Briefing, BriefingCard } from './types';

/** Card order is fixed (Anuraj's choice): baby → body → know → tips. */
const CARD_ORDER = ['baby', 'body', 'know', 'tips'] as const;

/** Lilac tint for the "Good to know" tile — matches the 09-home mockup. */
const LILAC_TINT = '#EFEAF7';
/** Darker gold for the glyph on the gold tile (readable on tint). */
const GOLD_DEEP = '#96771B';

const TILE_BY_CARD: Record<BriefingCard['id'], { tint: string; glyph: string; glyphColor: string }> = {
  baby: { tint: colors.goldTint, glyph: '❀', glyphColor: GOLD_DEEP },
  body: { tint: colors.blush, glyph: '♥', glyphColor: colors.coralDeep },
  know: { tint: LILAC_TINT, glyph: '✎', glyphColor: colors.lilac },
  tips: { tint: colors.sageTint, glyph: '☀', glyphColor: colors.sageDeep },
};

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-15" → "Aug 2026" (mockup style); falls back to the raw value. */
function monthYear(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateStr);
  if (!m) return dateStr;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : dateStr;
}

function orderedCards(cards: BriefingCard[]): BriefingCard[] {
  return [...cards].sort(
    (a, b) => CARD_ORDER.indexOf(a.id) - CARD_ORDER.indexOf(b.id),
  );
}

function Header({ briefing }: { briefing: Briefing }) {
  const weeksToGo = Math.max(0, 40 - briefing.week);
  const weekWord = weeksToGo === 1 ? 'week' : 'weeks';
  const today = localDateString(new Date());
  const updated = briefing.generatedForDate === today ? 'today' : 'yesterday';
  return (
    <View testID="briefing-header" style={styles.header}>
      <Text style={styles.eyebrow}>
        {`WEEK ${briefing.week} · DAY ${briefing.day} · ${weeksToGo} ${weekWord.toUpperCase()} TO GO`}
      </Text>
      <Text style={styles.title}>{"What's happening this week"}</Text>
      <Text testID="briefing-updated" style={styles.subtitle}>
        {`A fresh briefing every morning · Updated ${updated}`}
      </Text>
    </View>
  );
}

function BriefingCardView({ card }: { card: BriefingCard }) {
  const tile = TILE_BY_CARD[card.id];
  return (
    <Card testID={`briefing-card-${card.id}`} style={styles.bcard}>
      <View style={styles.bhead}>
        <View style={[styles.tile, { backgroundColor: tile.tint }]}>
          <Text style={[styles.tileGlyph, { color: tile.glyphColor }]}>{tile.glyph}</Text>
        </View>
        <View style={styles.bheadText}>
          <Text style={styles.btitle}>{card.title}</Text>
          <Text style={styles.bsub}>{card.subtitle}</Text>
        </View>
      </View>
      {card.body.map((para, i) => (
        <Text
          key={i}
          style={[styles.btxt, i === card.body.length - 1 && styles.btxtLast]}
        >
          {para}
        </Text>
      ))}
    </Card>
  );
}

function OfflineBanner() {
  return (
    <View testID="briefing-offline-banner" style={styles.offline}>
      <View style={styles.offlineTile}>
        <Text style={styles.offlineGlyph}>☁</Text>
      </View>
      <Text style={styles.offlineText}>
        <Text style={styles.offlineBold}>{"You're offline"}</Text>
        {" — showing yesterday's briefing.\nIt'll refresh on its own when you're back."}
      </Text>
    </View>
  );
}

function Disclaimer({ reviewDate }: { reviewDate: string }) {
  return (
    <Text testID="briefing-disclaimer" style={styles.disclaimer}>
      {`Not medical advice · Reviewed ${monthYear(reviewDate)}`}
    </Text>
  );
}

function SkeletonBlock({ width, height }: { width: number | `${number}%`; height: number }) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.skelLine, { width, height, opacity }]} />;
}

function GeneratingView() {
  return (
    <View testID="briefing-generating">
      <View style={styles.genMsg}>
        <ActivityIndicator size="large" color={colors.coral} />
        <View style={styles.genText}>
          <Text style={styles.genTitle}>Putting your week together</Text>
          <Text style={styles.genSub}>This takes a moment — your briefing will appear here.</Text>
        </View>
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skelCard}>
          <SkeletonBlock width="55%" height={20} />
          <SkeletonBlock width="100%" height={14} />
          <SkeletonBlock width="88%" height={14} />
          {i !== 1 && <SkeletonBlock width="94%" height={14} />}
        </View>
      ))}
    </View>
  );
}

function EmptyView({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      testID="briefing-empty"
      glyph="❀"
      title="Your briefing will appear here"
      copy="A fresh briefing arrives every morning, made for your week of pregnancy."
    >
      <Button testID="briefing-retry" title="Try again" variant="ghost" onPress={onRetry} />
    </EmptyState>
  );
}

/** Briefing screen: the new Home tab. No props. */
export function BriefingScreen() {
  const { status, briefing, retry } = useBriefing();
  const { loading: onboardingLoading, pregnancy } = useOnboarding();
  // Test-only: the interactive test route wraps this screen in the override
  // provider so window.__briefingTest can force each state. Null in prod.
  const override = useBriefingTestOverride();

  const effStatus = override?.status ?? status;
  const effBriefing = override ? override.briefing : briefing;
  // Test override bypasses the due-date gate; the real flow never sets one.
  const hasDueDate = !!pregnancy?.dueDate || !!override;

  if (onboardingLoading && !override) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  // No due date → warm empty state, never a crash.
  if (!hasDueDate) {
    return (
      <Screen testID="briefing-root">
        <EmptyView onRetry={retry} />
      </Screen>
    );
  }

  if (effStatus === 'generating' || effStatus === 'live' || effStatus === 'offline') {
    if (!effBriefing) {
      // Nothing cached yet — skeletons while the first briefing builds.
      return (
        <Screen testID="briefing-root">
          {effStatus === 'generating' ? <GeneratingView /> : <EmptyView onRetry={retry} />}
        </Screen>
      );
    }
    return (
      <Screen testID="briefing-root">
        <Header briefing={effBriefing} />
        {effStatus === 'offline' && <OfflineBanner />}
        {effStatus === 'generating' ? (
          <GeneratingView />
        ) : (
          <>
            {orderedCards(effBriefing.cards).map((card) => (
              <BriefingCardView key={card.id} card={card} />
            ))}
            <Disclaimer reviewDate={effBriefing.reviewDate} />
          </>
        )}
      </Screen>
    );
  }

  // 'empty'
  return (
    <Screen testID="briefing-root">
      <EmptyView onRetry={retry} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing.sm,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.44,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginBottom: spacing.sm - 2,
  },
  title: {
    fontFamily: fontDisplay,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: spacing.sm - 2,
  },
  subtitle: {
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  bcard: {
    marginTop: spacing.md,
    padding: 18,
    borderRadius: radii.cardLarge,
  },
  bhead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tile: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  tileGlyph: {
    fontSize: 22,
    lineHeight: 26,
  },
  bheadText: {
    flex: 1,
  },
  btitle: {
    ...typeScale.headline,
    color: colors.ink,
  },
  bsub: {
    ...typeScale.footnote,
    color: colors.muted,
    marginTop: 2,
  },
  btxt: {
    fontSize: 14.5,
    lineHeight: 23,
    color: '#5C554D',
    marginBottom: 10,
  },
  btxtLast: {
    marginBottom: 0,
  },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sageTint,
    borderRadius: 18,
    padding: 13,
    paddingHorizontal: spacing.lg,
    marginTop: 14,
    marginBottom: spacing.xs,
    ...shadow.card,
  },
  offlineTile: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  offlineGlyph: {
    fontSize: 20,
    color: colors.sageDeep,
  },
  offlineText: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 20,
    color: '#4C5A4B',
  },
  offlineBold: {
    fontWeight: '700',
    color: colors.sageDeep,
  },
  disclaimer: {
    ...typeScale.footnote,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 22,
    marginHorizontal: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 14,
  },
  genMsg: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.cardLarge,
    padding: 18,
    marginTop: 14,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  genText: {
    flex: 1,
    marginLeft: 13,
  },
  genTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  genSub: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    marginTop: 3,
  },
  skelCard: {
    backgroundColor: colors.card,
    borderRadius: radii.cardLarge,
    padding: 18,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  skelLine: {
    borderRadius: 10,
    backgroundColor: colors.blush,
    marginBottom: spacing.sm,
  },
});
