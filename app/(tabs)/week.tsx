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
import { sizeArtSlot, randomSizeArtSlotIndex, SizeArtSlot } from '../../src/week/sizeArt';
import { PILL_DOCK_BACKGROUND, PILL_DOCK_PARENT_BACKGROUND, pillDockHeight } from '../../src/week/pillDock';
import type { Pregnancy } from '../../src/lib/types';
import AppointmentEditor from '../../src/logs/AppointmentEditor';
import { AskFab } from '../../src/aiChat/AskFab';
import { ConsentSheet } from '../../src/aiChat/ConsentSheet';
import { AskChat } from '../../src/aiChat/AskChat';
import { KicksFab } from '../../src/kicks/KicksFab';
import { KickHomeCard } from '../../src/kicks/KickHomeCard';
import KickCountingScreen from '../../src/kicks/KickCountingScreen';
import KickHistoryScreen from '../../src/kicks/KickHistoryScreen';
import { listKickSessions } from '../../src/kicks/store';
import {
  kicksVisibleForDisplayedWeek,
  sessionsInDisplayedWeek,
} from '../../src/kicks/session';
import {
  LABOR_READINESS_MIN_WEEK,
  WEEK_CARD_COPY,
  laborCardVisibleForDisplayedWeek,
} from '../../src/labor/copy';
import { displayWeekRange } from '../../src/onboarding/dates';
import { hasAskedFirstQuestion } from '../../src/aiChat/history';
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
 * Random 3-subject size card (Anuraj, Sept 20, 2026): every Week-tab load
 * picks a RANDOM slot from the DISPLAYED week's 3-subject set (displayed
 * = completed weeks + 1). Image and caption always change together — the
 * caption comes from the same slot as the image, never from the
 * completed-week content row. No persistence, no sequence.
 *
 * Within a session, paging between weeks reuses the already-picked slot
 * for each week (sessionSizeArtPicks) so the card doesn't re-roll while
 * she browses; only an actual tab load re-rolls.
 */

/** Session-level week -> picked slot index (in memory only). */
const sessionSizeArtPicks = new Map<number, number>();

/** Fresh random pick for a tab load; stores the pick for the session. */
function pickSizeArt(week: number): SizeArtSlot | null {
  const idx = randomSizeArtSlotIndex(week);
  if (idx === null) return null;
  sessionSizeArtPicks.set(week, idx);
  return sizeArtSlot(week, idx);
}

/**
 * The week's session pick WITHOUT re-rolling — used when paging between
 * weeks (prev/next), which is not a tab load. A week with no session pick
 * yet gets a fresh random one.
 */
function peekSizeArt(week: number): SizeArtSlot | null {
  let idx = sessionSizeArtPicks.get(week);
  if (idx === undefined) {
    const fresh = randomSizeArtSlotIndex(week);
    if (fresh === null) return null;
    sessionSizeArtPicks.set(week, fresh);
    idx = fresh;
  }
  return sizeArtSlot(week, idx);
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
  /** Current size-card slot (image + caption together) for the size hero. */
  const [sizeArt, setSizeArt] = useState<SizeArtSlot | null>(null);
  /**
   * Ask Willow entry state (Anuraj, Sept 20, 2026): the floating ask
   * pill is Week-tab only. Two independent flags — the consent
   * BottomSheet calls its onClose AFTER its exit animation (see
   * BottomSheet), so sharing one flag would let the consent's delayed
   * onClose tear down a chat that just opened.
   * Consent shows on EVERY ask tap until the first question is actually
   * sent (hasAskedFirstQuestion); after that, ask opens chat directly.
   *
   * iOS modal-handoff (Sept 20, 2026): both the consent sheet and the
   * chat are native Modals. Opening the chat in the same commit that
   * dismisses the consent Modal races iOS's modal teardown — UIKit can
   * tear down the presenting stack while the chat Modal is presenting,
   * leaving chatVisible=true with NO modal on screen (the "stuck" bug
   * Anuraj caught in TestFlight). So the consent sheet is ONLY ever
   * closed here; the chat is opened from the sheet's onClose, after the
   * exit animation completes, deferred one more tick so the native
   * dismissal commits first.
   */
  const [consentVisible, setConsentVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  /** True once the user has tapped "I understand" (reset on every open). */
  const consentAcceptedRef = useRef(false);
  /** Defers the chat open past the consent sheet's native dismissal. */
  const chatOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openAsk = useCallback(() => {
    if (hasAskedFirstQuestion()) setChatVisible(true);
    else {
      // A pending deferred chat open (from a previous "I understand")
      // is cancelled — the user re-tapped and the consent sheet is back.
      if (chatOpenTimer.current) {
        clearTimeout(chatOpenTimer.current);
        chatOpenTimer.current = null;
      }
      consentAcceptedRef.current = false;
      setConsentVisible(true);
    }
  }, []);
  const closeChat = useCallback(() => setChatVisible(false), []);
  const acceptConsent = useCallback(() => {
    // Marks acceptance and STARTS the sheet's exit animation. The sheet
    // stays mounted through the animation; its onClose
    // (handleConsentClosed) opens the chat afterwards. The chat is NOT
    // opened here — same-tick open + dismiss races iOS modal teardown.
    consentAcceptedRef.current = true;
    setConsentVisible(false);
  }, []);
  /**
   * Runs on EVERY consent-sheet dismissal: backdrop tap, "Not now"
   * (via its own onPress AND the sheet's delayed onClose — idempotent),
   * or the "I understand" exit animation completing. Opens the chat
   * only when the user accepted.
   */
  const handleConsentClosed = useCallback(() => {
    setConsentVisible(false);
    if (!consentAcceptedRef.current) return;
    consentAcceptedRef.current = false;
    if (chatOpenTimer.current) clearTimeout(chatOpenTimer.current);
    chatOpenTimer.current = setTimeout(() => {
      chatOpenTimer.current = null;
      setChatVisible(true);
    }, 100);
  }, []);
  useEffect(() => {
    return () => {
      if (chatOpenTimer.current) clearTimeout(chatOpenTimer.current);
    };
  }, []);
  /**
   * Kick counter (Willow, round 4 — Anuraj approved Sept 20, 2026): the
   * floating kicks pill + persistent Home card appear from displayed week
   * 19. The pill opens the counting screen; the card opens the
   * week-scoped session list ("This week's kicks") — never the counter —
   * and NEVER retires (it persists in both states).
   */
  const [countingVisible, setCountingVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const closeCounting = useCallback(() => setCountingVisible(false), []);
  const closeHistory = useCallback(() => setHistoryVisible(false), []);
  /**
   * saveKickSession writes synchronously before onClose flips
   * countingVisible, so the card's week summary (re-read below) refreshes
   * on the close re-render — nothing to do here beyond the stable handle.
   */
  const handleKickSaved = useCallback(() => {}, []);
  /** The card opens the week-scoped list, then the list's empty state can
   *  open the counter (the card itself never does). */
  const openCountingFromHistory = useCallback(() => {
    setHistoryVisible(false);
    setCountingVisible(true);
  }, []);
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
        // Fresh random pick once per tab load, for the week actually
        // displayed — keyed by the DISPLAYED week (completed + 1).
        // Anuraj Sept 20, 2026.
        const w = Math.min(viewWeekRef.current ?? s.currentWeek, s.currentWeek);
        setSizeArt(pickSizeArt(w + 1));
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
  /**
   * Pill dock visibility (Anuraj, Sept 20, 2026): the kicks pill floats
   * 12pt above the Ask pill for displayed week 19+. The dock reserves
   * exactly the pills' vertical space so body text can never scroll
   * under them.
   */
  const showKicksPill = kicksVisibleForDisplayedWeek(displayWeekNum);
  /**
   * Kick Home card, round 4 (Anuraj, Sept 20, 2026): the DISPLAYED week's
   * sessions — State A (invitation) when empty, State B (week summary)
   * when she has logged. Re-read from the store on every render (a single
   * indexed query; the save lands synchronously before the counting screen
   * closes, so the close re-render flips the card immediately). A plain
   * call on purpose — this must stay below the early returns, where hooks
   * are not allowed.
   */
  const kickWeekSessions = sessionsInDisplayedWeek(
    listKickSessions(),
    pregnancy.dueDate ?? '',
    displayWeekNum,
  );
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
    <View style={styles.askRoot} testID="week-root">
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
            source={sizeArt.image}
            style={styles.sizeArt}
            testID="week-size-art"
            accessibilityLabel={`Illustration: your baby is the size of ${sizeArt.caption ?? content.size?.staple ?? 'a growing baby'}`}
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
            {/* Caption rotates WITH the image: the slot's own caption for
                weeks 12-40 (never the completed-week content row's), the
                content row as fallback for legacy weeks 1-11. */}
            <Text style={styles.sizeName} testID="week-size-name">
              {sizeArt?.caption ?? content.size.staple}
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

      {/* Labor-readiness entry card (Anuraj, Sept 20, 2026): the entry
          card renders ONLY for displayed weeks at or above
          LABOR_READINESS_MIN_WEEK (35; single one-line knob in
          src/labor/copy.ts), through end of pregnancy. Positioned below
          the "Coming up" appointment reminder/editor and immediately
          ABOVE the kick-counting card. One tap opens the /labor hub;
          the contraction timer is two taps from Week. */}
      {laborCardVisibleForDisplayedWeek(displayWeekNum) ? (
        <Card
          testID="week-labor-card"
          onPress={() => router.push('/labor')}
          accessibilityLabel={`${WEEK_CARD_COPY.title}. ${WEEK_CARD_COPY.body} Tap to open.`}
          style={styles.laborCard}
        >
          <View style={styles.laborKickerRow}>
            <View style={styles.laborPill}>
              <Text style={styles.laborPillText}>{WEEK_CARD_COPY.pill}</Text>
            </View>
            <Text style={styles.laborKicker}>{WEEK_CARD_COPY.kicker}</Text>
          </View>
          <Text style={styles.laborTitle}>{WEEK_CARD_COPY.title}</Text>
          <Text style={styles.laborBody}>{WEEK_CARD_COPY.body}</Text>
        </Card>
      ) : null}

      {/* Kick counter Home card (round 4, Anuraj approved Sept 20, 2026):
          displayed week 19+, below the "Coming up" appointment cards and
          above "Highlights this week". The card NEVER retires — State A
          (invitation) until her first session, State B (week summary)
          after. Tapping it opens the week-scoped session list — never the
          counter. */}
      {kicksVisibleForDisplayedWeek(displayWeekNum) ? (
        <KickHomeCard
          weekSessions={kickWeekSessions}
          onPress={() => setHistoryVisible(true)}
        />
      ) : null}

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
      {/* Pill dock (Anuraj, Sept 20, 2026): the Ask/kicks pills live in
          reserved layout space below the scroll content instead of
          floating OVER it — body text can never slide under the pills,
          so highlight sentences are never visually cut mid-word. The
          pills keep their approved look, size, and bottom-right
          position; only the overlap is gone.
          The dock background is transparent (src/week/pillDock.ts) and
          the screen root behind it carries the page cream
          (PILL_DOCK_PARENT_BACKGROUND) — the dock sits OUTSIDE the
          Screen scroll container, and on web the tab slot behind it is
          light gray, so transparent alone revealed a gray band (caught
          by Anuraj on web, Sept 20 2026). Cream root + transparent dock
          = no band, no block, no seam. */}
      <View
        style={[
          { backgroundColor: PILL_DOCK_BACKGROUND },
          { height: pillDockHeight(showKicksPill) },
        ]}
        testID="week-pill-dock"
      >
        <AskFab onPress={openAsk} />
        {showKicksPill ? (
          <KicksFab onPress={() => setCountingVisible(true)} />
        ) : null}
      </View>
      <KickCountingScreen
        visible={countingVisible}
        onClose={closeCounting}
        onSaved={handleKickSaved}
      />
      <KickHistoryScreen
        visible={historyVisible}
        onClose={closeHistory}
        weekRange={
          displayWeekRange(pregnancy.dueDate ?? '', displayWeekNum) ?? undefined
        }
        onStartCounting={openCountingFromHistory}
      />
      <ConsentSheet
        visible={consentVisible}
        // "Not now" and backdrop-dismiss both funnel through the same
        // onClose as the "I understand" exit animation (idempotent);
        // the chat opens only when the user accepted (see
        // handleConsentClosed).
        onNotNow={handleConsentClosed}
        onUnderstand={acceptConsent}
      />
      <AskChat visible={chatVisible} onClose={closeChat} />
    </View>
  );
}

const styles = StyleSheet.create({
  /** Ask Willow entry (Anuraj, Sept 20, 2026): the only structural
   *  addition to the Week screen — a positioning root for the floating
   *  ask pill. No briefing UI changed.
   *  The root carries the page cream (PILL_DOCK_PARENT_BACKGROUND):
   *  the pill dock below the scroll content is transparent, and on web
   *  the tab slot behind this root is light gray — without the cream
   *  root the transparent dock revealed a gray band (Anuraj, Sept 20
   *  2026). Same cream as Screen, so no seam on either platform. */
  askRoot: {
    flex: 1,
    backgroundColor: PILL_DOCK_PARENT_BACKGROUND,
  },
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
  /* Labor-readiness entry card: outlined in coral, pill + kicker row,
     tappable to the /labor hub. Renders only for displayed weeks at or
     above LABOR_READINESS_MIN_WEEK (see src/labor/copy.ts). */
  laborCard: {
    borderWidth: 2,
    borderColor: colors.coral,
    marginBottom: spacing.sm,
  },
  laborKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 6,
  },
  laborPill: {
    backgroundColor: colors.blush,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  laborPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: colors.coralDeep,
    textTransform: 'uppercase',
  },
  laborKicker: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.coralDeep,
  },
  laborTitle: {
    fontFamily: 'Georgia',
    fontSize: 20,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 4,
  },
  laborBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5C554D',
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
