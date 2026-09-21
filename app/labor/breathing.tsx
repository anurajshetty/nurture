/**
 * Labor readiness · Breathing (Willow, Sept 2026).
 *
 * Route: /labor/breathing — stacked OUTSIDE the (tabs) group, so the tab bar
 * is genuinely hidden for the whole breathing flow (approved full-screen
 * treatment, same precedent as Ask Willow). Mid-round, End and the back
 * chevron are always one tap away.
 *
 * Three states: pattern list (idle) → full-screen pacer → round complete.
 * The back chevron on the list returns to wherever she came from (the labor
 * hub / Week card) via router.back() — no dependency on sibling-owned files.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Pacer from '../../src/labor/breathing/Pacer';
import {
  BREATHING_INTRO_COPY,
  MEDICAL_DISCLAIMER,
  PATTERNS,
  PATTERN_ORDER,
  PRACTICE_NOTE_BODY,
  PRACTICE_NOTE_LEAD,
  buildSeq,
  roundDurationMs,
  type PatternId,
} from '../../src/labor/breathing/patterns';
import {
  CheckIcon,
  ChevronLeftIcon,
  FeatherIcon,
  RhythmIcon,
  WaveIcon,
  WindIcon,
} from '../../src/labor/breathing/icons';
import { colors, fontDisplay, minTouch, radii, shadow, spacing, type as typeScale } from '../../src/theme/tokens';
import { saveBreathingRound } from '../../src/labor/feedStore';

const PATTERN_ICONS: Record<PatternId, (props: { size?: number }) => ReactElement> = {
  cleanse: WindIcon,
  slow: WaveIcon,
  light: FeatherIcon,
  patterned: RhythmIcon,
};

/** Mockup body text (#5C554D) — not in the shared tokens; local to this section. */
const BODY_TEXT = '#5C554D';

type View2 = 'list' | 'pacer' | 'done';

export default function LaborBreathingScreen() {
  const router = useRouter();
  const [view, setView] = useState<View2>('list');
  const [patternId, setPatternId] = useState<PatternId>('slow');
  // Fresh sequence + start stamp per round so "Practice again" is a real restart.
  const [round, setRound] = useState(() => ({ seq: buildSeq('slow'), startedAtMs: Date.now() }));

  const startRound = (pid: PatternId) => {
    setPatternId(pid);
    setRound({ seq: buildSeq(pid), startedAtMs: Date.now() });
    setView('pacer');
  };

  /**
   * Labor feed (mockup 32, Anuraj approved Sept 21, 2026): one feed card
   * per completed round, saved automatically when the pacer finishes.
   * Pacer fires onDone exactly once (doneFired guard); the store's
   * sessionKey dedupe makes even a double fire a no-op.
   */
  const handleRoundDone = () => {
    try {
      saveBreathingRound({
        patternId,
        patternName: PATTERNS[patternId].name,
        startedAtMs: round.startedAtMs,
        durationSec: roundDurationMs(round.seq) / 1000,
        rounds: 1,
      });
    } catch {
      /* the feed card must never break the done view */
    }
    setView('done');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {view === 'pacer' ? (
        <Pacer
          patternId={patternId}
          seq={round.seq}
          startedAtMs={round.startedAtMs}
          onExit={() => setView('list')}
          onDone={handleRoundDone}
        />
      ) : view === 'done' ? (
        <DoneView patternId={patternId} onAgain={() => startRound(patternId)} onBack={() => setView('list')} />
      ) : (
        <PatternList onStart={startRound} onBack={() => router.back()} />
      )}
    </SafeAreaView>
  );
}

function PatternList({ onStart, onBack }: { onStart: (pid: PatternId) => void; onBack: () => void }) {
  return (
    <View style={styles.listRoot} testID="pattern-list">
      <View style={styles.topbar}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="pattern-list-back"
          style={styles.backBtn}
        >
          <ChevronLeftIcon color={colors.ink} />
        </Pressable>
        <Text style={styles.title}>Breathing</Text>
        <View style={styles.topSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>{BREATHING_INTRO_COPY}</Text>

        {PATTERN_ORDER.map((pid) => {
          const p = PATTERNS[pid];
          const Icon = PATTERN_ICONS[pid];
          return (
            <Pressable
              key={pid}
              onPress={() => onStart(pid)}
              accessibilityRole="button"
              accessibilityLabel={`Start ${p.name}`}
              testID={`pattern-card-${pid}`}
              style={styles.pcard}
            >
              <View style={styles.tile}>
                <Icon size={26} />
              </View>
              <View style={styles.ptext}>
                <Text style={styles.tagline}>{p.tag}</Text>
                <Text style={styles.pname}>{p.name}</Text>
                <Text style={styles.pdesc}>{p.desc}</Text>
              </View>
              <View style={styles.go}>
                <Text style={styles.goText}>Start</Text>
              </View>
            </Pressable>
          );
        })}

        <View style={styles.pracnote}>
          <Text style={styles.pracnoteText}>
            <Text style={styles.pracnoteLead}>{PRACTICE_NOTE_LEAD}</Text>
            <Text style={styles.pracnoteRest}>{PRACTICE_NOTE_BODY}</Text>
          </Text>
        </View>

        <Text style={styles.disclaimer}>{MEDICAL_DISCLAIMER}</Text>
      </ScrollView>
    </View>
  );
}

function DoneView({
  patternId,
  onAgain,
  onBack,
}: {
  patternId: PatternId;
  onAgain: () => void;
  onBack: () => void;
}) {
  const name = PATTERNS[patternId].name.toLowerCase();
  return (
    <View style={styles.doneWrap} testID="round-done">
      <View style={styles.donecheck}>
        <CheckIcon />
      </View>
      <Text style={styles.doneTitle}>Round complete</Text>
      <Text style={styles.doneBody}>
        Nice and steady — a full minute of {name}, opened and closed with a cleansing breath.
      </Text>
      <Pressable
        onPress={onAgain}
        accessibilityRole="button"
        accessibilityLabel="Practice again"
        testID="practice-again-btn"
        style={styles.endBtn}
      >
        <Text style={styles.endText}>Practice again</Text>
      </Pressable>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to patterns"
        testID="back-to-patterns-btn"
        style={styles.ghostBtn}
      >
        <Text style={styles.ghostText}>Back to patterns</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  listRoot: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTouch,
    paddingHorizontal: spacing.xl,
    marginTop: 4,
    marginBottom: 6,
  },
  backBtn: {
    width: minTouch,
    height: minTouch,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontDisplay,
    fontSize: 24,
    fontWeight: '600',
    color: colors.ink,
  },
  topSpacer: { width: minTouch },
  scrollBody: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 40,
  },
  intro: {
    ...typeScale.body,
    fontSize: 15,
    lineHeight: 24,
    color: BODY_TEXT,
    marginHorizontal: 2,
    marginBottom: 14,
  },
  pcard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    ...shadow.card,
    padding: spacing.lg,
    marginBottom: 11,
    minHeight: 88,
  },
  tile: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  ptext: { flex: 1, minWidth: 0 },
  tagline: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '800',
    marginBottom: 4,
  },
  pname: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 3,
  },
  pdesc: {
    fontSize: 13.5,
    color: colors.muted,
    lineHeight: 20,
  },
  go: {
    borderWidth: 1.5,
    borderColor: colors.coral,
    borderRadius: radii.chip,
    backgroundColor: colors.blush,
    paddingVertical: 9,
    paddingHorizontal: 16,
    minHeight: minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  goText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  pracnote: {
    backgroundColor: colors.sageTint,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 15,
    marginTop: 4,
    marginBottom: 12,
  },
  pracnoteText: {
    fontSize: 13.5,
    color: BODY_TEXT,
    lineHeight: 21,
  },
  pracnoteLead: {
    fontWeight: '700',
    color: colors.ink,
  },
  pracnoteRest: {
    color: BODY_TEXT,
  },
  disclaimer: {
    fontSize: 12.5,
    color: colors.muted,
    lineHeight: 20,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  doneWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    backgroundColor: colors.bg,
  },
  donecheck: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  doneTitle: {
    fontFamily: fontDisplay,
    fontSize: 27,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  doneBody: {
    fontSize: 15,
    color: BODY_TEXT,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 26,
    maxWidth: 290,
  },
  endBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.coral,
    borderRadius: radii.button,
    minHeight: 58,
    marginBottom: 10,
  },
  endText: {
    color: '#FFFFFF',
    fontSize: 16.5,
    fontWeight: '700',
  },
  ghostBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.button,
    minHeight: 56,
  },
  ghostText: {
    color: colors.coralDeep,
    fontSize: 15.5,
    fontWeight: '700',
  },
});
