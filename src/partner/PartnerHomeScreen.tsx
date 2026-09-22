/**
 * Partner home (mockup 34, Anuraj approved Sept 2026).
 *
 * The partner's resting state, replacing the old "You're connected"
 * screen: "{her name}'s journey" — a quiet at-a-glance strip, then every
 * shared entry newest-first with her Logs day grouping. Read-only,
 * except one warm interaction: a single heart per card.
 *
 * Card parity (Anuraj, Sept 2026): partner cards render the SAME
 * EventCard the Logs feed uses — same container, same meta row, same
 * body sections, same day-grouping (buildPartnerSections delegates to
 * the feed's buildDaySections; DayGroupHeader is shared). The ONLY
 * partner-side difference is the heart in the top-right corner
 * (EventCard partnerMode). Never a divergent card renderer here.
 *
 * Data: get_shared_events() (visible entries only) + get_my_loves()
 * intersected at render + my_partner_link_status() (distinguishes
 * "Nothing shared yet" from the paused empty state).
 *
 * The glance strip re-derives from the visible entries on every render,
 * so unsharing/deleting/pausing updates it too.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Circle, Path, Svg } from 'react-native-svg';
import { colors, spacing, type as typeScale } from '../theme/tokens';
import { kvGet, kvSet } from '../lib/db';
import { defaultRpc } from './inviteCodes';
import {
  buildAtAGlance,
  buildPartnerSections,
  getMyLoves,
  getPartnerLinkStatus,
  getPartnerMyName,
  getPartnerOwnerName,
  getSharedEvents,
  myLoveLabel,
  toggleEntryLove,
  type PartnerSharedEvent,
} from './partnerHome';
import EventCard from '../composer/EventCard';
import DayGroupHeader from '../timeline/DayGroupHeader';
import { useTimezoneVersion } from '../time/timezone';

/* ------------------------------------------------------------------ */
/* At a glance — quiet strip, NOT a card                                */
/* ------------------------------------------------------------------ */

function GlanceStrip({ events, ownerName }: { events: PartnerSharedEvent[]; ownerName: string }) {
  // Timezone-change reactivity (Anuraj, Sept 2026): at-a-glance times and
  // day labels recompute when the device zone changes mid-session.
  const tzVersion = useTimezoneVersion();
  const glance = useMemo(() => buildAtAGlance(events, ownerName), [events, ownerName, tzVersion]);
  const second = glance.highlightLine ? `${glance.nextUpLine} · ${glance.highlightLine}` : glance.nextUpLine;
  return (
    <View style={styles.glance} accessibilityRole="summary" testID="partner-glance">
      <View style={styles.glanceIcon}>
        <Svg viewBox="0 0 24 24" width={24} height={24} stroke={colors.coralDeep}>
          <Circle cx="12" cy="12" r="4.2" fill="none" strokeWidth={1.8} />
          <Path
            d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"
            fill="none"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </Svg>
      </View>
      <View style={styles.glanceLines}>
        <Text style={styles.glanceMood}>{glance.moodLine}</Text>
        <Text style={styles.glanceSub}>{second}</Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Empty states                                                         */
/* ------------------------------------------------------------------ */

function EmptyState({ kind, ownerName }: { kind: 'paused' | 'empty'; ownerName: string }) {
  const name = ownerName.trim() || 'your partner';
  return (
    <View style={styles.empty} testID={kind === 'paused' ? 'partner-empty-paused' : 'partner-empty'}>
      <View style={styles.emptyRing}>
        <Svg viewBox="0 0 24 24" width={32} height={32} stroke={colors.coralDeep}>
          <Path
            d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"
            fill="none"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      {kind === 'paused' ? (
        <>
          <Text style={styles.emptyTitle}>Sharing is paused for now</Text>
          <Text style={styles.emptyBody}>
            {name} has turned off sharing for you for a little while. Nothing is lost — when sharing
            is turned back on, the shared moments return here. This space is yours whenever it's
            ready.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.emptyTitle}>Nothing shared yet</Text>
          <Text style={styles.emptyBody}>
            When {name} marks moments as shared, they'll appear here — a little window into the
            journey, made just for you.
          </Text>
        </>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* The screen                                                             */
/* ------------------------------------------------------------------ */

type LoadState = 'loading' | 'ready' | 'error';

export default function PartnerHomeScreen() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [events, setEvents] = useState<PartnerSharedEvent[]>([]);
  const [loved, setLoved] = useState<Record<string, boolean>>({});
  const [sharingEnabled, setSharingEnabled] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ownerName] = useState(() => getPartnerOwnerName({ get: kvGet, set: kvSet }));
  const [myName] = useState(() => getPartnerMyName({ get: kvGet, set: kvSet }));

  // Timezone-change reactivity (Anuraj, Sept 2026): a PST → EST trip while
  // the app is open recomputes day-groups and at-a-glance times below.
  const tzVersion = useTimezoneVersion();

  const load = useCallback(async () => {
    const rpc = defaultRpc();
    const [shared, loves, link] = await Promise.all([
      getSharedEvents(rpc),
      getMyLoves(rpc),
      getPartnerLinkStatus(rpc),
    ]);
    if (shared.status !== 'ok') {
      setLoadState('error');
      return;
    }
    const loveSet = new Set(loves.status === 'ok' ? loves.entryIds : []);
    setEvents(shared.events.map((e) => ({ ...e, lovedByMe: loveSet.has(e.id) })));
    const next: Record<string, boolean> = {};
    for (const id of loveSet) next[id] = true;
    setLoved(next);
    setSharingEnabled(link.status === 'ok' ? link.sharingEnabled : true);
    setLoadState('ready');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  /**
   * Optimistic heart: the heart fills immediately; if the server rejects
   * (she unshared it, paused sharing, the link is gone), the heart rolls
   * back and the feed reloads so the glance reflects her current choices.
   */
  const onToggleLove = useCallback(
    async (id: string) => {
      const prev = loved[id] ?? false;
      setLoved((cur) => ({ ...cur, [id]: !prev }));
      const res = await toggleEntryLove(id, defaultRpc());
      if (res.status === 'ok') {
        setLoved((cur) => ({ ...cur, [id]: res.loved }));
        setEvents((cur) => cur.map((e) => (e.id === id ? { ...e, lovedByMe: res.loved } : e)));
      } else {
        setLoved((cur) => ({ ...cur, [id]: prev }));
        void load();
      }
    },
    [loved, load],
  );

  /**
   * The feed's day-grouping, reused — entries group by the local calendar
   * day they were LOGGED (buildPartnerSections → buildDaySections), so a
   * tomorrow-scheduled appointment logged today sits under "Today" just
   * like her feed. Labels are the feed's own "Today" / "Yesterday" /
   * "Weekday, Mon D" via the shared DayGroupHeader.
   */
  const sections = useMemo(() => buildPartnerSections(events), [events, tzVersion]);

  /** Loved state per entry id: optimistic toggle wins over the RPC's lovedByMe. */
  const loveById = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const e of events) m.set(e.id, loved[e.id] ?? e.lovedByMe);
    return m;
  }, [events, loved]);

  const displayName = ownerName.trim();
  const title = displayName ? `${displayName}'s journey` : 'The journey';
  const trimmedName = (myName ?? '').trim();

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      testID="partner-home">
      <View style={styles.pageHead}>
        <Text style={styles.kicker}>Willow</Text>
        <Text style={styles.h2} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.lede}>The moments she's shared with you — newest first.</Text>
      </View>

      {loadState === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : loadState === 'error' ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn't load the journey</Text>
          <Text style={styles.errorBody}>Check your connection and pull to try again.</Text>
        </View>
      ) : sections.length === 0 ? (
        <EmptyState kind={sharingEnabled ? 'empty' : 'paused'} ownerName={ownerName} />
      ) : (
        <>
          <GlanceStrip events={events} ownerName={ownerName} />
          {sections.map((s) => (
            <View key={s.key}>
              <DayGroupHeader section={s} />
              {s.data.map((item) => {
                const isLoved = loveById.get(item.id) ?? false;
                return (
                  <EventCard
                    key={item.id}
                    event={item}
                    partnerMode
                    loved={isLoved}
                    partnerLoveText={
                      isLoved ? (trimmedName ? myLoveLabel(trimmedName) : 'Loved') : ''
                    }
                    onToggleLove={onToggleLove}
                  />
                );
              })}
            </View>
          ))}
          <Text style={styles.footer}>
            Only {displayName || 'your partner'} can add or remove moments here. You're her guest —
            enjoy the view.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xxxl },
  pageHead: { marginBottom: spacing.sm },
  kicker: {
    ...typeScale.footnote,
    fontWeight: '700',
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    color: colors.coralDeep,
  },
  h2: { ...typeScale.display, color: colors.ink, marginTop: spacing.xs },
  lede: { ...typeScale.body, color: colors.muted, marginTop: spacing.xs },
  center: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  errorTitle: { ...typeScale.title, color: colors.ink, textAlign: 'center' },
  errorBody: { ...typeScale.body, color: colors.muted, textAlign: 'center', marginTop: spacing.sm },
  /* Glance: quiet and transparent — not a card. */
  glance: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.md },
  glanceIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.blush,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  glanceLines: { flex: 1 },
  glanceMood: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.ink },
  glanceSub: { fontSize: 14, lineHeight: 22, color: colors.muted, marginTop: 4 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxxl },
  emptyRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.blush,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: { ...typeScale.title, color: colors.ink, textAlign: 'center' },
  emptyBody: { ...typeScale.body, color: colors.muted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22 },
  footer: {
    ...typeScale.footnote,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xxl,
    lineHeight: 20,
  },
});
