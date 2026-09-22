/**
 * Partner home (mockup 34, Anuraj approved Sept 2026).
 *
 * The partner's resting state, replacing the old "You're connected"
 * screen: "{her name}'s journey" — a quiet at-a-glance strip, then every
 * shared entry newest-first with her Logs day grouping. Read-only,
 * except one warm interaction: a single heart per card.
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
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Circle, Path, Svg, Text as SvgText } from 'react-native-svg';
import { colors, radii, spacing, type as typeScale } from '../theme/tokens';
import { kvGet, kvSet } from '../lib/db';
import { defaultRpc } from './inviteCodes';
import {
  buildAtAGlance,
  contractionSummaryLine,
  contractionWave,
  getMyLoves,
  getPartnerLinkStatus,
  getPartnerMyName,
  getPartnerOwnerName,
  getSharedEvents,
  myLoveLabel,
  sortSharedNewest,
  toggleEntryLove,
  type PartnerSharedEvent,
} from './partnerHome';
import { formatDayGroupLabel } from '../timeline/timeline';
import { formatDurationLong, readKickSessionFromData } from '../kicks/session';
import { readActivityCard } from '../labor/feed';

/** Periwinkle from the approved mockup — the wave is never red/amber/green. */
const WAVE = '#5E8FA8';
const WAVE_FILL = 'rgba(94,143,168,0.16)';
const APPT_BG = '#EDE7F5';
const APPT_STROKE = '#7C6AAE';
const REPORT_BG = '#FBF1DC';
const REPORT_STROKE = '#B98A2F';

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

function cleanText(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fullWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return `${day} · ${timeOfDay(iso)}`;
}

function localDayISO(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Card title per type (mockup 34's titles). */
function titleFor(event: PartnerSharedEvent): string {
  const data = event.data;
  switch (event.type) {
    case 'note':
    case 'mood':
      return 'A little log';
    case 'kick_session':
      return 'Kick session';
    case 'appointment':
      return cleanText(data.title) ?? 'Appointment';
    case 'activity': {
      const card = readActivityCard(data);
      if (card?.activityKind === 'contraction') return 'Contraction timing';
      if (card?.activityKind === 'breathing') return 'Breathing';
      if (card?.activityKind === 'pelvicfloor') return 'Pelvic floor';
      return 'Activity';
    }
    case 'report':
      return cleanText(data.title) ?? 'Report';
    default:
      return cleanText(data.title) ?? 'A little log';
  }
}

/* ------------------------------------------------------------------ */
/* Icon tiles — the mockup's card language (stroke SVGs)                 */
/* ------------------------------------------------------------------ */

function TileGlyph({ kind }: { kind: 'log' | 'kicks' | 'appt' | 'contract' | 'report' }) {
  const common = { fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'kicks':
      return (
        <>
          <Circle cx="12" cy="7.5" r="3.2" {...common} />
          <Path d="M12 11v4m0 0l-3.5 5m3.5-5l3.5 5M9 14.5L5 12.8M15 14.5l4-1.7" {...common} />
        </>
      );
    case 'appt':
      return (
        <>
          <Path d="M4 6h16a2.5 2.5 0 0 1 2.5 2.5V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V8.5A2.5 2.5 0 0 1 6 6z" {...common} />
          <Path d="M3.5 10.5h17M8 3.5v4M16 3.5v4" {...common} />
        </>
      );
    case 'contract':
      return <Path d="M2.5 13.5c2.8 0 2.8-4.5 5.6-4.5s2.8 4.5 5.6 4.5 2.8-4.5 5.6-4.5 2.2 4.5 2.2 4.5" {...common} />;
    case 'report':
      return (
        <>
          <Path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" {...common} />
          <Path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" {...common} />
        </>
      );
    case 'log':
    default:
      return (
        <>
          <Path d="M5 4h14a1 1 0 0 1 1 1v13l-4-3H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" {...common} />
          <Path d="M9 9h6M9 12.5h4" {...common} />
        </>
      );
  }
}

function tileFor(event: PartnerSharedEvent): { bg: string; stroke: string; kind: 'log' | 'kicks' | 'appt' | 'contract' | 'report' } {
  switch (event.type) {
    case 'kick_session':
      return { bg: colors.sageTint, stroke: colors.sageDeep, kind: 'kicks' };
    case 'appointment':
      return { bg: APPT_BG, stroke: APPT_STROKE, kind: 'appt' };
    case 'activity':
      return { bg: '#E8F1F6', stroke: WAVE, kind: 'contract' };
    case 'report':
      return { bg: REPORT_BG, stroke: REPORT_STROKE, kind: 'report' };
    default:
      return { bg: colors.blush, stroke: colors.coralDeep, kind: 'log' };
  }
}

function CardTile({ event }: { event: PartnerSharedEvent }) {
  const t = tileFor(event);
  return (
    <View style={[styles.tile, { backgroundColor: t.bg }]}>
      <Svg viewBox="0 0 24 24" width={22} height={22} stroke={t.stroke}>
        <TileGlyph kind={t.kind} />
      </Svg>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Contraction wave — gentle periwinkle, one calm summary               */
/* ------------------------------------------------------------------ */

function ContractionWave({
  count,
  spanSec,
  avgIntervalSec,
  occurredAt,
}: {
  count: number;
  spanSec: number;
  avgIntervalSec: number | null;
  occurredAt: string;
}) {
  const layout = contractionWave(count, spanSec, occurredAt);
  if (!layout) return null;
  const W = 312;
  const H = 112;
  const pad = 16;
  const base = 76;
  const n = layout.bumps.length;
  const segW = (W - 2 * pad) / n;
  let tops = '';
  for (let i = 0; i < n; i++) {
    const x0 = pad + i * segW;
    const cx = x0 + segW / 2;
    // Gentle, even bumps — one per contraction; the count IS the shape.
    const h = 34;
    const y = Math.round(base - h);
    tops +=
      (i === 0 ? `M ${x0},${base} ` : '') +
      `C ${Math.round(x0 + segW * 0.22)},${base} ${Math.round(x0 + segW * 0.22)},${y} ${Math.round(cx)},${y} ` +
      `C ${Math.round(x0 + segW * 0.78)},${y} ${Math.round(x0 + segW * 0.78)},${base} ${Math.round(x0 + segW)},${base} `;
  }
  const area = `${tops}L ${W - pad},${H} L ${pad},${H} Z`;
  return (
    <View style={styles.waveWrap} testID="partner-wave">
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} accessibilityLabel="Gentle wave of this contraction-timing session">
        <Path d={area} fill={WAVE_FILL} />
        <Path d={tops} fill="none" stroke={WAVE} strokeWidth={2.5} strokeLinecap="round" />
        <SvgText x={pad} y={H - 8} textAnchor="start" fontSize={10.5} fill={colors.muted}>
          {layout.startLabel}
        </SvgText>
        <SvgText x={W - pad} y={H - 8} textAnchor="end" fontSize={10.5} fill={colors.muted}>
          {layout.endLabel}
        </SvgText>
      </Svg>
      <Text style={styles.waveSummary}>{contractionSummaryLine(count, avgIntervalSec)}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Card body per entry type                                             */
/* ------------------------------------------------------------------ */

function CardBody({ event }: { event: PartnerSharedEvent }) {
  const data = event.data;
  if (event.type === 'kick_session') {
    const session = readKickSessionFromData(event.id, data, event.occurredAt);
    if (session) {
      return (
        <View style={styles.rows}>
          <View style={styles.row}>
            <Text style={styles.rowKey}>Movements</Text>
            <Text style={styles.rowVal}>{session.movements}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowKey}>Duration</Text>
            <Text style={styles.rowVal}>{formatDurationLong(session.durationSec)}</Text>
          </View>
        </View>
      );
    }
    return null;
  }
  if (event.type === 'appointment') {
    const when = cleanText(data.when) ?? fullWhen(event.occurredAt);
    const withWhom = cleanText(data.provider) ?? cleanText(data.note);
    return (
      <View style={styles.rows}>
        <View style={styles.row}>
          <Text style={styles.rowKey}>When</Text>
          <Text style={styles.rowVal}>{when}</Text>
        </View>
        {withWhom ? (
          <View style={styles.row}>
            <Text style={styles.rowKey}>With</Text>
            <Text style={styles.rowVal}>{withWhom}</Text>
          </View>
        ) : null}
      </View>
    );
  }
  if (event.type === 'activity') {
    const card = readActivityCard(data);
    if (card?.activityKind === 'contraction') {
      return (
        <ContractionWave
          count={card.count}
          spanSec={card.spanSec}
          avgIntervalSec={card.avgIntervalSec}
          occurredAt={event.occurredAt}
        />
      );
    }
    if (card?.activityKind === 'breathing') {
      return (
        <View style={styles.rows}>
          <View style={styles.row}>
            <Text style={styles.rowKey}>Pattern</Text>
            <Text style={styles.rowVal}>{card.patternName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowKey}>Rounds</Text>
            <Text style={styles.rowVal}>{card.rounds}</Text>
          </View>
        </View>
      );
    }
    if (card?.activityKind === 'pelvicfloor') {
      return (
        <View style={styles.rows}>
          <View style={styles.row}>
            <Text style={styles.rowKey}>Exercise</Text>
            <Text style={styles.rowVal}>{card.exerciseTitle}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowKey}>Sets</Text>
            <Text style={styles.rowVal}>{card.sets}</Text>
          </View>
        </View>
      );
    }
    return null;
  }
  const text = cleanText(data.text) ?? cleanText(data.body) ?? cleanText(data.summary);
  if (text) return <Text style={styles.text}>{text}</Text>;
  const symptoms = Array.isArray(data.symptoms)
    ? (data.symptoms as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  if (symptoms.length > 0) {
    return (
      <View style={styles.chipRow}>
        {symptoms.map((s) => (
          <View key={s} style={styles.chip}>
            <Text style={styles.chipText}>{s}</Text>
          </View>
        ))}
      </View>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Partner event card — the mockup's card language, one heart only       */
/* ------------------------------------------------------------------ */

function HeartGlyph({ loved }: { loved: boolean }) {
  return (
    <Svg viewBox="0 0 24 24" width={26} height={26}>
      <Path
        d="M12 20.5C7 16.5 3.5 13.3 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3.1.8 4 2.1C12.9 5.8 14.4 5 16 5c2.5 0 4.5 2 4.5 4.6 0 3.7-3.5 6.9-8.5 10.9z"
        fill={loved ? colors.coralDeep : 'none'}
        stroke={loved ? colors.coralDeep : colors.muted}
        strokeWidth={1.8}
      />
    </Svg>
  );
}

function PartnerEventCard({
  event,
  loved,
  myName,
  onToggleLove,
}: {
  event: PartnerSharedEvent;
  loved: boolean;
  myName: string | null;
  onToggleLove: (id: string) => void;
}) {
  return (
    <View style={styles.card} testID={`partner-card-${event.id}`}>
      <View style={styles.cardTop}>
        <CardTile event={event} />
        <Text style={styles.title} numberOfLines={2}>
          {titleFor(event)}
        </Text>
      </View>
      <CardBody event={event} />
      <Text style={styles.meta}>{timeOfDay(event.occurredAt)}</Text>
      <View style={styles.reactRow}>
        <Pressable
          onPress={() => onToggleLove(event.id)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={loved ? 'Unlove this moment' : 'Love this moment'}
          testID={`partner-heart-${event.id}`}
          style={({ pressed }) => [styles.heart, pressed && styles.heartPressed]}>
          <HeartGlyph loved={loved} />
        </Pressable>
        <Text
          style={[styles.lovedBy, loved && styles.lovedByOn]}
          testID={`partner-lovedby-${event.id}`}>
          {loved ? (myName ? myLoveLabel(myName) : 'Loved') : ''}
        </Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* At a glance — quiet strip, NOT a card                                */
/* ------------------------------------------------------------------ */

function GlanceStrip({ events, ownerName }: { events: PartnerSharedEvent[]; ownerName: string }) {
  const glance = useMemo(() => buildAtAGlance(events, ownerName), [events, ownerName]);
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

  const sections = useMemo(() => {
    const today = todayLocalISO();
    const byDay = new Map<string, PartnerSharedEvent[]>();
    for (const e of sortSharedNewest(events)) {
      const day = localDayISO(e.occurredAt);
      if (!day) continue;
      const list = byDay.get(day) ?? [];
      list.push(e);
      byDay.set(day, list);
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, list]) => ({ label: formatDayGroupLabel(day, today), list }));
  }, [events]);

  const displayName = ownerName.trim();
  const title = displayName ? `${displayName}'s journey` : 'The journey';

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
            <View key={s.label}>
              <Text style={styles.dayLabel}>{s.label}</Text>
              {s.list.map((e) => (
                <PartnerEventCard
                  key={e.id}
                  event={e}
                  loved={loved[e.id] ?? e.lovedByMe}
                  myName={myName}
                  onToggleLove={onToggleLove}
                />
              ))}
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
  dayLabel: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: spacing.lg, marginBottom: 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    marginTop: spacing.md,
    ...{ shadowColor: '#2F2B27', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  tile: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  title: { ...typeScale.headline, color: colors.ink, flex: 1 },
  text: { fontSize: 15, lineHeight: 24, color: colors.ink },
  rows: { marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  rowKey: { ...typeScale.body, color: colors.muted },
  rowVal: { ...typeScale.body, color: colors.ink, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  chip: {
    backgroundColor: colors.blush,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  chipText: { ...typeScale.footnote, color: colors.coralDeep },
  meta: { fontSize: 13, color: colors.muted, marginTop: spacing.sm },
  reactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  heart: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  heartPressed: { opacity: 0.6, transform: [{ scale: 0.9 }] },
  lovedBy: { fontSize: 13.5, color: colors.muted, fontWeight: '500', marginLeft: spacing.xs },
  lovedByOn: { color: colors.coralDeep, fontWeight: '700' },
  waveWrap: { marginTop: spacing.sm },
  waveSummary: { ...typeScale.body, color: colors.ink, marginTop: spacing.sm, textAlign: 'center' },
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
