/**
 * Briefing screen — the Home tab (v1.1: rules engine).
 *
 * Renders the engine's ordered plan (`briefing.slots`) as compact
 * expandable rows: timely cards, the 4 routine cards (baby → body →
 * know → tips), the "New this week" heads-up, a quiet "A little wonder"
 * divider, the 3 delight cards, and the quiet-day look-back teaser.
 * Tapping a row expands its full text in place; accordion — only one row
 * open at a time.
 *
 * Cards only — no composer, no mic, no input of any kind; nothing tappable
 * except the rows themselves and the tab bar.
 *
 * Consumes `useBriefing()` (owned by the refresh-logic agent) for the real
 * data; the tab agent's new app/(tabs)/index.tsx renders this component.
 * Slot order, selection, and curation all live in ./engine.ts + ./matrix.ts
 * — this screen only renders.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Screen from '../components/Screen';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import { colors, fontDisplay, radii, shadow, spacing, type as typeScale } from '../theme/tokens';
import { useOnboarding } from '../onboarding/useOnboarding';
import { useBriefing } from './useBriefing';
import { useBriefingTestOverride } from './testSeam';
import { isAfterwards } from './afterwards';
import AfterwardsHome from '../support/AfterwardsHome';
import type { DelightBody } from './delight';
import type { Briefing, PlanSlot } from './types';

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

/** One compact row on screen: every engine slot renders through this shape. */
interface RowCard {
  id: string;
  title: string;
  preview: string;
  body: ReactNode;
  tint: string;
  glyph: string;
  glyphColor: string;
  testID: string;
}

function DelightBodyText({ body }: { body: DelightBody }) {
  return (
    <>
      {body.map((para, i) => (
        <Text
          key={i}
          style={[styles.btxt, i === body.length - 1 && styles.btxtLast]}
        >
          {para.map((run, j) => (
            <Text key={j} style={run.bold ? styles.bold : undefined}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
    </>
  );
}

/** An engine plan slot → one compact row. Slots arrive ordered; the screen never reorders. */
function slotRow(slot: PlanSlot): RowCard {
  return {
    id: slot.slotId,
    title: slot.title,
    preview: slot.preview,
    body: <DelightBodyText body={slot.body} />,
    tint: slot.tint,
    glyph: slot.glyph,
    glyphColor: slot.glyphColor,
    testID: slot.testID,
  };
}

function ExpandableRow({
  card,
  open,
  onToggle,
}: {
  card: RowCard;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <View testID={card.testID} style={styles.row}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${card.title}. ${open ? 'Collapse' : 'Expand'}`}
        style={styles.rowHead}
      >
        <View style={[styles.tile, { backgroundColor: card.tint }]}>
          <Text style={[styles.tileGlyph, { color: card.glyphColor }]}>
            {card.glyph}
          </Text>
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{card.title}</Text>
          <Text
            style={styles.rowPreview}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {card.preview}
          </Text>
        </View>
        <Text style={[styles.chev, open && styles.chevOpen]}>{'›'}</Text>
      </Pressable>
      {open && <View style={styles.rowBody}>{card.body}</View>}
    </View>
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

function WonderDivider() {
  return (
    <View testID="briefing-wonder-divider" style={styles.wonder}>
      <View style={styles.wonderLine} />
      <Text style={styles.wonderText}>A little wonder</Text>
      <View style={styles.wonderLine} />
    </View>
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
      {`Not medical advice · Content updated ${monthYear(reviewDate)}`}
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

/** Briefing screen: the Home tab. No props. */
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

  const [openId, setOpenId] = useState<string | null>(null);

  // Slots arrive fully ordered from the engine (via useBriefing/policy);
  // the screen renders them as-is, inserting the "A little wonder"
  // divider before the first delight slot.
  const rows: RowCard[] = useMemo(() => {
    if (!effBriefing) return [];
    return effBriefing.slots.map(slotRow);
  }, [effBriefing]);

  const firstDelightIdx = useMemo(() => {
    if (!effBriefing) return -1;
    return effBriefing.slots.findIndex((s) => s.section === 'delight');
  }, [effBriefing]);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenId((cur) => (cur === id ? null : id));
  };

  if (onboardingLoading && !override) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  // Epic 9 (changed-outcome mode): a stopped pregnancy renders the afterwards
  // state — her memories and gentle support, never developmental content.
  // This branch takes precedence over the empty state below.
  if (isAfterwards()) {
    return (
      <Screen testID="briefing-root">
        <AfterwardsHome />
      </Screen>
    );
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
            {rows.map((card, i) => (
              <Fragment key={card.id}>
                {i === firstDelightIdx && <WonderDivider />}
                <ExpandableRow
                  card={card}
                  open={openId === card.id}
                  onToggle={() => toggle(card.id)}
                />
              </Fragment>
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
  // Compact expandable row (routine + delight share this component).
  row: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    marginTop: spacing.md,
    overflow: 'hidden',
    ...shadow.card,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
    paddingHorizontal: 15,
    minHeight: 64,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  tileGlyph: {
    fontSize: 21,
    lineHeight: 24,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15.5,
    fontWeight: '700',
    color: colors.ink,
  },
  rowPreview: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  chev: {
    fontSize: 19,
    fontWeight: '600',
    color: colors.muted,
    marginLeft: 8,
    transform: [{ rotate: '90deg' }],
  },
  chevOpen: {
    transform: [{ rotate: '-90deg' }],
  },
  rowBody: {
    paddingHorizontal: 15,
    paddingBottom: 16,
    paddingTop: 2,
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
  bold: {
    fontWeight: '700',
    color: colors.ink,
  },
  // "A little wonder" divider between routine and delight.
  wonder: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    marginHorizontal: 4,
  },
  wonderLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  wonderText: {
    fontSize: 11.5,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginHorizontal: 10,
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
