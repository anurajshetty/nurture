/**
 * Full-screen Lamaze breathing pacer (Willow, Sept 2026).
 *
 * Design mockup 28: the pacer always shows three cues at once — the
 * expanding/contracting orb (what the lungs do), the phase label, and a big
 * count of seconds left in the phase. Gentle motion only: one calm Animated
 * scale per phase, a soft pulse ring at phase changes, no jitter.
 *
 * Runs OUTSIDE the tab group (route /labor/breathing), so the tab bar is
 * genuinely hidden mid-round — not covered. Screen stays awake via the Web
 * Wake Lock API while the round is active. Haptic pulse and soft tone are
 * independent switches; eyes-closed mode is the warm dark treatment.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import {
  PATTERNS,
  tickView,
  type BreathKind,
  type PatternId,
  type SeqPhase,
  type TickView,
} from './patterns';
import { requestScreenWakeLock } from '../keepAwake';
import { playSoftTone } from './tone';
import { BellIcon, BuzzIcon, ChevronLeftIcon, MoonIcon, SunIcon } from './icons';
import { colors, fontDisplay, minTouch, radii, spacing, type as typeScale } from '../../theme/tokens';

const TICK_MS = 200;
const ORB_IN_SCALE = 1;
const ORB_OUT_SCALE = 0.55;

const dim = {
  bg: '#241E18',
  ink: '#F7F1E6',
  body: '#B7A893',
  tag: '#F0A37E',
  track: '#3A322A',
  card: '#2E2720',
  cardLine: '#4A4138',
  orbHi: '#E89B7C',
  orbLo: '#B45A38',
} as const;

type PacerProps = {
  patternId: PatternId;
  seq: SeqPhase[];
  startedAtMs: number;
  /** gentle stop — back to the pattern list */
  onExit: () => void;
  /** round finished naturally — to the round-complete screen */
  onDone: () => void;
};

function orbTarget(kind: BreathKind): number {
  return kind === 'in' ? ORB_IN_SCALE : ORB_OUT_SCALE;
}

export default function Pacer({ patternId, seq, startedAtMs, onExit, onDone }: PacerProps) {
  const pattern = PATTERNS[patternId];
  const [view, setView] = useState<TickView>(() => tickView(seq, startedAtMs, startedAtMs));
  const [haptic, setHaptic] = useState(false);
  const [tone, setTone] = useState(false);
  const [eyesClosed, setEyesClosed] = useState(false);

  const orbScale = useRef(new Animated.Value(ORB_OUT_SCALE)).current;
  // Rest state is 1 (opacity 0 = invisible); a pulse sets 0 and animates to 1.
  const haloT = useRef(new Animated.Value(1)).current;
  const lastPhaseIdx = useRef(-1);
  const doneFired = useRef(false);
  const flagsRef = useRef({ haptic, tone });
  flagsRef.current = { haptic, tone };

  // Wake lock for the whole round; released on exit/unmount.
  useEffect(() => {
    const release = requestScreenWakeLock();
    return release;
  }, []);

  // Fire the phase-change cues: orb retarget, halo pulse + vibration, tone.
  useEffect(() => {
    if (view.done || view.phaseIndex === lastPhaseIdx.current) return;
    lastPhaseIdx.current = view.phaseIndex;
    const phase = seq[view.phaseIndex];
    if (!phase) return;

    Animated.timing(orbScale, {
      toValue: orbTarget(phase.kind),
      duration: Math.max(300, phase.s * 1000),
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();

    const { haptic: h, tone: t } = flagsRef.current;
    if (h) {
      haloT.setValue(0);
      Animated.timing(haloT, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      try {
        Vibration.vibrate(25);
      } catch {
        /* never break the pacer */
      }
    }
    if (t) playSoftTone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.phaseIndex]);

  // 200ms drift-resistant ticking, computed from absolute elapsed time.
  useEffect(() => {
    const timer = setInterval(() => {
      const v = tickView(seq, startedAtMs, Date.now());
      setView(v);
      if (v.done && !doneFired.current) {
        doneFired.current = true;
        onDone();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, startedAtMs]);

  const c = eyesClosed ? dim : null;
  const ink = c?.ink ?? colors.ink;
  const body = c?.body ?? colors.muted;
  const tagColor = c?.tag ?? colors.coralDeep;

  const haloScale = haloT.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.35] });
  const haloOpacity = haloT.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });

  return (
    <View style={[styles.root, c && { backgroundColor: c.bg }]} testID="pacer-screen">
      <StatusBar style={eyesClosed ? 'light' : 'dark'} />

      <View style={styles.topbar}>
        <Pressable
          onPress={onExit}
          accessibilityRole="button"
          accessibilityLabel="Back to patterns"
          testID="pacer-back"
          style={[styles.backBtn, c && { backgroundColor: 'transparent' }]}
        >
          <ChevronLeftIcon color={ink} />
        </Pressable>
        <Text style={[styles.topTitle, { color: ink }]} numberOfLines={1}>
          {pattern.name}
        </Text>
        <View style={styles.topSpacer} />
      </View>

      <View style={styles.prow}>
        <View style={[styles.pbar, c && { backgroundColor: c.track }]} testID="pacer-progress">
          <View style={[styles.pbarFill, { width: `${Math.round(view.progress * 100)}%` }]} />
        </View>
        <Text style={[styles.ptime, { color: body }]}>{view.totalLeftLabel}</Text>
      </View>

      <Text style={[styles.tag, { color: tagColor }]}>{view.tag}</Text>
      <Text style={[styles.pname, { color: body }]}>
        {pattern.tag} · about a minute
      </Text>

      <View style={styles.orbWrap} testID="pacer-orb">
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            { borderColor: c?.tag ?? colors.coral },
            { transform: [{ scale: haloScale }], opacity: haloOpacity },
          ]}
        />
        <Animated.View style={{ transform: [{ scale: orbScale }] }}>
          <Svg width={190} height={190} viewBox="0 0 190 190" accessible={false}>
            <Defs>
              <RadialGradient id="breathOrb" cx="35%" cy="30%" r="72%">
                <Stop offset="0%" stopColor={c?.orbHi ?? '#F2B294'} />
                <Stop offset="100%" stopColor={c?.orbLo ?? colors.coral} />
              </RadialGradient>
            </Defs>
            <Circle cx="95" cy="95" r="95" fill="url(#breathOrb)" />
          </Svg>
        </Animated.View>
      </View>

      <Text
        style={[styles.phase, { color: ink }]}
        accessibilityLiveRegion="polite"
        testID="pacer-phase"
      >
        {view.label}
      </Text>
      <Text style={[styles.count, { color: body }]} testID="pacer-count">
        {view.done ? '' : String(view.phaseSecondsLeft)}
      </Text>

      <View style={styles.psettings}>
        <SwitchButton
          label="Haptic"
          icon={<BuzzIcon color={haptic ? (c?.tag ?? colors.coralDeep) : body} />}
          checked={haptic}
          dimmed={eyesClosed}
          onToggle={() => {
            const next = !haptic;
            setHaptic(next);
            if (next) {
              haloT.setValue(0);
              Animated.timing(haloT, {
                toValue: 1,
                duration: 800,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
              }).start();
              try {
                Vibration.vibrate(25);
              } catch {
                /* never break the pacer */
              }
            }
          }}
          testID="switch-haptic"
        />
        <SwitchButton
          label="Tone"
          icon={<BellIcon color={tone ? (c?.tag ?? colors.coralDeep) : body} />}
          checked={tone}
          dimmed={eyesClosed}
          onToggle={() => {
            const next = !tone;
            setTone(next);
            if (next) playSoftTone();
          }}
          testID="switch-tone"
        />
      </View>

      <Pressable
        onPress={() => setEyesClosed((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={eyesClosed ? 'Back to light' : 'Eyes-closed mode'}
        testID="eyes-closed-btn"
        style={[styles.eyesBtn, c && { backgroundColor: c.card, borderColor: c.cardLine }]}
      >
        {eyesClosed ? <SunIcon color={dim.tag} /> : <MoonIcon color={colors.coralDeep} />}
        <Text style={[styles.eyesText, { color: ink }]}>{eyesClosed ? 'Back to light' : 'Eyes-closed'}</Text>
      </Pressable>
      {eyesClosed && (
        <Text style={[styles.awake, { color: dim.body }]}>Screen stays awake while you practice</Text>
      )}

      <Pressable
        onPress={onExit}
        accessibilityRole="button"
        accessibilityLabel="End practice"
        testID="end-practice-btn"
        style={styles.endBtn}
      >
        <Text style={styles.endText}>End practice</Text>
      </Pressable>
    </View>
  );
}

function SwitchButton({
  label,
  icon,
  checked,
  dimmed,
  onToggle,
  testID,
}: {
  label: string;
  icon: ReactNode;
  checked: boolean;
  dimmed: boolean;
  onToggle: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      aria-checked={checked}
      accessibilityLabel={`${label} ${checked ? 'on' : 'off'}`}
      testID={testID}
      style={[
        styles.swbtn,
        dimmed && { backgroundColor: dim.card, borderColor: dim.cardLine },
        checked && { borderColor: dimmed ? dim.tag : colors.sage },
      ]}
    >
      <View style={styles.swLabel}>
        {icon}
        <Text style={[styles.swLabelText, dimmed && { color: dim.ink }]}>{label}</Text>
      </View>
      <View
        style={[
          styles.sw,
          dimmed && { backgroundColor: dim.cardLine },
          checked && { backgroundColor: colors.sage },
        ]}
      >
        <View style={[styles.knob, checked && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 22,
    paddingBottom: 30,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTouch,
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
  topTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontDisplay,
    fontSize: 15,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '600',
    color: colors.ink,
  },
  topSpacer: { width: minTouch },
  prow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  pbar: {
    flex: 1,
    height: 5,
    borderRadius: 99,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  pbarFill: {
    height: '100%',
    backgroundColor: colors.coral,
    borderRadius: 99,
  },
  ptime: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.muted,
    marginLeft: 10,
    fontVariant: ['tabular-nums'],
  },
  tag: {
    textAlign: 'center',
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 2,
  },
  pname: {
    textAlign: 'center',
    fontFamily: fontDisplay,
    fontSize: 17,
    color: colors.muted,
    marginBottom: 6,
  },
  orbWrap: {
    flex: 1,
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    borderColor: colors.coral,
    opacity: 0,
  },
  phase: {
    fontFamily: fontDisplay,
    fontSize: 34,
    textAlign: 'center',
    color: colors.ink,
    marginTop: 6,
    marginBottom: 2,
    minHeight: 46,
  },
  count: {
    fontSize: 52,
    fontWeight: '200',
    textAlign: 'center',
    color: colors.muted,
    lineHeight: 56,
    marginBottom: 10,
    fontVariant: ['tabular-nums'],
  },
  psettings: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  swbtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 16,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 12,
    minHeight: 56,
    marginRight: 5,
  },
  swLabel: { flexDirection: 'row', alignItems: 'center' },
  swLabelText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.ink,
    marginLeft: 8,
  },
  sw: {
    width: 46,
    height: 28,
    borderRadius: 99,
    backgroundColor: colors.toggleOff,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  knob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
  },
  knobOn: { alignSelf: 'flex-end' },
  eyesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 12,
    minHeight: 56,
    marginBottom: 10,
  },
  eyesText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: colors.ink,
    marginLeft: 9,
  },
  awake: {
    fontSize: 12.5,
    color: dim.body,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 18,
  },
  endBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.coral,
    borderRadius: radii.button,
    minHeight: 58,
  },
  endText: {
    color: '#FFFFFF',
    fontSize: 16.5,
    fontWeight: '700',
  },
});
