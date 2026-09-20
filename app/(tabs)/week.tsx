/**
 * Epic 5 — Week tab ("what to expect").
 *
 * Her gentle weekly briefing: size comparison, development highlights,
 * the week's reading, and questions for her care team. All content is
 * bundled (src/week/content.ts) — the tab renders fully offline.
 *
 * States:
 * - no pregnancy → warm empty state (onboarding not done)
 * - stopped      → quiet compassionate state, zero developmental content
 * - out of range → gentle note (week < 4 or > 42)
 * - normal       → the week view, paged 4..currentWeek ("never ahead")
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Button, Card, EmptyState, Screen } from '../../src/components';
import {
  colors,
  minTouch,
  radii,
  shadow,
  spacing,
  type as typeScale,
} from '../../src/theme/tokens';
import {
  getActivePregnancy,
  listEvents,
  listEventsInRange,
  listPregnancies,
  saveEvent,
} from '../../src/sync/store';
import { addDaysISO, todayISO } from '../../src/onboarding/dates';
import { sizeArtVariantCount, sizeArtVariantForWeek, sizeArtVariantKey, nextSizeArtIndex, parseStoredSizeArtIndex } from '../../src/week/sizeArt';
import { kvGet, kvSet } from '../../src/lib/db';
import type { Pregnancy } from '../../src/lib/types';
import AppointmentEditor from '../../src/logs/AppointmentEditor';
import {
  MAX_WEEK,
  MIN_WEEK,
  getWeekContent,
  getWeekNumber,
  shouldShowWeekContent,
  weekGreeting,
  type WeekContent,
} from '../../src/week/content';
import { getBabyName } from '../../src/briefing/context';
import {
  selectUpcomingAppointmentCards,
  type UpcomingAppointmentCard,
} from '../../src/briefing/upcomingAppointmentCards';

/** Warm orb tones, cycled gently by week for subtle variety. */
const ORB_TONES = ['#E8A94E', '#D98E3B', '#E5B25E', '#DDA44A', '#E9B558'];

function orbTone(week: number): string {
  return ORB_TONES[week % ORB_TONES.length];
}

/**
 * The header shows the DISPLAY week = completed weeks + 1 (Anuraj, Sept
 * 2026) — via the displayWeek() helper in src/onboarding/dates. The
 * completed-week number (content lookups, nav bounds) stays untouched,
 * but the SIZE ART is keyed by the DISPLAYED week too (Anuraj ~22:59 PDT,
 * "everything should be consistent"): the image for displayed week N
 * comes from week N's subject set (e.g. displayed 38 -> leek). The
 * rotation storage key is likewise the displayed week, so a new week
 * starts at variant 1.
 *
 * "Coming up" card (Anuraj, Sept 2026): tight card — kicker, title, warm
 * `when` string only. The "2 questions to ask" line was removed at his
 * request; do not re-add it.
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'stopped' }
  | { kind: 'ready'; pregnancy: Pregnancy; currentWeek: number };

function load(): LoadState {
  try {
    const pregnancy = getActivePregnancy();
    if (!pregnancy || !shouldShowWeekContent(pregnancy)) {
      const anyStopped = listPregnancies().some((p) => p.status === 'stopped');
      if (anyStopped) return { kind: 'stopped' };
      return { kind: 'empty' };
    }
    const week = getWeekNumber(pregnancy.dueDate, todayISO());
    if (week === null) return { kind: 'empty' };
    return { kind: 'ready', pregnancy, currentWeek: week };
  } catch {
    return { kind: 'empty' };
  }
}

function countWeekMoments(): number {
  try {
    const today = todayISO();
    const weekStart = addDaysISO(today, -6);
    const end = addDaysISO(today, 1);
    if (!weekStart || !end) return 0;
    return listEventsInRange(weekStart, end, 200).length;
  } catch {
    return 0;
  }
}

function Kicker({ children }: { children: string }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

/**
 * Per-load watercolor rotation (Anuraj, Sept 20, 2026): every Week-tab
 * load advances to the next of the week's variants in sequence, persisted
 * in the local KV store so it survives app restarts. The storage key
 * includes the week, so a new week starts at variant 1. Never throws —
 * a storage hiccup falls back to the first variant without advancing.
 */
function advanceSizeArt(week: number): number | null {
  const count = sizeArtVariantCount(week);
  if (count === 0) return null;
  let stored: string | null = null;
  try {
    stored = kvGet(sizeArtVariantKey(week));
  } catch {
    return sizeArtVariantForWeek(week, 0);
  }
  const next = nextSizeArtIndex(count, stored);
  try {
    kvSet(sizeArtVariantKey(week), String(next));
  } catch {
    // Persist failed — still show the next variant for this load.
  }
  return sizeArtVariantForWeek(week, next);
}

/**
 * Reads the week's current rotation position WITHOUT advancing it —
 * used when paging between weeks (prev/next), which is not a tab load.
 * A week with no stored position shows variant 1.
 */
function peekSizeArt(week: number): number | null {
  const count = sizeArtVariantCount(week);
  if (count === 0) return null;
  let idx = 0;
  try {
    idx = parseStoredSizeArtIndex(count, kvGet(sizeArtVariantKey(week))) ?? 0;
  } catch {
    idx = 0;
  }
  return sizeArtVariantForWeek(week, idx);
}

export default function WeekScreen() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [viewWeek, setViewWeek] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [savedTick, setSavedTick] = useState(0);
  const [moments, setMoments] = useState(0);
  const [reminderCards, setReminderCards] = useState<UpcomingAppointmentCard[]>([]);
  const [babyName, setBabyName] = useState<string | null>(null);
  /** Appointment editor sheet, opened by tapping a "Coming up" card. */
  const [editorId, setEditorId] = useState<string | null>(null);
  /** Current watercolor variant for the size hero (per-load rotation). */
  const [sizeArt, setSizeArt] = useState<number | null>(null);
  /** Mirror of viewWeek for the focus callback below (stable [] deps). */
  const viewWeekRef = useRef<number | null>(null);
  useEffect(() => {
    viewWeekRef.current = viewWeek;
  }, [viewWeek]);

  /**
   * When the displayed week changes via prev/next paging, show that
   * week's current rotation position. Paging is not a tab load, so the
   * sequence does not advance here.
   */
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const w = Math.min(viewWeek ?? state.currentWeek, state.currentWeek);
    // Displayed week (completed + 1): the size image for displayed week N
    // comes from week N's subject set. Anuraj ~22:59 PDT.
    setSizeArt(peekSizeArt(w + 1));
  }, [state, viewWeek]);

  useFocusEffect(
    useCallback(() => {
      const s = load();
      setState(s);
      if (s.kind === 'ready') {
        setViewWeek((v) =>
          v === null ? s.currentWeek : Math.min(v, s.currentWeek),
        );
        // Advance the size-art rotation once per tab load, for the week
        // actually displayed (mirrors the viewWeek clamp above) — keyed by
        // the DISPLAYED week (completed + 1). Anuraj ~22:59 PDT.
        const w = Math.min(viewWeekRef.current ?? s.currentWeek, s.currentWeek);
        setSizeArt(advanceSizeArt(w + 1));
        setMoments(countWeekMoments());
        try {
          setBabyName(getBabyName());
        } catch {
          setBabyName(null);
        }
        try {
          const appts = listEvents(200).filter(
            (e) => e.type === 'appointment',
          );
          setReminderCards(
            selectUpcomingAppointmentCards(appts, Date.now()),
          );
        } catch {
          setReminderCards([]);
        }
      }
    }, []),
  );

  const saveQuestion = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    try {
      saveEvent({ type: 'question', data: { text } });
    } catch {
      // The question stays in the draft; never lose her words.
      return;
    }
    setDraft('');
    setAdding(false);
    setSavedTick((t) => t + 1);
  }, [draft]);

  if (state.kind === 'loading') {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.loading}>Gathering your week…</Text>
        </View>
      </Screen>
    );
  }

  if (state.kind === 'empty') {
    return (
      <Screen bottomPadding={120}>
        <EmptyState
          glyph="◍"
          title="Your week, unfolding"
          copy="Week by week, you'll find gentle size comparisons, highlights, and reading here. Written for exactly where you are, never ahead of you."
        />
      </Screen>
    );
  }

  if (state.kind === 'stopped') {
    return (
      <Screen bottomPadding={120}>
        <EmptyState
          glyph="◍"
          title="Your week view is resting"
          copy="Pregnancy updates are off. Your story is still here whenever you'd like to revisit it. Nothing has been lost."
        >
          <Button
            title="View your story"
            variant="ghost"
            onPress={() => router.push('/logs')}
            testID="week-stopped-story"
          />
        </EmptyState>
      </Screen>
    );
  }

  const { pregnancy, currentWeek } = state;
  const week = viewWeek ?? currentWeek;
  const content: WeekContent = getWeekContent(
    week,
    pregnancy.dueDate ?? '',
    todayISO(),
    babyName,
  );
  const isCurrent = week === currentWeek;
  // Header shows the DISPLAY week (completed + 1); the size ART is also
  // keyed by the displayed week (Anuraj ~22:59 PDT). The week CONTENT
  // (size caption, highlights, readings, questions) and nav bounds stay
  // on the completed-week number.
  const displayWeekNum = week + 1;
  const displayCurrentWeek = currentWeek + 1;
  const greeting = weekGreeting(week, babyName);

  const goWeek = (d: -1 | 1) => {
    setViewWeek((v) => {
      const base = v ?? currentWeek;
      const next = base + d;
      if (next < MIN_WEEK || next > currentWeek) return base;
      setExpanded(null);
      return next;
    });
  };

  return (
    <Screen bottomPadding={120} testID="week-screen">
      {/* Week navigation */}
      <View style={styles.topbar}>
        <Pressable
          testID="week-prev"
          onPress={() => goWeek(-1)}
          disabled={week <= MIN_WEEK}
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          style={({ pressed }) => [
            styles.wnav,
            pressed && styles.wnavPressed,
            week <= MIN_WEEK && styles.wnavDisabled,
          ]}
        >
          <Text style={styles.wnavGlyph}>‹</Text>
        </Pressable>
        <Text testID="week-title" style={styles.weekTitle} accessibilityRole="header">
          Week {displayWeekNum}
        </Text>
        <Pressable
          testID="week-next"
          onPress={() => goWeek(1)}
          disabled={week >= currentWeek}
          accessibilityRole="button"
          accessibilityLabel="Next week"
          style={({ pressed }) => [
            styles.wnav,
            pressed && styles.wnavPressed,
            week >= currentWeek && styles.wnavDisabled,
          ]}
        >
          <Text style={styles.wnavGlyph}>›</Text>
        </Pressable>
      </View>
      <Text style={styles.range} testID="week-range">
        {content.weekRange ?? ''}
        {content.weekRange ? ' · ' : ''}
        {content.weeksToGo === 0
          ? 'any day now'
          : `${content.weeksToGo} week${content.weeksToGo === 1 ? '' : 's'} to go`}
      </Text>
      {!isCurrent ? (
        <Pressable
          testID="week-back-current"
          onPress={() => {
            setViewWeek(currentWeek);
            setExpanded(null);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Back to week ${displayCurrentWeek}`}
          style={({ pressed }) => [
            styles.backPill,
            pressed && styles.backPillPressed,
          ]}
        >
          <Text style={styles.backPillText}>← Back to week {displayCurrentWeek}</Text>
        </Pressable>
      ) : null}

      {/* Warm greeting */}
      <Text style={styles.greeting} testID="week-greeting">
        {greeting}
      </Text>

      {/* Size hero */}
      <View style={styles.sizeHero} testID="week-size-hero">
        {sizeArt ? (
          <Image
            source={sizeArt}
            style={styles.sizeArt}
            testID="week-size-art"
            accessibilityLabel={`Illustration: your baby is the size of ${content.size?.staple ?? 'a growing baby'}`}
          />
        ) : (
          <View
            style={[styles.orb, { backgroundColor: orbTone(week) }]}
            accessibilityElementsHidden
          />
        )}
        {content.size ? (
          <>
            <Text style={styles.sizeKicker}>Your baby is the size of</Text>
            <Text style={styles.sizeName} testID="week-size-name">
              {content.size.staple}
            </Text>
            <Text style={styles.sizeSpec} testID="week-size-spec">
              {content.size.length} · {content.size.weight}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.sizeKicker}>Your baby is</Text>
            <Text style={styles.sizeName}>growing every day</Text>
            <Text style={styles.sizeSpec}>Any day now</Text>
          </>
        )}
      </View>

      {/* Upcoming-appointment reminder cards — current week only.
          One card per appointment in the rolling 48h window
          (selectUpcomingAppointmentCards), soonest-first; each card
          vanishes the moment its appointment time passes. The whole card
          taps through to the appointment editor. */}
      {isCurrent
        ? reminderCards.map((card) => (
            <Card
              key={card.id}
              testID="week-reminder-card"
              style={styles.reminderCard}
              onPress={() => setEditorId(card.id)}
              accessibilityLabel={`Coming up. ${card.title}. ${card.when}. Tap to open the visit.`}
            >
              <Text style={styles.apptHeadline}>Coming up</Text>
              <Text style={styles.apptTitle} testID="week-reminder-card-title">
                {card.title}
              </Text>
              <Text style={styles.apptWhen} testID="week-reminder-card-when">
                {card.when}
              </Text>
            </Card>
          ))
        : null}

      <AppointmentEditor
        eventId={editorId}
        visible={editorId !== null}
        onClose={() => setEditorId(null)}
      />

      {/* Highlights */}
      <Kicker>Highlights this week</Kicker>
      <Card testID="week-highlights">
        {content.highlights.map((h, i) => (
          <View
            key={i}
            style={[styles.hl, i < content.highlights.length - 1 && styles.hlGap]}
          >
            <View style={styles.hlNum}>
              <Text style={styles.hlNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.hlText}>{h}</Text>
          </View>
        ))}
      </Card>

      {/* Reading */}
      <Kicker>This week&apos;s reading</Kicker>
      {content.readings.map((r) => {
        const open = expanded === r.id;
        return (
          <View key={r.id} style={styles.readWrap}>
            <Pressable
              testID={`week-reading-${r.id}`}
              onPress={() => setExpanded(open ? null : r.id)}
              accessibilityRole="button"
              accessibilityLabel={`${r.title}${open ? ', expanded' : ''}`}
              accessibilityState={{ expanded: open }}
              style={({ pressed }) => [
                styles.readRow,
                pressed && styles.readRowPressed,
              ]}
            >
              <View style={styles.readIcon}>
                <Text style={styles.readIconGlyph}>✎</Text>
              </View>
              <View style={styles.readText}>
                <Text style={styles.readTitle}>{r.title}</Text>
                <Text style={styles.readSub}>{r.subtitle}</Text>
              </View>
              <Text style={styles.chev}>{open ? '▾' : '›'}</Text>
            </Pressable>
            {open ? (
              <View style={styles.readBody} testID={`week-reading-${r.id}-body`}>
                {r.body.map((p, i) => (
                  <Text key={i} style={styles.readPara}>
                    {p}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}

      {/* Care-team questions */}
      <Kicker>To discuss with your care team</Kicker>
      <Card testID="week-questions">
        {content.questions.map((q, i) => (
          <View key={`${i}-${savedTick}`} style={styles.qrow}>
            <View style={styles.qicon}>
              <Text style={styles.qiconGlyph}>?</Text>
            </View>
            <Text style={styles.qtext}>{q}</Text>
          </View>
        ))}
        {adding ? (
          <View style={styles.qaddBox}>
            <TextInput
              testID="week-question-input"
              value={draft}
              onChangeText={setDraft}
              placeholder="Write your question…"
              placeholderTextColor={colors.muted}
              multiline
              style={styles.qinput}
              accessibilityLabel="Your question for your care team"
            />
            <View style={styles.qaddRow}>
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => {
                  setAdding(false);
                  setDraft('');
                }}
                style={styles.qaddBtn}
                testID="week-question-cancel"
              />
              <Button
                title="Save question"
                onPress={saveQuestion}
                disabled={!draft.trim()}
                style={styles.qaddBtn}
                testID="week-question-save"
              />
            </View>
          </View>
        ) : (
          <Pressable
            testID="week-question-add"
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="Add your own question"
            style={({ pressed }) => [
              styles.qaddDashed,
              pressed && styles.qaddDashedPressed,
            ]}
          >
            <Text style={styles.qaddDashedText}>+ Add your own question</Text>
          </Pressable>
        )}
      </Card>

      {/* Story */}
      <Kicker>Your week in your story</Kicker>
      <Card
        onPress={() => router.push('/logs')}
        accessibilityLabel="View your story in Logs"
        testID="week-story"
      >
        <Text style={styles.storyTitle}>
          {moments === 0
            ? 'A fresh page'
            : `${moments} moment${moments === 1 ? '' : 's'} saved`}
        </Text>
        <Text style={styles.storyCopy}>
          {moments === 0
            ? 'Nothing saved this week yet. Your story is waiting whenever you are.'
            : 'Your story is filling in beautifully.'}
        </Text>
      </Card>

      <Text style={styles.footer} testID="week-footer">
        General information only. Not medical advice.{'\n'}Content updated
        Sep 2026
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
  },
  loading: {
    ...typeScale.body,
    color: colors.muted,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  wnav: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wnavPressed: {
    backgroundColor: colors.blush,
  },
  wnavDisabled: {
    opacity: 0.35,
  },
  wnavGlyph: {
    fontSize: 26,
    lineHeight: 30,
    color: colors.coralDeep,
    fontWeight: '700',
  },
  weekTitle: {
    ...typeScale.display,
    fontSize: 26,
    color: colors.ink,
    marginHorizontal: spacing.md,
    minWidth: 140,
    textAlign: 'center',
  },
  range: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  greeting: {
    fontFamily: 'Georgia',
    fontSize: 18,
    fontStyle: 'italic',
    color: colors.ink,
    textAlign: 'center',
    marginTop: 0,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  backPill: {
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    minHeight: minTouch,
    justifyContent: 'center',
  },
  backPillPressed: {
    backgroundColor: colors.blush,
  },
  backPillText: {
    ...typeScale.subhead,
    color: colors.coralDeep,
    fontWeight: '700',
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sizeHero: {
    backgroundColor: colors.blush,
    borderRadius: radii.cardLarge,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  orb: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginVertical: spacing.sm,
    ...shadow.card,
  },
  sizeArt: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginVertical: spacing.sm,
    ...shadow.card,
  },
  sizeKicker: {
    fontFamily: 'Georgia',
    fontSize: 15,
    color: colors.muted,
  },
  sizeName: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: '600',
    color: colors.ink,
    marginVertical: spacing.xs,
    textAlign: 'center',
  },
  sizeSpec: {
    fontSize: 13.5,
    color: colors.muted,
    textAlign: 'center',
  },
  hl: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  hlGap: {
    marginBottom: spacing.md,
  },
  hlNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  hlNumText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.sageDeep,
  },
  hlText: {
    ...typeScale.body,
    fontSize: 14.5,
    color: '#5C554D',
    flex: 1,
    lineHeight: 21,
  },
  readWrap: {
    marginBottom: spacing.sm,
  },
  readRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.md,
    minHeight: 76,
    ...shadow.card,
  },
  readRowPressed: {
    opacity: 0.96,
  },
  readIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  readIconGlyph: {
    fontSize: 22,
    color: colors.sageDeep,
  },
  readText: {
    flex: 1,
  },
  readTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  readSub: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  chev: {
    fontSize: 20,
    color: colors.muted,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
  readBody: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginTop: spacing.xs,
  },
  readPara: {
    ...typeScale.body,
    fontSize: 15,
    color: '#5C554D',
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  qrow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  qicon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: colors.blueTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  qiconGlyph: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4E7FA3',
  },
  qtext: {
    fontSize: 14,
    color: '#5C554D',
    lineHeight: 20,
    flex: 1,
  },
  qaddDashed: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  qaddDashedPressed: {
    backgroundColor: colors.blush,
  },
  qaddDashedText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  qaddBox: {
    marginTop: spacing.xs,
  },
  qinput: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 16,
    backgroundColor: colors.card,
    padding: spacing.md,
    fontSize: 15,
    color: colors.ink,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  qaddRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  qaddBtn: {
    flex: 1,
  },
  storyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  apptHeadline: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  apptTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 2,
  },
  apptWhen: {
    fontSize: 14.5,
    color: '#5C554D',
    lineHeight: 21,
  },
  apptMore: {
    fontSize: 13,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  /* "Coming up" reminder card: tight — kicker, title, warm `when` only. */
  reminderCard: {
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  storyCopy: {
    fontSize: 14.5,
    color: '#5C554D',
    lineHeight: 21,
  },
  footer: {
    fontSize: 12.5,
    color: colors.muted,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
});
