/**
 * "Her pattern" — the weekly kick-session list (Willow, mockup 22 —
 * Anuraj approved Sept 20, 2026).
 *
 * Full-screen overlay: plain session cards, one gentle pattern summary
 * (no grades, streaks, red/green verdicts, or safety claims), and the
 * evening reminder row. The reminder starts OFF; only "Yes, remind me"
 * enables it — "Not now", the sheet close, and scrim dismissal all leave
 * it off.
 */

import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet from '../components/BottomSheet';
import Toggle from '../components/Toggle';
import { colors, radii, spacing, type as typeScale } from '../theme/tokens';
import { recentKickSessions, deviationNote, deviationReason, patternSummaryLine } from './pattern';
import {
  formatKickDay,
  formatMovementsLine,
  formatStrengthNote,
  type KickSession,
} from './session';
import { listKickSessions } from './store';
import {
  isKickReminderEnabled,
  refreshKickReminder,
  setKickReminderEnabled,
} from './reminder';
import { KICK_CARE_LINE } from './KickCountingScreen';

export interface KickHistoryScreenProps {
  visible: boolean;
  onClose: () => void;
}

function SessionRow({
  session,
  prior,
}: {
  session: KickSession;
  prior: KickSession[];
}) {
  const reason = deviationReason(session, prior);
  const strengthNote = formatStrengthNote(session.strength);
  return (
    <View style={styles.row} testID={`kick-row-${session.id}`}>
      <Text style={styles.rowDate}>{formatKickDay(session.occurredAt)}</Text>
      <Text style={styles.rowMain}>{formatMovementsLine(session)}</Text>
      {strengthNote ? (
        <Text style={styles.rowSub}>{strengthNote}</Text>
      ) : null}
      {reason ? (
        <View style={styles.devnote}>
          <Text style={styles.devnoteText}>{deviationNote(reason)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ReminderOptInSheet({
  visible,
  onYes,
  onDismiss,
}: {
  visible: boolean;
  onYes: () => void;
  onDismiss: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onDismiss}
      accessibilityLabel="Evening reminder opt-in"
      testID="kick-reminder-sheet"
    >
      <View style={styles.sheetBody}>
        <Text style={styles.sheetTitle}>A quiet evening nudge?</Text>
        <Text style={styles.sheetCopy}>
          Most evenings she moves around 8. If you&apos;d like, we&apos;ll
          send one gentle reminder — never more, and you can pause it
          anytime.
        </Text>
        <Pressable
          testID="kick-reminder-yes"
          accessibilityRole="button"
          accessibilityLabel="Yes, remind me"
          onPress={onYes}
          style={({ pressed }) => [styles.yesBtn, pressed && styles.pressed]}
        >
          <Text style={styles.yesText}>Yes, remind me</Text>
        </Pressable>
        <Pressable
          testID="kick-reminder-notnow"
          accessibilityRole="button"
          accessibilityLabel="Not now"
          onPress={onDismiss}
          style={styles.notNowBtn}
        >
          <Text style={styles.notNowText}>Not now</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

export default function KickHistoryScreen({
  visible,
  onClose,
}: KickHistoryScreenProps) {
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<KickSession[]>([]);
  const [reminderOn, setReminderOn] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSessions(listKickSessions());
    setReminderOn(isKickReminderEnabled());
    setSheetVisible(false);
    // Reconcile scheduling with the persisted choice (and stop it on its
    // own when the pregnancy ends).
    void refreshKickReminder();
  }, [visible]);

  if (!visible) return null;

  const patternLine = patternSummaryLine(sessions);

  const handleToggle = (next: boolean) => {
    if (next) {
      // Opt-in only: the sheet asks first; nothing turns on until she
      // says "Yes, remind me".
      setSheetVisible(true);
      return;
    }
    // One-tap pause.
    setReminderOn(false);
    void setKickReminderEnabled(false);
  };

  const handleYes = () => {
    setSheetVisible(false);
    setReminderOn(true);
    void setKickReminderEnabled(true);
  };

  const handleSheetDismiss = () => {
    // "Not now", the sheet ×, and scrim dismissal all leave it off.
    setSheetVisible(false);
  };

  return (
    <View
      style={[styles.root, { paddingTop: insets.top }]}
      testID="kick-history-screen"
    >
      <View style={styles.header}>
        <Pressable
          testID="kick-history-back"
          accessibilityRole="button"
          accessibilityLabel="Back to Week"
          onPress={onClose}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Text style={styles.backText}>‹ Week</Text>
        </Pressable>
        <Text style={styles.title}>Her pattern</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.patternCard} testID="kick-pattern-card">
          <Text style={styles.patternEyebrow}>What we&apos;re learning</Text>
          <Text style={styles.patternLine}>
            {patternLine ??
              'A couple more sessions and we’ll start seeing her pattern.'}
          </Text>
        </View>

        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            prior={recentKickSessions(sessions, s.id, undefined, s.occurredAt)}
          />
        ))}

        <View style={styles.reminderCard} testID="kick-reminder-card">
          <View style={styles.reminderRow}>
            <View style={styles.reminderText}>
              <Text style={styles.reminderTitle}>Evening reminder</Text>
              <Text style={styles.reminderSub}>
                A quiet nudge around 8:00 PM
              </Text>
            </View>
            <Toggle
              testID="kick-reminder-toggle"
              accessibilityLabel="Evening kick reminder"
              value={reminderOn}
              onValueChange={handleToggle}
            />
          </View>
        </View>
        <Text style={styles.reminderNote}>
          Off unless you say so. Pauses in one tap, and stops on its own if
          your pregnancy ends — no reminder should ever outstay its welcome.
        </Text>

        <Text style={styles.care}>{KICK_CARE_LINE}</Text>
      </ScrollView>

      <ReminderOptInSheet
        visible={sheetVisible}
        onYes={handleYes}
        onDismiss={handleSheetDismiss}
      />
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
  back: {
    minWidth: 64,
    minHeight: 44,
    justifyContent: 'center',
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.coralDeep,
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
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  patternCard: {
    backgroundColor: colors.sageTint,
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  patternEyebrow: {
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.sageDeep,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  patternLine: {
    fontFamily: 'Georgia',
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
  },
  row: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  rowDate: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 2,
  },
  rowMain: {
    fontSize: 15.5,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 23,
  },
  rowSub: {
    fontSize: 13.5,
    color: colors.muted,
    marginTop: 2,
  },
  devnote: {
    backgroundColor: '#FAF6F0',
    borderRadius: 12,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  devnoteText: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#6B5F52',
  },
  reminderCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: spacing.lg,
    marginTop: spacing.md,
    shadowColor: '#2F2B27',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reminderText: {
    flex: 1,
  },
  reminderTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  reminderSub: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  reminderNote: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  care: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xl,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },
  sheetBody: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  sheetTitle: {
    fontFamily: 'Georgia',
    fontSize: 22,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
  },
  sheetCopy: {
    ...typeScale.body,
    color: '#5C554D',
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  yesBtn: {
    backgroundColor: colors.coral,
    borderRadius: 18,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  notNowBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notNowText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.muted,
  },
});
