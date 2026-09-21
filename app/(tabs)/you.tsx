import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getPrefs,
  requestNotificationPermissions,
  updatePrefs,
} from '../../src/notifications/prefs';
import { exportArchive, requestAccountDeletion } from '../../src/privacy/privacy';
import { getActivePregnancy, updatePregnancy } from '../../src/sync/store';
import {
  countSharedMoments,
  getDataDecisions,
  isAfterwards,
  recordDataDecision,
  stopPregnancyTracking,
  stopReminderPatch,
  toggleDataRow,
  type DataRowId,
  type DataRowState,
} from '../../src/support/aftermath';
import {
  hasPartnerToDecideAbout,
  readPartnerSnapshot,
  removePartnerAccess,
  type PartnerSnapshot,
} from '../../src/support/partnerLink';
import {
  DECIDE_LATER_LABEL,
  DECIDE_LATER_TOAST,
  DELETE_GUARD_CONFIRM,
  DELETE_GUARD_FINE,
  DELETE_GUARD_KEEP,
  DELETE_GUARD_KEPT_TOAST,
  DELETE_GUARD_DELETED_TOAST,
  DELETE_GUARD_LEDE,
  DELETE_GUARD_TITLE,
  ITS_DONE_LEDE,
  ITS_DONE_TITLE,
  STOPPED_LIST_COPY,
  STORY_KICK,
  STORY_LEDE,
} from '../../src/support/afterwardsCopy';
import type { AftermathDecisions } from '../../src/lib/types';
import {
  getBabyName,
  setBabyName,
} from '../../src/briefing/context';
import { clearBriefing } from '../../src/briefing/cache';
import {
  addDaysISO,
  formatLong,
  parseISODate,
  todayISO,
  toISODate,
  validateDob,
  validateDueDate,
  weekOf,
} from '../../src/onboarding/dates';
import { REQUIRED_DATE_ERROR } from '../../src/onboarding/profile';
import {
  BottomSheet,
  Button,
  Card,
  DatePickerField,
  Screen,
  SectionHeader,
  SettingsRow,
  Toggle,
} from '../../src/components';
import { colors, radii, spacing, type as typeScale } from '../../src/theme/tokens';
import { getPartnerLink, type PartnerLink } from '../../src/partner/model';
import PartnerSheet from '../../src/partner/PartnerSheet';


const NUDGE_MIN = 17 * 60; // 5:00 PM
const NUDGE_MAX = 21 * 60; // 9:00 PM
const NUDGE_STEP = 30;

type Disposition = 'keep' | 'export' | 'delete';

const DISPOSITIONS: { id: Disposition; title: string; sub: string }[] = [
  {
    id: 'keep',
    title: 'Keep my data in the app',
    sub: 'Your timeline stays as memories. No new pregnancy content, no notifications.',
  },
  {
    id: 'export',
    title: 'Export first',
    sub: 'Download your story, then stop tracking.',
  },
  {
    id: 'delete',
    title: 'Delete everything',
    sub: 'Remove all pregnancy data from the app.',
  },
];

function formatClock(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

function formatHour(hhmm: string): string {
  const h = Number(hhmm.split(':')[0]);
  if (!Number.isFinite(h)) return hhmm;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
}

function toClock(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function clockToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Parses YYYY-MM-DD strictly; today when the string is not a real date. */
function dateOrToday(iso: string): Date {
  return parseISODate(iso) ?? new Date();
}

/** Small − / value / + stepper used for lead time and nudge time. */
function TimeStepper({
  value,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
  testID,
}: {
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseLabel: string;
  increaseLabel: string;
  testID?: string;
}) {
  return (
    <View style={styles.stepper} testID={testID}>
      <Pressable
        onPress={onDecrease}
        accessibilityRole="button"
        accessibilityLabel={decreaseLabel}
        style={({ pressed }) => [styles.stepButton, pressed && styles.stepPressed]}
      >
        <Text style={styles.stepGlyph}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable
        onPress={onIncrease}
        accessibilityRole="button"
        accessibilityLabel={increaseLabel}
        style={({ pressed }) => [styles.stepButton, pressed && styles.stepPressed]}
      >
        <Text style={styles.stepGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

/** Epic 9 — one expand-to-choose data row (module-level; pure presentational). */
export interface DataRowOption {
  key: string;
  label: string;
  /** Dark quiet button (the delete row's option). */
  dark?: boolean;
  testID: string;
  onChoose: () => void;
}

export interface DataRowDef {
  id: DataRowId;
  title: string;
  subtitle: string;
  body: string;
  /** Non-null once decided — renders the quiet ✓ + label state. */
  decidedLabel: string | null;
  options: DataRowOption[];
}

function DataRow({
  row,
  open,
  onToggle,
  onChoose,
}: {
  row: DataRowDef;
  open: boolean;
  onToggle: () => void;
  onChoose: (option: DataRowOption) => void;
}) {
  const decided = row.decidedLabel !== null && !open;
  const testID = `data-row-${row.id}`;
  return (
    <View style={[styles.drow, decided && styles.drowDone]} testID={testID}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          decided
            ? `${row.title}. Decided: ${row.decidedLabel}. Tap to change.`
            : `${row.title}. ${open ? 'Collapse' : 'Expand'}. ${row.subtitle}.`
        }
        style={({ pressed }) => [styles.drowHead, pressed && styles.quietPressed]}
        testID={`${testID}-header`}
      >
        <View style={styles.drowText}>
          <Text style={styles.drowTitle}>{row.title}</Text>
          <Text style={styles.drowSub}>{row.subtitle}</Text>
        </View>
        {decided ? (
          <View style={styles.decided} testID={`${testID}-decided`}>
            <View style={styles.check} accessibilityElementsHidden>
              <Text style={styles.checkGlyph}>✓</Text>
            </View>
            <Text style={styles.decidedLabel}>{row.decidedLabel}</Text>
          </View>
        ) : (
          <Text style={[styles.drowChev, open && styles.drowChevOpen]} accessibilityElementsHidden>
            ›
          </Text>
        )}
      </Pressable>
      {open && !decided ? (
        <View style={styles.drowBody} testID={`${testID}-options`}>
          <Text style={styles.drowBodyText}>{row.body}</Text>
          {row.options.map((o) =>
            o.dark ? (
              <Pressable
                key={o.key}
                onPress={() => onChoose(o)}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                style={({ pressed }) => [styles.optDark, pressed && styles.optDarkPressed]}
                testID={o.testID}
              >
                <Text style={styles.optDarkText}>{o.label}</Text>
              </Pressable>
            ) : (
              <Button
                key={o.key}
                title={o.label}
                variant="ghost"
                onPress={() => onChoose(o)}
                style={styles.optButton}
                testID={o.testID}
              />
            ),
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * You — the control room: notification pause + reminders, deep links to
 * partner / export / privacy / pregnancy settings, and the quiet
 * stop-tracking row. Built from design/06-reminders.html.
 */
export default function YouScreen() {
  const router = useRouter();
  const [endOfDayEnabled, setEndOfDayEnabled] = useState(true);
  const [endOfDayTime, setEndOfDayTime] = useState('20:30');
  const [appointmentReminders, setAppointmentReminders] = useState(true);
  const [globalPauseUntil, setGlobalPauseUntil] = useState<string | null>(null);
  const [quietHours, setQuietHours] = useState({ start: '21:00', end: '08:00' });

  const [stopOpen, setStopOpen] = useState(false);
  const [stopPhase, setStopPhase] = useState<'choose' | 'done' | 'guard'>('choose');
  const [disposition, setDisposition] = useState<Disposition>('keep');
  const [stopping, setStopping] = useState(false);

  // Epic 9 — the "It's done." aftermath: expand-to-choose data decisions.
  const [decisions, setDecisions] = useState<AftermathDecisions>({});
  const [openRow, setOpenRow] = useState<DataRowId | null>(null);
  const [partnerSnap, setPartnerSnap] = useState<PartnerSnapshot | null>(null);
  const [sharedCount, setSharedCount] = useState(0);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Baby name (Sept 2026): optional, local-only — hers to keep, shown
  // back in this row.
  const [babyName, setBabyNameState] = useState<string | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // Account (onboarding profile, Sept 2026): her name, due date, and
  // birthday live on the pregnancy record and sync like the rest of it.
  // The baby name above stays local-only. Anyone who onboarded with
  // missing or wrong details can fix them here.
  const [ownerName, setOwnerNameState] = useState<string | null>(null);
  const [ownerNameOpen, setOwnerNameOpen] = useState(false);
  const [ownerNameDraft, setOwnerNameDraft] = useState('');
  const [dueDate, setDueDateState] = useState<string | null>(null);
  const [dueOpen, setDueOpen] = useState(false);
  const [dueDraft, setDueDraft] = useState<string | null>(null);
  // Mockup 31: attempting Save without a picked date shows the verbatim
  // inline error; it clears the moment she picks.
  const [dueError, setDueError] = useState<string | null>(null);
  const [dob, setDobState] = useState<string | null>(null);
  const [dobSheetOpen, setDobSheetOpen] = useState(false);
  const [dobDraft, setDobDraft] = useState<string | null>(null);

  // Partner sharing (Epic 7): the settings row opens the partner sheet;
  // the subtitle always reflects the live link state.
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [partnerLink, setPartnerLink] = useState<PartnerLink>(() => {
    try {
      return getPartnerLink();
    } catch {
      return { status: 'none', partnerName: 'Alex' };
    }
  });

  const refreshPartnerLink = useCallback(() => {
    try {
      setPartnerLink(getPartnerLink());
    } catch {
      // The row keeps its last reading; the sheet surfaces errors itself.
    }
  }, []);

  const partnerSubtitle =
    partnerLink.status === 'active'
      ? `${partnerLink.partnerName} · connected`
      : partnerLink.status === 'invited'
        ? 'Invite sent — waiting for your partner'
        : partnerLink.status === 'revoked'
          ? 'Access revoked — nothing shared'
          : 'No one connected yet';

  const paused = globalPauseUntil !== null;

  // Real pregnancy line from onboarding (replaces the mockup's sample copy).
  const [pregnancyLine, setPregnancyLine] = useState('Your journal is just beginning');

  /** Re-reads the pregnancy record: week line + the editable account rows. */
  const refreshPregnancy = useCallback(() => {
    try {
      const p = getActivePregnancy();
      if (p?.dueDate) {
        const w = weekOf(p.dueDate);
        // Displayed week (completed + 1) — one week number everywhere.
        // Anuraj ~22:59 PDT.
        setPregnancyLine(
          w ? `Week ${w.week + 1} · due ${formatLong(p.dueDate)}` : `Due ${formatLong(p.dueDate)}`,
        );
      } else if (p) {
        setPregnancyLine('Due date not set yet');
      }
      setOwnerNameState(p?.ownerName ?? null);
      setDueDateState(p?.dueDate ?? null);
      setDobState(p?.dob ?? null);
    } catch {
      // Keep the gentle fallback.
    }
  }, []);

  useEffect(() => {
    refreshPregnancy();
  }, [refreshPregnancy]);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // Load saved preferences (owned by the data engineer).
  useEffect(() => {
    let alive = true;
    getPrefs()
      .then((p) => {
        if (!alive) return;
        setEndOfDayEnabled(p.endOfDayEnabled);
        setEndOfDayTime(p.endOfDayTime);
        setAppointmentReminders(p.appointmentReminders);
        setGlobalPauseUntil(p.globalPauseUntil);
        setQuietHours({ start: p.quietHoursStart, end: p.quietHoursEnd });
      })
      .catch(() => {
        // Prefs unavailable — the screen still works with gentle defaults.
      });
    return () => {
      alive = false;
    };
  }, []);

  // Load the saved baby name — local-only, never synced.
  useEffect(() => {
    try {
      setBabyNameState(getBabyName());
    } catch {
      // kv unreadable — the row just reads "Not set".
    }
  }, []);

  const ensurePermission = useCallback(async () => {
    try {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        showToast('Heads up — notifications are off in your system settings, so reminders can’t reach you yet.');
      }
    } catch {
      // Permission request unavailable; the toggle still records her choice.
    }
  }, [showToast]);

  const handlePauseToggle = useCallback(async () => {
    const next = paused ? null : new Date().toISOString();
    setGlobalPauseUntil(next);
    try {
      await updatePrefs({ globalPauseUntil: next });
    } catch {
      showToast('That didn’t go through — nothing changed.');
      setGlobalPauseUntil(paused ? new Date().toISOString() : null);
      return;
    }
    showToast(paused ? 'Notifications resumed' : 'Notifications paused');
  }, [paused, showToast]);

  const handleAppointmentToggle = useCallback(
    async (value: boolean) => {
      setAppointmentReminders(value);
      if (value) void ensurePermission();
      try {
        await updatePrefs({ appointmentReminders: value });
      } catch {
        showToast('That didn’t go through — nothing changed.');
        setAppointmentReminders(!value);
      }
    },
    [ensurePermission, showToast],
  );

  const handleNudgeToggle = useCallback(
    async (value: boolean) => {
      setEndOfDayEnabled(value);
      if (value) void ensurePermission();
      try {
        await updatePrefs({ endOfDayEnabled: value });
      } catch {
        showToast('That didn’t go through — nothing changed.');
        setEndOfDayEnabled(!value);
      }
    },
    [ensurePermission, showToast],
  );

  const handleNudgeStep = useCallback(
    (delta: number) => {
      const next = Math.min(NUDGE_MAX, Math.max(NUDGE_MIN, clockToMinutes(endOfDayTime) + delta));
      const clock = toClock(next);
      setEndOfDayTime(clock);
      updatePrefs({ endOfDayTime: clock }).catch(() => {
        showToast('That didn’t go through — nothing changed.');
      });
    },
    [endOfDayTime, showToast],
  );

  // Loads the persisted data decisions + partner snapshot for the "It's done." view.
  const loadAftermath = useCallback(() => {
    try {
      setDecisions(getDataDecisions());
    } catch {
      // Decisions unreadable — rows render undecided, decide-later stays first-class.
    }
    try {
      setPartnerSnap(readPartnerSnapshot());
    } catch {
      setPartnerSnap(null);
    }
    try {
      setSharedCount(countSharedMoments());
    } catch {
      setSharedCount(0);
    }
  }, []);

  const openStop = useCallback(() => {
    setOpenRow(null);
    // Already stopped → reopen straight into the "It's done." aftermath.
    if (isAfterwards()) {
      loadAftermath();
      setStopPhase('done');
    } else {
      setStopPhase('choose');
      setDisposition('keep');
    }
    setStopOpen(true);
  }, [loadAftermath]);

  // Baby name: saved immediately, local-only.
  const saveBabyName = useCallback(
    (name: string | null) => {
      const trimmed = name?.trim() || null;
      try {
        setBabyName(trimmed);
        clearBriefing();
      } catch {
        showToast('That didn’t go through — nothing changed.');
        return;
      }
      setBabyNameState(trimmed);
      setNameOpen(false);
      showToast(trimmed ? 'Saved.' : 'Cleared.');
    },
    [showToast],
  );

  const babyNameLabel = babyName ?? 'Not set';

  // Account edits (Sept 2026): her name, due date, and birthday live on
  // the pregnancy record, so they save through updatePregnancy() and sync
  // like the rest of the profile. The cached briefing is cleared so
  // name-aware and week-aware copy recomputes on the next read — the same
  // treatment the baby-name edit already gets.
  const saveOwnerName = useCallback(
    (name: string | null) => {
      const trimmed = name?.trim() || null;
      try {
        const updated = updatePregnancy({ ownerName: trimmed });
        if (!updated) throw new Error('no active pregnancy');
        clearBriefing();
      } catch {
        showToast('That didn’t go through — nothing changed.');
        return;
      }
      setOwnerNameState(trimmed);
      setOwnerNameOpen(false);
      showToast(trimmed ? 'Saved.' : 'Cleared.');
    },
    [showToast],
  );

  const saveDueDate = useCallback(
    (iso: string | null) => {
      if (iso && validateDueDate(iso)) {
        showToast('That date doesn’t look right — want to check it?');
        return;
      }
      try {
        const updated = updatePregnancy({ dueDate: iso });
        if (!updated) throw new Error('no active pregnancy');
        // Week-derived state (the line above, the Week tab, the briefing)
        // all re-read the record, so clearing the cached briefing is the
        // only invalidation a due-date edit needs.
        clearBriefing();
      } catch {
        showToast('That didn’t go through — nothing changed.');
        return;
      }
      setDueOpen(false);
      refreshPregnancy();
      showToast(iso ? 'Saved — your weeks will follow the new date.' : 'Cleared.');
    },
    [showToast, refreshPregnancy],
  );

  const saveDob = useCallback(
    (iso: string | null) => {
      if (iso && validateDob(iso)) {
        showToast('That date doesn’t look right — want to check it?');
        return;
      }
      // Mockup 31: opened and closed without picking changes nothing —
      // close quietly instead of toasting about a "clear" that never was.
      if (iso === dob) {
        setDobSheetOpen(false);
        return;
      }
      try {
        const updated = updatePregnancy({ dob: iso });
        if (!updated) throw new Error('no active pregnancy');
        clearBriefing();
      } catch {
        showToast('That didn’t go through — nothing changed.');
        return;
      }
      setDobState(iso);
      setDobSheetOpen(false);
      showToast(iso ? 'Saved.' : 'Cleared.');
    },
    [showToast, dob],
  );

  const ownerNameLabel = ownerName ?? 'Not set';
  const dueDateLabel = dueDate ? formatLong(dueDate) : 'Not set';
  const dobLabel = dob ? formatLong(dob) : 'Not set';

  const confirmStop = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      if (disposition === 'export') {
        try {
          await exportArchive();
        } catch {
          // No archive writer is registered in this build (expo-file-system
          // isn't installed yet) — stay on the choose step and say so plainly.
          showToast('Export isn’t ready in this build yet — your data stays safe in the app.');
          return;
        }
      }
      if (disposition === 'delete') await requestAccountDeletion();
      // Epic 9: own the stop transition (contract C3) — status → 'stopped'.
      // Idempotent; safe to call even after a full deletion (no-op then).
      stopPregnancyTracking();
      const patch = stopReminderPatch(new Date().toISOString());
      await updatePrefs(patch);
      setEndOfDayEnabled(false);
      setAppointmentReminders(false);
      setGlobalPauseUntil(patch.globalPauseUntil ?? null);
      // Seed the data decisions from what she chose at stop time — she can
      // still change any of them below.
      try {
        setDecisions(
          recordDataDecision({
            story: disposition === 'delete' ? 'deleted' : disposition === 'export' ? 'exported' : 'kept',
          }),
        );
      } catch {
        // Decision storage unavailable — rows render undecided.
      }
      loadAftermath();
      setStopPhase('done');
    } catch {
      showToast('Something didn’t go through — nothing changed. Take your time.');
    } finally {
      setStopping(false);
    }
  }, [disposition, stopping, showToast, loadAftermath]);

  // Epic 9 — expand-to-choose option handlers.
  const chooseStoryKeep = useCallback(() => {
    try {
      setDecisions(recordDataDecision({ story: 'kept' }));
    } catch {
      // Storage unavailable — the row still settles visually for the session.
    }
    setOpenRow(null);
    showToast('Saved.');
  }, [showToast]);

  const chooseStoryExport = useCallback(async () => {
    try {
      await exportArchive();
    } catch {
      showToast('Export isn’t ready in this build yet — your data stays safe in the app.');
      return;
    }
    try {
      setDecisions(recordDataDecision({ story: 'exported' }));
    } catch {
      // Storage unavailable — the row still settles visually for the session.
    }
    setOpenRow(null);
    showToast('Your export is downloading.');
  }, [showToast]);

  const choosePartnerMemories = useCallback(
    (decision: 'kept' | 'removed') => {
      if (decision === 'removed') {
        // Through Epic 7's exported function only (contract C2): already-synced
        // partner data is marked for removal on next sync.
        removePartnerAccess();
      }
      try {
        setDecisions(recordDataDecision({ partnerMemories: decision }));
      } catch {
        // Storage unavailable — the row still settles visually for the session.
      }
      setOpenRow(null);
      showToast('Saved.');
    },
    [showToast],
  );

  /** The gentle guard's "Yes, delete everything" — the ONLY path that deletes. */
  const confirmDeleteEverything = useCallback(async () => {
    try {
      await requestAccountDeletion();
    } catch {
      showToast('Something didn’t go through — nothing changed. Take your time.');
      return;
    }
    // Recorded AFTER the wipe on purpose: the deletion clears every table
    // including the aftermath marker, and re-marking it here is what keeps
    // the quiet afterwards Home (no developmental content) rendering after
    // deletion. The stopped-pregnancy status remains the stop signal during
    // the aftermath; this marker only carries the post-deletion quiet state.
    try {
      setDecisions(recordDataDecision({ story: 'deleted' }));
    } catch {
      // Storage unavailable — the row still settles visually for the session.
    }
    setStopPhase('done');
    setOpenRow(null);
    showToast(DELETE_GUARD_DELETED_TOAST);
  }, [showToast]);

  const decideLater = useCallback(() => {
    showToast(DECIDE_LATER_TOAST);
    setStopOpen(false);
  }, [showToast]);

  // Epic 9 — expand-to-choose data rows for the "It's done." aftermath.
  // Tapping a row reveals its concrete options; tapping an option records the
  // decision and collapses the row into a quiet decided state (✓ + label).
  // No checkboxes. Decided rows re-tap to change. "I'll decide later" stays
  // first-class — undecided rows simply render undecided.
  const partnerName = partnerSnap?.partnerName ?? 'your partner';
  const partnerNameCap = partnerName.charAt(0).toUpperCase() + partnerName.slice(1);
  const sharedWord = sharedCount === 1 ? 'moment' : 'moments';

  const dataRowDefs: DataRowDef[] = [
    {
      id: 'story-keep',
      title: 'Keep my story in the app',
      subtitle: 'Timeline stays as memories',
      body: 'Your timeline stays as your memories. No new pregnancy content, no notifications — just what you saved, kept safe.',
      decidedLabel: decisions.story === 'kept' ? 'Kept in the app' : null,
      options: [
        { key: 'choose', label: 'Choose this', testID: 'data-row-story-keep-choose', onChoose: chooseStoryKeep },
      ],
    },
    {
      id: 'story-export',
      title: 'Export my story',
      subtitle: 'Download a private archive',
      body: 'Download your entries, photos, and files as a private archive — the same export flow as always, on this device.',
      decidedLabel: decisions.story === 'exported' ? 'Exported' : null,
      options: [
        { key: 'choose', label: 'Choose this', testID: 'data-row-story-export-choose', onChoose: chooseStoryExport },
      ],
    },
    {
      id: 'story-delete',
      title: 'Delete everything',
      subtitle: 'Remove it all, permanently',
      body: 'Permanently remove your story — timeline, photos, and files — from the app and your account.',
      decidedLabel: decisions.story === 'deleted' ? 'Deleted' : null,
      options: [
        {
          key: 'choose',
          label: 'Choose this',
          dark: true,
          testID: 'data-row-story-delete-choose',
          onChoose: () => setStopPhase('guard'),
        },
      ],
    },
    ...(hasPartnerToDecideAbout(partnerSnap)
      ? [
          {
            id: 'partner' as DataRowId,
            title: `Shared memories with ${partnerName}`,
            subtitle: `${sharedCount} shared ${sharedWord} · you decide`,
            body: `${partnerNameCap} has ${sharedCount} shared ${sharedWord} from your pregnancy. Pregnancy notifications to ${partnerName} have already stopped — this is only about the memories already shared.`,
            decidedLabel:
              decisions.partnerMemories === 'kept'
                ? `${partnerNameCap} keeps them`
                : decisions.partnerMemories === 'removed'
                  ? 'Access removed'
                  : null,
            options: [
              {
                key: 'keep',
                label: `${partnerNameCap} keeps them`,
                testID: 'data-row-partner-keep',
                onChoose: () => choosePartnerMemories('kept'),
              },
              {
                key: 'remove',
                label: `Remove ${partnerName}’s access`,
                testID: 'data-row-partner-remove',
                onChoose: () => choosePartnerMemories('removed'),
              },
            ],
          },
        ]
      : []),
  ];

  const toggleRow = useCallback(
    (row: DataRowDef) => {
      // Visual state only — the persisted decision stands until she picks a
      // new option (mockup: decided rows re-tap to change, not to clear).
      const visual: DataRowState =
        row.decidedLabel !== null
          ? { open: openRow === row.id, decided: openRow !== row.id }
          : { open: openRow === row.id, decided: false };
      const next = toggleDataRow(visual);
      setOpenRow(next.open ? row.id : null);
    },
    [openRow],
  );

  const onChooseRowOption = useCallback((_row: DataRowDef, option: DataRowOption) => {
    // The option handler records the decision and collapses the row into its
    // quiet decided state (chooseDataRowOption() models this transition).
    option.onChoose();
  }, []);

  return (
    <Screen scroll={false}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <Text style={styles.screenTitle} accessibilityRole="header">
        You
      </Text>

      <View style={styles.profile}>
        <View style={styles.avatar} accessibilityElementsHidden>
          <Text style={styles.avatarInitial}>M</Text>
        </View>
        <View style={styles.profileText}>
          <Text style={styles.profileName}>Your account</Text>
          <Text testID="you-pregnancy-line" style={styles.profileSub}>{pregnancyLine}</Text>
        </View>
      </View>

      <SectionHeader title="Account" />

      <View style={styles.rows}>
        <SettingsRow
          icon="◉"
          title="Your name"
          subtitle="Used when you share your journey."
          value={ownerNameLabel}
          onPress={() => {
            setOwnerNameDraft(ownerName ?? '');
            setOwnerNameOpen(true);
          }}
          testID="account-name-row"
        />
        <SettingsRow
          icon="◍"
          title="Due date"
          subtitle="Sets your week. Your weekly reading follows it."
          value={dueDateLabel}
          onPress={() => {
            setDueDraft(dueDate);
            setDueError(null);
            setDueOpen(true);
          }}
          testID="account-due-date-row"
        />
        <SettingsRow
          icon="✿"
          title="Birthday"
          subtitle="Optional. Makes your weekly reading a little more personal."
          value={dobLabel}
          onPress={() => {
            setDobDraft(dob);
            setDobSheetOpen(true);
          }}
          testID="account-dob-row"
        />
      </View>

      <SectionHeader title="Notifications" />

      <Card style={[styles.pauseCard, paused && styles.pauseCardActive]}>
        <Text style={styles.pauseTitle}>{paused ? 'All quiet.' : 'Need a quiet stretch?'}</Text>
        <Text style={styles.pauseCopy}>
          {paused
            ? 'Notifications are paused. Come back whenever you’re ready — nothing is lost.'
            : 'Pause every notification until you return. Nothing is lost — your story waits.'}
        </Text>
        <Button
          title={paused ? 'Resume notifications' : 'Pause all notifications'}
          variant="ghost"
          onPress={handlePauseToggle}
          style={styles.pauseButton}
          testID="pause-all-button"
        />
      </Card>

      <View style={styles.rows}>
        <SettingsRow
          icon="◉"
          title="Appointment reminders"
          subtitle="A nudge before each visit, with your questions ready."
          trailing={
            <Toggle
              value={appointmentReminders}
              onValueChange={handleAppointmentToggle}
              accessibilityLabel="Appointment reminders"
              testID="appointment-reminders-toggle"
            />
          }
        />
        <SettingsRow
          icon="☾"
          title="End-of-day nudge"
          subtitle={`One gentle nudge around ${formatClock(endOfDayTime)} — only on days you haven’t saved anything.`}
          trailing={
            <Toggle
              value={endOfDayEnabled}
              onValueChange={handleNudgeToggle}
              accessibilityLabel="End-of-day nudge"
              testID="end-of-day-toggle"
            />
          }
        />
        <SettingsRow
          icon="◐"
          title="Nudge time"
          trailing={
            <TimeStepper
              value={formatClock(endOfDayTime)}
              onDecrease={() => handleNudgeStep(-NUDGE_STEP)}
              onIncrease={() => handleNudgeStep(NUDGE_STEP)}
              decreaseLabel="Earlier nudge time"
              increaseLabel="Later nudge time"
              testID="nudge-time-stepper"
            />
          }
        />
      </View>

      <Text style={styles.note}>
        Quiet hours {formatHour(quietHours.start)} – {formatHour(quietHours.end)}, always.
        Lock-screen previews stay neutral — they never show symptoms, moods, or health details.
      </Text>

      <SectionHeader title="Your space" />

      <View style={styles.rows}>
        <SettingsRow
          icon="♥"
          title="Partner sharing"
          subtitle={partnerSubtitle}
          onPress={() => {
            refreshPartnerLink();
            setPartnerOpen(true);
          }}
          testID="partner-sharing-row"
        />
        <SettingsRow
          icon="▤"
          tint={colors.blueTint}
          tintInk={colors.blue}
          title="Visit summary (PDF)"
          subtitle="For your appointments"
          onPress={() => showToast('Visit summaries are coming soon.')}
        />
        {/* Epic 8: OB-visit export entry point (added row only — existing rows untouched). */}
        <SettingsRow
          icon="⎙"
          tint={colors.blueTint}
          tintInk={colors.blue}
          title="Export for OB visit"
          subtitle="A facts-only summary of your logs"
          onPress={() => router.push('/export')}
          testID="export-ob-visit-row"
        />
        <SettingsRow
          icon="◈"
          tint={colors.sageTint}
          tintInk={colors.sageDeep}
          title="Privacy & data"
          subtitle="Export, deletion, app lock, what’s never tracked"
          onPress={() => showToast('Privacy controls are coming soon — your data stays on this device.')}
        />
        <SettingsRow
          icon="✦"
          tintInk={colors.gold}
          title="Pregnancy settings"
          subtitle="Due date, first or subsequent, appearance"
          onPress={() => showToast('Pregnancy settings are coming soon.')}
        />
      </View>

      <SectionHeader title="Your baby" />

      <View style={styles.rows}>
        <SettingsRow
          icon="♥"
          title="Baby’s name (optional)"
          subtitle="Just for you — it stays on this device."
          value={babyNameLabel}
          onPress={() => {
            setNameDraft(babyName ?? '');
            setNameOpen(true);
          }}
          testID="baby-name-row"
        />
      </View>

      <SectionHeader title="If things change" />

      <Pressable
        onPress={openStop}
        accessibilityRole="button"
        accessibilityLabel="Stop pregnancy tracking"
        style={({ pressed }) => [styles.quietRow, pressed && styles.quietPressed]}
      >
        <Text style={styles.quietLabel}>Stop pregnancy tracking</Text>
        <Text style={styles.quietChevron} accessibilityElementsHidden>
          ›
        </Text>
      </Pressable>
      <Text style={styles.note}>
        Here quietly, whenever you need it. No questions asked, nothing rushed.
      </Text>

      <BottomSheet
        visible={stopOpen}
        onClose={() => setStopOpen(false)}
        accessibilityLabel="Stop pregnancy tracking"
        testID="stop-tracking-sheet"
      >
      {/* Epic 9: the "It's done." aftermath is long — scroll inside the sheet. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.sheetScroll}
        keyboardShouldPersistTaps="handled"
      >
        {stopPhase === 'choose' ? (
          <View>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              Stop pregnancy tracking?
            </Text>
            <Text style={styles.sheetLede}>
              Everything pregnancy-related will stop — updates, reminders, and partner
              notifications. Your data stays private.
            </Text>
            {DISPOSITIONS.map((d) => {
              const selected = disposition === d.id;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => setDisposition(d.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={d.title}
                  accessibilityState={{ selected }}
                  style={[styles.disp, selected && styles.dispSelected]}
                >
                  <View
                    style={[styles.radio, selected && styles.radioSelected]}
                    accessibilityElementsHidden
                  >
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={styles.dispText}>
                    <Text style={styles.dispTitle}>{d.title}</Text>
                    <Text style={styles.dispSub}>{d.sub}</Text>
                  </View>
                </Pressable>
              );
            })}
            <Button
              title="Stop tracking"
              variant="ghost"
              onPress={confirmStop}
              loading={stopping}
              disabled={stopping}
              style={styles.stopButton}
              testID="confirm-stop-button"
            />
            <Pressable
              onPress={() => setStopOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Decide later"
              style={({ pressed }) => [styles.later, pressed && styles.quietPressed]}
            >
              <Text style={styles.laterText}>Decide later</Text>
            </Pressable>
          </View>
        ) : stopPhase === 'guard' ? (
          <View>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {DELETE_GUARD_TITLE}
            </Text>
            <Text style={styles.sheetLede}>{DELETE_GUARD_LEDE}</Text>
            <Button
              title={DELETE_GUARD_KEEP}
              variant="ghost"
              onPress={() => {
                setStopPhase('done');
                showToast(DELETE_GUARD_KEPT_TOAST);
              }}
              testID="delete-guard-keep"
            />
            <Pressable
              onPress={confirmDeleteEverything}
              accessibilityRole="button"
              accessibilityLabel={DELETE_GUARD_CONFIRM}
              style={({ pressed }) => [styles.optDark, styles.guardConfirm, pressed && styles.optDarkPressed]}
              testID="delete-guard-confirm"
            >
              <Text style={styles.optDarkText}>{DELETE_GUARD_CONFIRM}</Text>
            </Pressable>
            <Text style={styles.fine}>{DELETE_GUARD_FINE}</Text>
          </View>
        ) : (
          <View>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {ITS_DONE_TITLE}
            </Text>
            <Text style={styles.sheetLede}>{ITS_DONE_LEDE}</Text>
            <View style={styles.stopCard} testID="stopped-list">
              {STOPPED_LIST_COPY.map((item, i) => (
                <View
                  key={item}
                  style={[styles.stopItem, i > 0 && styles.stopItemBorder]}
                >
                  <Text style={styles.stopDash} accessibilityElementsHidden>
                    –
                  </Text>
                  <Text style={styles.stopText}>{item}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.kick}>{STORY_KICK}</Text>
            <Text style={[styles.sheetLede, styles.storyLede]}>{STORY_LEDE}</Text>
            {dataRowDefs.map((row) => (
              <DataRow
                key={row.id}
                row={row}
                open={openRow === row.id}
                onToggle={() => toggleRow(row)}
                onChoose={(option) => onChooseRowOption(row, option)}
              />
            ))}
            <Pressable
              onPress={decideLater}
              accessibilityRole="button"
              accessibilityLabel={DECIDE_LATER_LABEL}
              style={({ pressed }) => [styles.later, pressed && styles.quietPressed]}
              testID="decide-later-button"
            >
              <Text style={styles.laterText}>{DECIDE_LATER_LABEL}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={nameOpen}
        onClose={() => setNameOpen(false)}
        accessibilityLabel="Baby’s name"
        testID="baby-name-sheet"
      >
        <Text style={styles.sheetTitle} accessibilityRole="header">
          Baby’s name
        </Text>
        <Text style={styles.sheetLede}>
          Optional. It stays on this device and is only used in your weekly
          reading — never sent anywhere.
        </Text>
        <TextInput
          value={nameDraft}
          onChangeText={setNameDraft}
          placeholder="Baby’s name (optional)"
          placeholderTextColor={colors.muted}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          maxLength={40}
          style={styles.nameInput}
          accessibilityLabel="Baby’s name (optional)"
          testID="baby-name-input"
        />
        <Button
          title="Save"
          onPress={() => saveBabyName(nameDraft)}
          testID="baby-name-save"
        />
        {babyName ? (
          <Pressable
            onPress={() => saveBabyName(null)}
            accessibilityRole="button"
            accessibilityLabel="Clear name"
            style={({ pressed }) => [styles.later, pressed && styles.quietPressed]}
            testID="baby-name-clear"
          >
            <Text style={styles.laterText}>Clear name</Text>
          </Pressable>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={ownerNameOpen}
        onClose={() => setOwnerNameOpen(false)}
        accessibilityLabel="Your name"
        testID="account-name-sheet"
      >
        <Text style={styles.sheetTitle} accessibilityRole="header">
          Your name
        </Text>
        <Text style={styles.sheetLede}>
          What should we call you? It is used when you share your journey.
        </Text>
        <TextInput
          value={ownerNameDraft}
          onChangeText={setOwnerNameDraft}
          placeholder="Your name"
          placeholderTextColor={colors.muted}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          maxLength={40}
          style={styles.nameInput}
          accessibilityLabel="Your name"
          testID="account-name-input"
        />
        <Button
          title="Save"
          onPress={() => saveOwnerName(ownerNameDraft)}
          testID="account-name-save"
        />
        {ownerName ? (
          <Pressable
            onPress={() => saveOwnerName(null)}
            accessibilityRole="button"
            accessibilityLabel="Clear name"
            style={({ pressed }) => [styles.later, pressed && styles.quietPressed]}
            testID="account-name-clear"
          >
            <Text style={styles.laterText}>Clear name</Text>
          </Pressable>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={dueOpen}
        onClose={() => setDueOpen(false)}
        accessibilityLabel="Due date"
        testID="account-due-date-sheet"
      >
        <Text style={styles.sheetTitle} accessibilityRole="header">
          Due date
        </Text>
        <Text style={styles.sheetLede}>
          This sets your week. Your weekly reading will follow the new date.
        </Text>
        <Card style={[styles.pickerCard, dueError ? styles.pickerCardError : null]}>
          <DatePickerField
            value={dueDraft ? dateOrToday(dueDraft) : dateOrToday(todayISO())}
            minimumDate={dateOrToday(todayISO())}
            maximumDate={dateOrToday(addDaysISO(todayISO(), 294) ?? todayISO())}
            onChange={(d) => {
              setDueDraft(toISODate(d));
              setDueError(null);
            }}
            accessibilityLabel="Choose your due date"
            testID="account-due-date-picker"
          />
        </Card>
        {dueError && (
          <Text style={styles.sheetError} accessibilityRole="text" testID="account-due-date-error">
            {dueError}
          </Text>
        )}
        <View style={styles.sheetGap} />
        <Button
          title="Save"
          onPress={() => {
            // Mockup 31: a due date is mandatory — saving without a picked
            // date shows the verbatim inline error instead of clearing.
            if (!dueDraft) {
              setDueError(REQUIRED_DATE_ERROR);
              return;
            }
            setDueError(null);
            saveDueDate(dueDraft);
          }}
          testID="account-due-date-save"
        />
        {dueDate ? (
          <Pressable
            onPress={() => saveDueDate(null)}
            accessibilityRole="button"
            accessibilityLabel="Clear due date"
            style={({ pressed }) => [styles.later, pressed && styles.quietPressed]}
            testID="account-due-date-clear"
          >
            <Text style={styles.laterText}>Clear date</Text>
          </Pressable>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={dobSheetOpen}
        onClose={() => setDobSheetOpen(false)}
        accessibilityLabel="Birthday"
        testID="account-dob-sheet"
      >
        <Text style={styles.sheetTitle} accessibilityRole="header">
          Birthday
        </Text>
        <Text style={styles.sheetLede}>
          Optional. It helps make your weekly reading feel a little more personal.
        </Text>
        <Card style={styles.pickerCard}>
          <DatePickerField
            value={dobDraft ? dateOrToday(dobDraft) : null}
            emptyDisplayDate={dateOrToday(addDaysISO(todayISO(), -30 * 365) ?? todayISO())}
            minimumDate={dateOrToday(addDaysISO(todayISO(), -100 * 365) ?? todayISO())}
            maximumDate={dateOrToday(todayISO())}
            onChange={(d) => setDobDraft(toISODate(d))}
            accessibilityLabel="Choose your birthday"
            testID="account-dob-picker"
          />
        </Card>
        <View style={styles.sheetGap} />
        <Button
          title="Save"
          onPress={() => saveDob(dobDraft)}
          testID="account-dob-save"
        />
        {dob ? (
          <Pressable
            onPress={() => saveDob(null)}
            accessibilityRole="button"
            accessibilityLabel="Remove birthday"
            style={({ pressed }) => [styles.later, pressed && styles.quietPressed]}
            testID="account-dob-clear"
          >
            <Text style={styles.laterText}>Remove birthday</Text>
          </Pressable>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={partnerOpen}
        onClose={() => {
          setPartnerOpen(false);
          refreshPartnerLink();
        }}
        accessibilityLabel="Partner sharing"
        testID="partner-sheet"
      >
        <PartnerSheet onChanged={refreshPartnerLink} />
      </BottomSheet>

      </ScrollView>

      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: 120,
  },
  screenTitle: {
    ...typeScale.display,
    color: colors.ink,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: radii.chip,
    backgroundColor: colors.blush,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: 'Georgia',
    fontSize: 24,
    color: colors.coralDeep,
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    ...typeScale.headline,
    color: colors.ink,
  },
  profileSub: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: 2,
  },

  pauseCard: {
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: spacing.sm,
  },
  pauseCardActive: {
    backgroundColor: colors.sageTint,
  },
  pauseTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  pauseCopy: {
    fontSize: 14.5,
    lineHeight: 22,
    color: '#5C554D',
  },
  pauseButton: {
    marginTop: spacing.md,
  },

  rows: {
    gap: spacing.sm,
  },
  note: {
    ...typeScale.subhead,
    color: colors.muted,
    lineHeight: 20,
    marginTop: spacing.sm,
    marginHorizontal: spacing.xs,
  },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: radii.chip,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPressed: {
    backgroundColor: colors.blush,
    borderColor: colors.coral,
  },
  stepGlyph: {
    fontSize: 20,
    color: colors.coralDeep,
    fontWeight: '600',
    lineHeight: 22,
  },
  stepValue: {
    ...typeScale.body,
    fontWeight: '700',
    color: colors.ink,
    minWidth: 96,
    textAlign: 'center',
  },

  quietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  quietPressed: {
    opacity: 0.7,
  },
  quietLabel: {
    ...typeScale.body,
    fontWeight: '600',
    color: colors.muted,
    flex: 1,
  },
  quietChevron: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.muted,
  },

  sheetTitle: {
    ...typeScale.title,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  sheetScroll: {
    paddingBottom: spacing.md,
  },
  sheetLede: {
    ...typeScale.body,
    color: '#5C554D',
    marginBottom: spacing.lg,
  },
  nameInput: {
    minHeight: 56,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  pickerCard: {
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pickerCardError: {
    borderColor: colors.coral,
    borderWidth: 2,
  },
  // Mockup 31: the verbatim mandatory-date error under the sheet picker.
  sheetError: {
    ...typeScale.body,
    fontSize: 15,
    color: colors.coralDeep,
    fontWeight: '600',
    marginTop: spacing.sm,
    lineHeight: 23,
  },
  sheetGap: {
    height: spacing.md,
  },
  disp: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: radii.button,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 64,
  },
  dispSelected: {
    borderColor: colors.sageDeep,
    backgroundColor: colors.sageTint,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radii.chip,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioSelected: {
    borderColor: colors.sageDeep,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radii.chip,
    backgroundColor: colors.sageDeep,
  },
  dispText: {
    flex: 1,
    minWidth: 0,
  },
  dispTitle: {
    ...typeScale.body,
    fontWeight: '700',
    color: colors.ink,
  },
  dispSub: {
    ...typeScale.subhead,
    color: colors.muted,
    marginTop: 2,
  },
  stopButton: {
    marginTop: spacing.sm,
  },
  later: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  laterText: {
    ...typeScale.body,
    fontWeight: '600',
    color: colors.muted,
  },

  // Epic 9 — "It's done." aftermath.
  stopCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  stopItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  stopItemBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  stopDash: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F1EAE0',
    color: colors.muted,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 26,
  },
  stopText: {
    ...typeScale.body,
    color: colors.ink,
    flex: 1,
    lineHeight: 22,
  },
  kick: {
    fontSize: 12,
    letterSpacing: 1.44,
    textTransform: 'uppercase',
    color: colors.coralDeep,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  storyLede: {
    marginBottom: spacing.md,
  },
  // Expand-to-choose data rows.
  drow: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  drowDone: {
    backgroundColor: colors.card,
  },
  drowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    paddingHorizontal: 16,
    minHeight: 64,
  },
  drowText: {
    flex: 1,
    minWidth: 0,
  },
  drowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  drowSub: {
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 2,
    fontWeight: '500',
  },
  drowChev: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.muted,
    marginLeft: spacing.sm,
  },
  drowChevOpen: {
    transform: [{ rotate: '90deg' }],
  },
  drowBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  drowBodyText: {
    fontSize: 13.5,
    color: '#5C554D',
    lineHeight: 21,
    marginBottom: spacing.md,
  },
  decided: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: spacing.sm,
    flexShrink: 0,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.sageTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.sageDeep,
  },
  decidedLabel: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.sageDeep,
    flexShrink: 1,
  },
  optButton: {
    marginBottom: spacing.sm,
  },
  optDark: {
    backgroundColor: colors.ink,
    borderRadius: radii.button,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  optDarkPressed: {
    opacity: 0.85,
  },
  optDarkText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  guardConfirm: {
    marginTop: spacing.sm,
  },
  fine: {
    ...typeScale.subhead,
    color: colors.muted,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 120,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  toast: {
    backgroundColor: colors.ink,
    borderRadius: radii.chip,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    maxWidth: 340,
  },
  toastText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
