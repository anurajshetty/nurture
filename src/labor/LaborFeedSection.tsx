/**
 * Labor activity feed cards (Willow, mockup 32 rev 2 — Anuraj approved
 * Sept 21, 2026).
 *
 * Rendered inside the timeline EventCard for 'activity' events: the
 * kicker is "Activity" (EventCard's TYPE_META); the card itself names
 * which activity it is (ACTIVITY_NAMES) with the summary sub line from
 * the pure formatters in ./feed, plus the provider line ONLY on
 * contraction-timing cards (Anuraj's call — breathing and pelvic-floor
 * cards are pure activity records, paralleling the kick card).
 *
 * A feed card must never crash the list: malformed payloads render
 * nothing (the forgiving reader in ./feed returns null).
 */

import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import type { LocalEvent } from '../lib/types';
import {
  ACTIVITY_NAMES,
  activityProviderLine,
  activitySub,
  readActivityCard,
} from './feed';

export default function LaborFeedSection({ event }: { event: LocalEvent }) {
  let main: string | null = null;
  let sub: string | null = null;
  let provider: string | null = null;

  try {
    const card = readActivityCard(event.data);
    if (!card) return null;
    main = ACTIVITY_NAMES[card.activityKind];
    sub = activitySub(card);
    provider = activityProviderLine(card);
  } catch {
    return null;
  }

  return (
    <View testID={`labor-feed-${event.id}`}>
      <Text style={styles.main}>{main}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      {provider ? <Text style={styles.provider}>{provider}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  main: {
    fontSize: 15.5,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 23,
    marginTop: spacing.xs,
  },
  sub: {
    fontSize: 13.5,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 20,
  },
  provider: {
    fontSize: 12.5,
    color: colors.muted,
    marginTop: spacing.sm,
    lineHeight: 19,
  },
});
