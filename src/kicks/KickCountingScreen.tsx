/**
 * Kick counting screen (Willow, mockup 24 — Anuraj approved Sept 20, 2026).
 *
 * Full-screen overlay: giant tap area counts every kick, flutter, or
 * roll; elapsed timer counts UP (never a countdown); pause/resume; end
 * early without scolding; the summary opens automatically at ten
 * movements. Optional strength, save-to-journal or discard, and the exact
 * care line. An always-visible × exits from every phase.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, type as typeScale } from '../theme/tokens';
import {
  formatElapsed,
  formatKickWeekdayTime,
  formatMovementsLine,
  KICK_SESSION_TARGET,
  KICK_STRENGTHS,
  type KickStrength,
} from './session';
import { saveKickSession } from './store';

export interface KickCountingScreenProps {
  visible: boolean;
  onClose: () => void;
  /** Fires after a session is saved (the Week tab retires the Home card). */
  onSaved: () => void;
}

type Phase = 'counting' | 'paused' | 'summary';

/** Exact care line (Anuraj-approved). */
export const KICK_CARE_LINE =
  'Quieter than usual? Contact your provider — they’d rather hear from you.';

const STRENGTH_LABELS: Record<KickStrength, string> = {
  fluttery: 'Fluttery',
  usual: 'Usual',
  strong: 'Strong',
};

function Toast({ message }: { message: string }) {
  return (
    <View style={styles.toastWrap} pointerEvents="none">
      <View style={styles.toast} testID="kick-toast">
        <Text style={styles.toastText}>{message}</Text>
      </View>
    </View>
  );
}

export default function KickCountingScreen({
  visible,
  onClose,
  onSaved,
}: KickCountingScreenProps) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('counting');
  const [count, setCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [strength, setStrength] = useState<KickStrength | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const pausedMs = useRef(0);
  const runStartMs = useRef(0);
  const startedAt = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fresh session every time the overlay opens.
  useEffect(() => {
    if (!visible) return;
    setPhase('counting');
    setCount(0);
    setElapsedSec(0);
    setStrength(null);
    setToast(null);
    pausedMs.current = 0;
    startedAt.current = new Date().toISOString();
  }, [visible]);

  // Elapsed timer: counts up while counting, frozen while paused.
  useEffect(() => {
    if (!visible || phase !== 'counting') return;
    runStartMs.current = Date.now();
    const id = setInterval(() => {
      setElapsedSec(
        Math.floor((pausedMs.current + Date.now() - runStartMs.current) / 1000),
      );
    }, 500);
    return () => clearInterval(id);
  }, [visible, phase]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  if (!visible) return null;

  const showToast = (message: string, thenClose: boolean) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(
      () => {
        setToast(null);
        if (thenClose) onClose();
      },
      2000,
    );
  };

  const handleTap = () => {
    if (phase !== 'counting') return;
    const next = count + 1;
    setCount(next);
    if (next >= KICK_SESSION_TARGET) {
      setPhase('summary');
    }
  };

  const handlePause = () => {
    if (phase !== 'counting') return;
    pausedMs.current += Date.now() - runStartMs.current;
    setElapsedSec(Math.floor(pausedMs.current / 1000));
    setPhase('paused');
  };

  const handleResume = () => setPhase('counting');

  /** End early: no "incomplete", no scolding. Zero taps → nothing to save. */
  const handleEnd = () => {
    if (count === 0) {
      showToast('Session ended — nothing was saved.', true);
      return;
    }
    setPhase('summary');
  };

  /** The × exits from every phase; nothing is ever saved on exit. */
  const handleExit = () => {
    showToast('Session ended — nothing was saved.', true);
  };

  const handleSave = () => {
    const saved = saveKickSession({
      movements: count,
      durationSec: elapsedSec,
      strength,
      occurredAt: startedAt.current,
    });
    if (saved) onSaved();
    onClose();
  };

  return (
    <View
      style={[styles.root, { paddingTop: insets.top }]}
      testID="kick-counting-screen"
    >
      {/* Header: always-visible ×, centered title. */}
      <View style={styles.header}>
        <Pressable
          testID="kick-exit"
          accessibilityRole="button"
          accessibilityLabel="Exit counting session"
          onPress={handleExit}
          style={({ pressed }) => [styles.xbtn, pressed && styles.pressed]}
        >
          <Text style={styles.xglyph}>×</Text>
        </Pressable>
        <Text style={styles.title}>Kick counting</Text>
        <View style={styles.xspacer} />
      </View>

      {phase === 'summary' ? (
        <ScrollView
          contentContainerStyle={styles.summaryScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.summaryCard} testID="kick-summary">
            <Text style={styles.eyebrow}>Your session</Text>
            <Text style={styles.headline}>
              {formatMovementsLine({ movements: count, durationSec: elapsedSec })}
            </Text>
            <Text style={styles.dateline}>
              {formatKickWeekdayTime(startedAt.current)}
            </Text>
            <Text style={styles.prompt}>
              How did they feel? Optional — skip if you like.
            </Text>
            <View style={styles.strengthRow}>
              {KICK_STRENGTHS.map((s) => {
                const selected = strength === s;
                return (
                  <Pressable
                    key={s}
                    testID={`kick-strength-${s}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Strength: ${STRENGTH_LABELS[s]}`}
                    accessibilityState={{ selected }}
                    onPress={() => setStrength(selected ? null : s)}
                    style={({ pressed }) => [
                      styles.strengthChip,
                      selected && styles.strengthChipSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.strengthText,
                        selected && styles.strengthTextSelected,
                      ]}
                    >
                      {STRENGTH_LABELS[s]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              testID="kick-save"
              accessibilityRole="button"
              accessibilityLabel="Save session to journal"
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.saveText}>Save to journal</Text>
            </Pressable>
            <Pressable
              testID="kick-discard"
              accessibilityRole="button"
              accessibilityLabel="Discard session"
              onPress={onClose}
              style={styles.quietBtn}
            >
              <Text style={styles.quietText}>Discard</Text>
            </Pressable>
          </View>
          <Text style={styles.care}>{KICK_CARE_LINE}</Text>
        </ScrollView>
      ) : (
        <View style={styles.countingWrap}>
          <Text style={styles.elapsed} testID="kick-elapsed">
            {formatElapsed(elapsedSec)} elapsed
          </Text>
          <Text style={styles.count} testID="kick-count">
            {count}
          </Text>
          <Text style={styles.ofTarget}>
            of {KICK_SESSION_TARGET} movements
          </Text>

          {/* The giant tap area — the whole card counts. */}
          <Pressable
            testID="kick-tapzone"
            accessibilityRole="button"
            accessibilityLabel="Tap for each movement"
            onPress={handleTap}
            style={({ pressed }) => [
              styles.tapzone,
              pressed && styles.tapzonePressed,
            ]}
          >
            <Text style={styles.tapTitle}>
              Tap for every kick,{'\n'}flutter, or roll
            </Text>
            <Text style={styles.tapSub}>
              the whole card counts — no need to look
            </Text>
          </Pressable>

          {phase === 'paused' ? (
            <View style={styles.pausedOverlay} testID="kick-paused">
              <Text style={styles.pausedTitle}>Paused</Text>
              <Text style={styles.pausedSub}>
                Take your time — the clock is stopped.
              </Text>
              <Pressable
                testID="kick-resume"
                accessibilityRole="button"
                accessibilityLabel="Resume counting"
                onPress={handleResume}
                style={({ pressed }) => [
                  styles.resumeBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.resumeText}>Resume</Text>
              </Pressable>
              <Pressable
                testID="kick-end-paused"
                accessibilityRole="button"
                accessibilityLabel="End session"
                onPress={handleEnd}
                style={styles.quietBtn}
              >
                <Text style={styles.quietText}>End session</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.footer}>
            <Pressable
              testID="kick-pause"
              accessibilityRole="button"
              accessibilityLabel="Pause counting"
              onPress={handlePause}
              style={({ pressed }) => [
                styles.pauseBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.pauseText}>Pause</Text>
            </Pressable>
            <Pressable
              testID="kick-end"
              accessibilityRole="button"
              accessibilityLabel="End session"
              onPress={handleEnd}
              style={({ pressed }) => [
                styles.endBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.endText}>End session</Text>
            </Pressable>
          </View>
          <Text style={styles.care}>{KICK_CARE_LINE}</Text>
        </View>
      )}

      {toast ? <Toast message={toast} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#FBF7F1',
    zIndex: 30,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  xbtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  xglyph: {
    fontSize: 24,
    lineHeight: 28,
    color: colors.ink,
  },
  xspacer: {
    width: 48,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Georgia',
    fontSize: 19,
    fontWeight: '600',
    color: colors.ink,
  },
  pressed: {
    opacity: 0.7,
  },
  countingWrap: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  elapsed: {
    fontSize: 13,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  count: {
    fontFamily: 'Georgia',
    fontSize: 74,
    lineHeight: 84,
    fontWeight: '600',
    color: colors.ink,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  ofTarget: {
    fontSize: 15,
    color: colors.muted,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  tapzone: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    minHeight: 220,
  },
  tapzonePressed: {
    backgroundColor: colors.blush,
  },
  tapTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 26,
  },
  tapSub: {
    fontSize: 13.5,
    color: colors.muted,
    textAlign: 'center',
  },
  pausedOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#FBF7F1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm,
  },
  pausedTitle: {
    fontFamily: 'Georgia',
    fontSize: 22,
    fontWeight: '600',
    color: colors.ink,
  },
  pausedSub: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  resumeBtn: {
    backgroundColor: colors.coral,
    borderRadius: 18,
    minHeight: 56,
    minWidth: 220,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  resumeText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  quietBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  quietText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.muted,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  pauseBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 18,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  pauseText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  endBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 18,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  endText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  care: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },
  summaryScroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.xl,
    gap: spacing.sm,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
  },
  headline: {
    fontFamily: 'Georgia',
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '600',
    color: colors.ink,
  },
  dateline: {
    fontSize: 14,
    color: colors.muted,
  },
  prompt: {
    fontSize: 14,
    color: '#5C554D',
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  strengthRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  strengthChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E4D9CB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  strengthChipSelected: {
    borderColor: colors.coral,
    backgroundColor: colors.blush,
  },
  strengthText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  strengthTextSelected: {
    color: colors.coralDeep,
  },
  saveBtn: {
    backgroundColor: colors.coral,
    borderRadius: 18,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  saveText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 64,
    alignItems: 'center',
  },
  toast: {
    backgroundColor: '#2F2B27',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    maxWidth: '86%',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
