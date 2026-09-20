/**
 * Labor readiness — Pelvic-floor relaxation (`/labor/pelvicfloor`).
 *
 * Faithful implementation of mockup 29 (approved by Anuraj, Sept 20, 2026):
 * guide overview with four one-tap practices (connection breath, reverse
 * Kegel, visualizations, release positions), a guided pacer exercise, and
 * the perineal-massage block (KEPT per Anuraj's decision — rendered as
 * normal product UI; the mockup's "Candidate — cuttable" tag and Keep/Cut
 * buttons were review affordances only and are not rendered).
 *
 * Contract: owns app/labor/pelvicfloor.tsx + src/labor/pelvicfloor/* only.
 * Imports only from src/theme/tokens and its own files. Entry comes from
 * the sibling-owned hub/week surfaces; back navigation is router.back().
 *
 * HARD RULE (Anuraj, Sept 20, 2026): NEVER add pattern-triggered alerts or
 * wording like "you may be in labor" / "time to go to the hospital" without
 * fresh copy and legal review.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontDisplay, radii, spacing } from '../../src/theme/tokens';
import {
  DISCLAIMER,
  HERO_COPY,
  PERINEAL_COPY,
} from '../../src/labor/pelvicfloor/copy';
import {
  currentPhase,
  dotStates,
  EXERCISE_ORDER,
  EXERCISES,
  restartSession,
  startSession,
  tickSession,
  type DotState,
  type ExerciseId,
  type SessionState,
} from '../../src/labor/pelvicfloor/exercises';
import { ExerciseTileIcon } from '../../src/labor/pelvicfloor/icons';
import { playSoftTone } from '../../src/labor/pelvicfloor/device';
import { requestScreenWakeLock } from '../../src/labor/keepAwake';

/** Mockup --body (#5C554D); tokens carry ink/muted but no body color. */
const BODY = '#5C554D';
/** Pacer circle: shrinks to 110, grows to 210 (mockup). */
const PACER_MIN = 110;
const PACER_MAX = 210;
/** After the "well done" state, return to the guide (mockup: 2200ms). */
const DONE_RETURN_MS = 2200;

type ScreenView = 'guide' | 'exercise';

const DOT_COLORS: Record<DotState, string> = {
  done: colors.sage,
  now: colors.coral,
  todo: colors.line,
};

function BackButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="pf-back"
      style={({ pressed }) => [
        styles.backBtn,
        pressed && { backgroundColor: colors.blush },
      ]}
    >
      <Text style={styles.backGlyph}>‹</Text>
    </Pressable>
  );
}

function Disclaimer() {
  return (
    <Text style={styles.disclaimer} testID="pf-disclaimer">
      {DISCLAIMER}
    </Text>
  );
}

export default function PelvicFloorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<ScreenView>('guide');
  const [session, setSession] = useState<SessionState | null>(null);
  const [toneOn, setToneOn] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pacerAnim = useRef(new Animated.Value(0)).current;
  const toneOnRef = useRef(toneOn);
  toneOnRef.current = toneOn;
  const wakeReleaseRef = useRef<(() => void) | null>(null);

  /** Release the held screen wake lock, if any. Safe to call any time. */
  const releaseWakeLock = useCallback(() => {
    try {
      wakeReleaseRef.current?.();
    } catch {
      /* never break the session */
    }
    wakeReleaseRef.current = null;
  }, []);

  const stopTimers = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
  }, []);

  /** Drive the pacer circle for a phase: grow ↔ shrink over phase secs. */
  const runPacerFor = useCallback(
    (grow: boolean, secs: number) => {
      pacerAnim.setValue(grow ? 0 : 1);
      Animated.timing(pacerAnim, {
        toValue: grow ? 1 : 0,
        duration: secs * 1000,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }).start();
    },
    [pacerAnim],
  );

  const leaveExercise = useCallback(() => {
    stopTimers();
    releaseWakeLock();
    setSession(null);
    setView('guide');
  }, [releaseWakeLock, stopTimers]);

  const beginSession = useCallback(
    (s: SessionState) => {
      stopTimers();
      const phase = currentPhase(s);
      setSession(s);
      setView('exercise');
      runPacerFor(phase.grow, phase.secs);
      releaseWakeLock();
      wakeReleaseRef.current = requestScreenWakeLock();
      intervalRef.current = setInterval(() => {
        setSession((prev) => {
          if (!prev || prev.status === 'done') return prev;
          const next = tickSession(prev);
          const advanced =
            next.phaseIndex !== prev.phaseIndex || next.round !== prev.round;
          if (next.status === 'done') {
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            doneTimerRef.current = setTimeout(() => {
              releaseWakeLock();
              setSession(null);
              setView('guide');
            }, DONE_RETURN_MS);
          } else if (advanced) {
            if (toneOnRef.current) playSoftTone();
            const ph = currentPhase(next);
            runPacerFor(ph.grow, ph.secs);
          }
          return next;
        });
      }, 1000);
    },
    [releaseWakeLock, runPacerFor, stopTimers],
  );

  const startExercise = useCallback(
    (id: ExerciseId) => beginSession(startSession(id)),
    [beginSession],
  );

  const handleRestart = useCallback(() => {
    if (session) beginSession(restartSession(session));
  }, [beginSession, session]);

  // Unmount while a session runs: stop timers, release the wake lock.
  useEffect(() => {
    return () => {
      stopTimers();
      releaseWakeLock();
    };
  }, [releaseWakeLock, stopTimers]);

  const pacerSize = pacerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [PACER_MIN, PACER_MAX],
  });

  if (view === 'exercise' && session) {
    const done = session.status === 'done';
    const phase = currentPhase(session);
    const phaseTitle = done ? 'well done' : phase.label;
    const phaseSub = done
      ? 'Notice how open everything feels. That feeling is the practice.'
      : phase.sub;
    const countText = done ? '✓' : String(session.remaining);
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]} testID="pf-exercise">
        <View style={styles.topbar}>
          <BackButton onPress={leaveExercise} label="Back to guide" />
          <Text style={styles.topTitle} numberOfLines={1}>
            {session.config.title}
          </Text>
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.pacerWrap}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pacerStage} accessibilityRole="progressbar">
            <View style={styles.pacerBg} />
            <Animated.View
              style={[
                styles.pacer,
                { width: pacerSize, height: pacerSize },
              ]}
            >
              <Text style={styles.pacerCount} testID="pf-count">
                {countText}
              </Text>
            </Animated.View>
          </View>
          <Text style={styles.phaseTitle} testID="pf-phase-title">
            {phaseTitle}
          </Text>
          <Text style={styles.phaseSub} testID="pf-phase-sub">
            {phaseSub}
          </Text>
          <View style={styles.dotsRow} testID="pf-dots" accessibilityRole="progressbar">
            {dotStates(session).map((d, i) => (
              <View key={i} style={[styles.dot, { backgroundColor: DOT_COLORS[d] }]} />
            ))}
          </View>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>Soft tone</Text>
              <Text style={styles.toggleSub}>Gentle sound at each phase change</Text>
            </View>
            <Pressable
              onPress={() => setToneOn((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: toneOn }}
              accessibilityLabel="Soft tone"
              testID="pf-tone-toggle"
              style={[styles.toggle, toneOn && styles.toggleOn]}
            >
              <View style={[styles.knob, toneOn && styles.knobOn]} />
            </Pressable>
          </View>
          <View style={styles.pacerCtl}>
            <Pressable
              onPress={handleRestart}
              accessibilityRole="button"
              testID="pf-restart"
              style={({ pressed }) => [
                styles.ctlBtn,
                styles.btnWhite,
                pressed && { backgroundColor: colors.blush },
              ]}
            >
              <Text style={styles.btnWhiteText}>Restart</Text>
            </Pressable>
            <Pressable
              onPress={leaveExercise}
              accessibilityRole="button"
              testID="pf-done"
              style={({ pressed }) => [
                styles.ctlBtn,
                styles.btnCoral,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.btnCoralText}>Done</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            {'Screen stays awake while you practice.\nNothing to tap unless you want to.'}
          </Text>
        </ScrollView>
        <View style={{ paddingBottom: insets.bottom }}>
          <Disclaimer />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="pf-screen">
      <View style={styles.topbar}>
        <BackButton onPress={() => router.back()} label="Back" />
        <Text style={styles.topTitle}>Pelvic-floor relaxation</Text>
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.guidePad, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.kicker}>{HERO_COPY.kicker}</Text>
          <Text style={styles.heroTitle}>{HERO_COPY.title}</Text>
          <Text style={styles.heroBody}>
            {HERO_COPY.intro.map((part, i) => (
              <Text key={i} style={part.bold ? styles.heroBold : undefined}>
                {part.text}
              </Text>
            ))}
          </Text>
        </View>
        {EXERCISE_ORDER.map((id) => {
          const ex = EXERCISES[id];
          return (
            <Pressable
              key={id}
              onPress={() => startExercise(id)}
              accessibilityRole="button"
              accessibilityLabel={`Start ${ex.title}`}
              testID={`pf-card-${id}`}
              style={({ pressed }) => [
                styles.exCard,
                pressed && { backgroundColor: colors.blush },
              ]}
            >
              <View style={[styles.tile, { backgroundColor: ex.tileBg }]}>
                <ExerciseTileIcon id={id} stroke={ex.tileStroke} />
              </View>
              <View style={styles.exText}>
                <Text style={styles.exTitle}>{ex.title}</Text>
                <Text style={styles.exDesc}>{ex.description}</Text>
                <View style={styles.timeChip}>
                  <Text style={styles.timeChipText}>{ex.timeChip}</Text>
                </View>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          );
        })}
        <View style={styles.perinealCard} testID="pf-perineal">
          <Text style={styles.perinealTitle}>{PERINEAL_COPY.title}</Text>
          <Text style={styles.perinealPara}>
            <Text style={styles.perinealBold}>{PERINEAL_COPY.introLead} </Text>
            <Text style={styles.perinealBodyText}>{PERINEAL_COPY.introRest}</Text>
          </Text>
          <View style={styles.bulletList}>
            {PERINEAL_COPY.bullets.map((b, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
          <View style={styles.safetyBox}>
            <Text style={styles.safetyText}>{PERINEAL_COPY.safety}</Text>
          </View>
        </View>
        <Disclaimer />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: {
    fontSize: 28,
    lineHeight: 30,
    color: colors.ink,
  },
  topTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontDisplay,
    fontSize: 19,
    fontWeight: '600',
    color: colors.ink,
    paddingRight: 48,
  },
  guidePad: {
    paddingHorizontal: 18,
    paddingTop: spacing.sm,
  },
  hero: {
    marginBottom: spacing.lg,
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginHorizontal: 4,
    marginBottom: 6,
  },
  heroTitle: {
    fontFamily: fontDisplay,
    fontSize: 27,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 34,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  heroBody: {
    fontSize: 15,
    lineHeight: 24,
    color: BODY,
    marginHorizontal: 4,
  },
  heroBold: {
    color: colors.ink,
    fontWeight: '700',
  },
  exCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginBottom: 10,
    minHeight: 88,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  tile: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  exText: {
    flex: 1,
    minWidth: 0,
  },
  exTitle: {
    fontSize: 16.5,
    fontWeight: '700',
    color: colors.ink,
    lineHeight: 22,
  },
  exDesc: {
    fontSize: 13.5,
    color: BODY,
    lineHeight: 20,
    marginTop: 3,
  },
  timeChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.blush,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 6,
  },
  timeChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  chev: {
    fontSize: 24,
    color: colors.muted,
    lineHeight: 28,
  },
  perinealCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginTop: 6,
    marginBottom: 12,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  perinealTitle: {
    fontFamily: fontDisplay,
    fontSize: 19,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 6,
  },
  perinealPara: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 10,
  },
  perinealBold: {
    color: colors.ink,
    fontWeight: '700',
  },
  perinealBodyText: {
    color: BODY,
  },
  bulletList: {
    marginBottom: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  bulletDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.sage,
    marginTop: 6,
    marginRight: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    color: BODY,
  },
  safetyBox: {
    backgroundColor: colors.blush,
    borderRadius: 12,
    padding: 12,
  },
  safetyText: {
    fontSize: 13.5,
    lineHeight: 21,
    color: colors.coralDeep,
    fontWeight: '700',
  },
  disclaimer: {
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.muted,
    textAlign: 'center',
    marginHorizontal: 20,
    marginTop: 18,
  },
  pacerWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingBottom: spacing.lg,
  },
  pacerStage: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  pacerBg: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.blush,
  },
  pacer: {
    borderRadius: 105,
    backgroundColor: colors.coralDeep,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C85F3E',
    shadowOpacity: 0.35,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 16 },
    elevation: 6,
  },
  pacerCount: {
    fontFamily: fontDisplay,
    fontSize: 46,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 52,
  },
  phaseTitle: {
    fontFamily: fontDisplay,
    fontSize: 24,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
    minHeight: 32,
    marginBottom: 6,
  },
  phaseSub: {
    fontSize: 15,
    lineHeight: 23,
    color: BODY,
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: 18,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 18,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    marginBottom: 12,
    minHeight: 60,
    width: '100%',
    maxWidth: 340,
  },
  toggleText: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  toggleSub: {
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 2,
  },
  toggle: {
    width: 60,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.line,
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  toggleOn: {
    backgroundColor: colors.sage,
  },
  knob: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  knobOn: {
    alignSelf: 'flex-end',
  },
  pacerCtl: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 340,
  },
  ctlBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnWhite: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    marginRight: 5,
  },
  btnWhiteText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  btnCoral: {
    backgroundColor: colors.coral,
    marginLeft: 5,
    shadowColor: '#DE7A59',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  btnCoralText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  hint: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 10,
    marginHorizontal: 30,
  },
});
