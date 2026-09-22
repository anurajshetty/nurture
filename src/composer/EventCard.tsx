/**
 * Timeline event card (Epic 2): the keepsake stream on Home.
 *
 * One card per event: type dot + label, relative time, visibility, then
 * the content in the event's own shape (text, symptom chips, mood title,
 * weight line, photo placeholders, file chips). Warm, quiet, no clinical
 * chrome.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Path, Svg } from 'react-native-svg';
import Card from '../components/Card';
import {
  colors,
  eventDots,
  fontDisplay,
  radii,
  spacing,
  type as typeScale,
  type EventDotKind,
} from '../theme/tokens';
import { type EventAttachment, type LocalEvent } from '../lib/types';
import { getEvent } from '../sync/store';
import { readQuestions } from '../plan/questions';
import KickFeedSection from '../kicks/KickFeedSection';
import LaborFeedSection from '../labor/LaborFeedSection';
import { deleteCopyFor } from '../timeline/deleteCopy';
import {
  readReportSummaryState,
  REPORT_SUMMARY_DISCLAIMER,
  resumeReportSummary,
  subscribeReportSummary,
  type ReportSummaryState,
} from '../reportSummary/client';
import FamilyShareIcon from '../components/FamilyShareIcon';
import ContractionWave from '../partner/ContractionWave';
import { readActivityCard } from '../labor/feed';
import { canToggleSharing, isSharedVisibility } from '../partner/sharing';
import { lovedByLabel } from '../partner/partnerHome';

interface TypeMeta {
  label: string;
  glyph: string;
  dot: EventDotKind;
}

const TYPE_META: Record<string, TypeMeta> = {
  note: { label: 'Moment', glyph: '◐', dot: 'note' },
  mood: { label: 'Mood', glyph: '◐', dot: 'mood' },
  symptom: { label: 'Symptoms', glyph: '✚', dot: 'symptom' },
  photo: { label: 'Photo', glyph: '◉', dot: 'photo' },
  milestone: { label: 'Milestone', glyph: '✦', dot: 'milestone' },
  file: { label: 'File', glyph: '▤', dot: 'file' },
  report: { label: 'Report', glyph: '📄', dot: 'report' },
  appointment: { label: 'Appointment', glyph: '▦', dot: 'appointment' },
  weight: { label: 'Weight', glyph: '◍', dot: 'weight' },
  kick_session: { label: 'Kick counting', glyph: '✦', dot: 'kick' },
  // Labor activities (mockup 32 rev 2 — Anuraj approved Sept 21, 2026):
  // ONE unified card, kicker "Activity", activity named inside the card.
  activity: { label: 'Activity', glyph: '❀', dot: 'activity' },
  question: { label: 'Question', glyph: '◉', dot: 'question' },
};

function metaFor(type: string): TypeMeta {
  return TYPE_META[type] ?? { label: 'Moment', glyph: '◐', dot: 'note' };
}

import { formatLocalTime, formatLocalDay } from '../time/localFormat';

/** Card header timestamp: the shared device-local formatter. */
function formatTime(iso: string): string {
  return formatLocalTime(iso);
}

/**
 * Compact day label for the shareable card header (mockup 33-entry-sharing
 * device C): "Today", "Yesterday", or "Sep 24" — no time, so the kicker
 * stays on one line.
 */
function formatDay(iso: string): string {
  return formatLocalDay(iso);
}

function attachmentsOf(data: Record<string, unknown>): EventAttachment[] {
  const raw = data.attachments;
  if (!Array.isArray(raw)) return [];
  const out: EventAttachment[] = [];
  for (const a of raw) {
    if (typeof a !== 'object' || a === null) continue;
    const r = a as Record<string, unknown>;
    out.push({
      id: typeof r.id === 'string' ? r.id : '',
      kind: r.kind === 'photo' ? 'photo' : 'file',
      name: typeof r.name === 'string' ? r.name : 'Attachment',
      mimeType: typeof r.mimeType === 'string' ? r.mimeType : undefined,
      local_uri:
        typeof r.local_uri === 'string'
          ? r.local_uri
          : typeof r.uri === 'string'
            ? r.uri
            : undefined,
      upload: r.upload === 'done' ? 'done' : r.upload === 'failed' ? 'failed' : 'pending',
      storage_path: typeof r.storage_path === 'string' ? r.storage_path : undefined,
    });
  }
  return out;
}

/**
 * PHOTO PLACEHOLDER (Willow, Anuraj Sept 2026): photo persistence is OFF
 * app-wide — no photo bytes are uploaded or saved anywhere, and the feed
 * must never attempt to load them (no local URI, no signed URL). Photo
 * attachments therefore render as this affordance-only tile: a warm
 * picture placeholder with the photo's name as its accessibility label.
 * `attachmentsOf` still reads the attachment metadata (kind/name); the
 * bytes themselves are never touched.
 */
function PhotoPlaceholder({ label }: { label: string }) {
  return (
    <View
      style={styles.photoPlaceholder}
      accessibilityRole="image"
      accessibilityLabel={label}
      testID="event-card-photo-placeholder"
    >
      <Text style={styles.photoGlyph}>◎</Text>
      <Text style={styles.photoLabel}>Photo</Text>
    </View>
  );
}

/* Backup-status line REMOVED (Sept 2026): photo persistence is OFF
 * app-wide (PHOTOS_PERSIST_ENABLED = false), so nothing ever uploads and
 * no "Backing up…" / "Not backed up yet" state may be shown — for photos
 * or files. The media backup pipeline stays in place behind the kill
 * switch in src/sync/photoPersistence.ts for later re-enabling. */

/* ------------------------------------------------------------------ */
/* Report summary (Willow, ephemeral — Anuraj Sept 2026).               */
/*                                                                     */
/* Report-category timeline entries are TEXT-ONLY. The picked file is   */
/* read into memory solely for the summary call — nothing is persisted */
/* (no attachment, no backup, no "Backing up…" anywhere).               */
/*                                                                     */
/* - 'summarizing': the interim feed entry ("Summarizing your report…") */
/* - 'ready':       the summary card (serif title, plain-language body, */
/*                  fixed disclaimer)                                   */
/* - 'failed':      LEGACY ONLY — nothing writes or renders this state  */
/*                  anymore. Every failure hard-deletes the entry and   */
/*                  the feed shows a transient toast instead. Legacy    */
/*                  rows (including the retired 'not_configured' setup   */
/*                  card, "Report summaries aren't set up yet.") are    */
/*                  hard-deleted by logs.tsx's mount purge (Anuraj,      */
/*                  Sept 20, 2026).                                     */
/*                                                                     */
/* The summary state lives on `event.data.reportSummary` so it          */
/* survives reloads and syncs like any other payload change. The card   */
/* re-renders through `subscribeReportSummary` — no polling.            */
/* ------------------------------------------------------------------ */

function ReportSummarySection({ event, partnerMode }: { event: LocalEvent; partnerMode?: boolean }) {
  const [state, setState] = useState<ReportSummaryState | null>(() =>
    readReportSummaryState(event.data),
  );
  // "Show more" (Anuraj-approved Sept 2026, day-groups mockup): long
  // summaries clamp to 4 lines; the toggle appears only when the text
  // actually overflows the clamp. Overflow is measured, not guessed: a
  // hidden unclamped twin of the body is laid out next to the clamped
  // text, and the toggle latches on when the twin is taller. The latch
  // survives expand/collapse (the twin unmounts when expanded).
  const [expanded, setExpanded] = useState(false);
  const [fullHeight, setFullHeight] = useState(0);
  const [clampedHeight, setClampedHeight] = useState(0);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    if (!expanded && clampedHeight > 0 && fullHeight > clampedHeight + 2) {
      setHasOverflow(true);
    }
  }, [expanded, clampedHeight, fullHeight]);

  useEffect(() => {
    if (event.type !== 'report') return;
    // Partner cards are a pure view of the shared data: no resume, no
    // subscription — the summary arrives in data.reportSummary.
    if (partnerMode) return;
    // Close the fast-completion race: the summary may have finished
    // between the card's first render and this effect — re-read the
    // persisted state first so the card never shows a stale
    // "Summarizing…" over a finished summary.
    const freshOnMount = getEvent(event.id);
    setState(readReportSummaryState(freshOnMount?.data ?? event.data));
    // Resume an in-flight summary after a remount (same session, bytes
    // still stashed). With no stashed bytes the entry is hard-deleted
    // instead of hanging on "Summarizing…" forever.
    resumeReportSummary(event.id);
    return subscribeReportSummary((id) => {
      if (id !== event.id) return;
      const fresh = getEvent(event.id);
      setState(readReportSummaryState(fresh?.data ?? {}));
    });
  }, [event.id, event.type, partnerMode]);

  if (event.type !== 'report') return null;
  if (!state) return null;

  if (state.status === 'summarizing') {
    return (
      <View style={styles.summaryLoading} testID="report-summary-loading">
        <Text style={styles.summaryLoadingText}>Summarizing your report…</Text>
        {/* Fixed disclaimer — inside the card, always visible. */}
        <Text style={styles.summaryDisclaimer}>{REPORT_SUMMARY_DISCLAIMER}</Text>
      </View>
    );
  }

  if (state.status === 'failed') {
    // LEGACY ONLY: nothing writes 'failed' anymore — every failure
    // hard-deletes the entry and toasts. Legacy rows (including the
    // retired 'not_configured' setup card) render nothing; logs.tsx
    // purges those entries from the DB on mount. The setup copy is
    // gone from the feed by design (Anuraj, Sept 20, 2026).
    return null;
  }

  // Ready: text-only summary card. No attachment row, no Open › — report
  // entries never carry files anymore. Long summaries clamp to 4 lines
  // with a coral "Show more" toggle that appears only when the text
  // overflows the clamp; tapping expands the full text and the toggle
  // flips to "Show less". Short summaries never show the toggle
  // (Anuraj-approved Sept 2026).
  return (
    <View style={styles.summaryCard} testID="report-summary-card">
      <Text style={styles.summaryTitle} testID="report-summary-title">
        {state.title}
      </Text>
      <View style={styles.summaryBodyWrap}>
        <Text
          style={styles.summaryBody}
          numberOfLines={expanded ? undefined : 4}
          ellipsizeMode="tail"
          onLayout={(e) => {
            if (!expanded) setClampedHeight(e.nativeEvent.layout.height);
          }}
        >
          {state.summary}
        </Text>
        {!expanded && (
          <Text
            style={[styles.summaryBody, styles.summaryBodyMeasure]}
            onLayout={(e) => setFullHeight(e.nativeEvent.layout.height)}
            importantForAccessibility="no-hide-descendants"
          >
            {state.summary}
          </Text>
        )}
      </View>
      {(hasOverflow || expanded) && (
        <Pressable
          testID="report-summary-toggle"
          accessibilityRole="button"
          accessibilityLabel={
            expanded
              ? 'Show less of the report summary'
              : 'Show more of the report summary'
          }
          onPress={() => setExpanded((v) => !v)}
          hitSlop={8}
          style={styles.summaryToggle}
        >
          <Text style={styles.summaryToggleText}>
            {expanded ? 'Show less' : 'Show more'}
          </Text>
        </Pressable>
      )}
      {/* Fixed disclaimer — never model-written (Anuraj-approved spec). */}
      <Text style={styles.summaryDisclaimer}>{REPORT_SUMMARY_DISCLAIMER}</Text>
    </View>
  );
}

function visibilityLabel(v: LocalEvent['visibility']): string {
  if (v === 'shared') return '👥 Shared';
  if (v === 'export') return '⤴ In export';
  return '🔒 Only you';
}

export interface EventCardProps {
  event: LocalEvent;
  /**
   * When present and the event is an appointment, the whole card is a
   * pressable that calls it with the appointment's event id (opens the
   * appointment editor). The card carries no reminder mention — just the
   * title and the dynamic "{n} questions to ask" line.
   */
  onAppointmentPress?: (eventId: string) => void;
  /**
   * When present, EVERY feed card gets a small × in its top-right corner
   * (44×44 hit area). Tapping it calls this with the event (opens the
   * shared delete confirmation) and does NOT trigger onAppointmentPress
   * or report expand — the × is a sibling of the card Pressable, never
   * nested inside it. Mockup 18 pattern, mockup 30 (Anuraj approved
   * Sept 20, 2026) extended to all card types.
   */
  onCardDelete?: (event: LocalEvent) => void;
  /**
   * Loved-by partner names for this card (mockup 34, owner side).
   * Rendered as "Loved by {name}" under the card body when non-empty.
   * The parent feeds this from get_entry_loves(); absent = unknown.
   */
  lovedBy?: string[];
  /**
   * Partner home (card parity — Anuraj, Sept 2026): the partner feed
   * renders the SAME EventCard with partnerMode. The ONLY difference
   * from the feed card is the heart, which sits in the TOP-RIGHT corner
   * as the single interaction. Everything else — the shared Card
   * container, the meta row, the body sections, the typography — is
   * identical by construction. Owner-only controls never render here:
   * no share switch, no delete ×, no visibility label, no appointment
   * editor pressable.
   */
  partnerMode?: boolean;
  /** partnerMode: the current loved state for the top-right heart. */
  loved?: boolean;
  /** partnerMode: toggles the love on the entry. */
  onToggleLove?: (eventId: string) => void;
  /**
   * partnerMode: quiet "Loved by {name}" line under the body when the
   * entry is loved (same styling as the feed's lovedBy line).
   */
  partnerLoveText?: string;
}

/** "1 question to ask" / "2 questions to ask" — proper pluralization. */
function questionsLine(count: number): string {
  return count === 1 ? '1 question to ask' : `${count} questions to ask`;
}

/** Partner heart glyph: coral-filled when loved, quiet outline otherwise. */
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

function partnerCleanText(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** "Tuesday, Sep 22 · 2:00 PM" — the appointment's scheduled moment. */
function partnerApptWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

/**
 * Partner appointment's essential info, in the feed appointment card's
 * "{n} questions to ask" slot (same typography): when it is and who it
 * is with. Questions are the owner's business — the partner sees the
 * schedule.
 */
function partnerApptInfoLine(data: Record<string, unknown>, occurredAt: string): string {
  const when = partnerCleanText(data.when) ?? partnerApptWhen(occurredAt);
  const withWhom = partnerCleanText(data.provider);
  return withWhom ? `${when} · with ${withWhom}` : when;
}

export default function EventCard({
  event,
  onAppointmentPress,
  onCardDelete,
  lovedBy,
  partnerMode,
  loved,
  onToggleLove,
  partnerLoveText,
}: EventCardProps) {
  const meta = metaFor(event.type);
  const data = event.data;
  // Partner home renders the same card minus every owner-only control.
  const partner = !!partnerMode;
  const text = typeof data.text === 'string' ? data.text : typeof data.note === 'string' ? data.note : '';
  const atts = attachmentsOf(data);
  // Report entries are text-only: their whole rendering is the
  // ReportSummarySection (interim / summary / error card). The generic
  // text + photo/file/backup rendering below is suppressed for them —
  // no raw filename, no attachment row, no "Backing up…".
  const isReport = event.type === 'report';
  const isAppointment = event.type === 'appointment';
  const isKickSession = event.type === 'kick_session';
  // Labor activities render their own section (mockup 32 rev 2): the
  // unified "Activity" card names the activity inside, plus the provider
  // line on contraction-timing cards only.
  const isLaborCard = event.type === 'activity';
  const appointmentQuestions = isAppointment ? readQuestions(event) : [];
  const appointmentPressable = isAppointment && !!onAppointmentPress && !partner;
  // Mockup 30: the delete × renders on EVERY feed card type when the
  // parent wires onCardDelete. Never on partner cards.
  const deletable = !!onCardDelete && !partner;
  const delCopy = deletable ? deleteCopyFor(event) : null;
  // Mockup 33B (Anuraj approved Sept 21, 2026): per-entry Shared switches
  // are gone from every feed card. Shareable card types (log entries,
  // kick sessions, appointments, Activity cards, report summaries) show
  // the read-only family icon in the top-right corner — only when the
  // entry is shared. Unshared entries show the × alone. Never on partner
  // cards: the partner only ever sees shared entries.
  const shareableType = canToggleSharing(event.type) && !partner;
  const showFamilyIcon =
    deletable && shareableType && isSharedVisibility(event.visibility);
  // Contraction-timing cards keep the partner's warm wave (mockup 34,
  // Anuraj approved) inside the identical card shell; the feed's plain
  // text lines render everywhere else.
  let showPartnerWave = false;
  let waveCount = 0;
  let waveSpanSec = 0;
  let waveAvgIntervalSec: number | null = null;
  if (partner && isLaborCard) {
    try {
      const c = readActivityCard(data);
      if (c?.activityKind === 'contraction') {
        showPartnerWave = true;
        waveCount = c.count;
        waveSpanSec = c.spanSec;
        waveAvgIntervalSec = c.avgIntervalSec;
      }
    } catch {
      showPartnerWave = false;
    }
  }

  let title: string | null = null;
  let chips: string[] = [];
  if (event.type === 'mood' && typeof data.mood === 'string') {
    title = `Feeling ${data.mood}`;
  } else if (event.type === 'symptom' && Array.isArray(data.symptoms)) {
    chips = (data.symptoms as unknown[]).filter((s): s is string => typeof s === 'string');
  } else if (event.type === 'weight' && typeof data.value === 'number') {
    title = `${data.value} ${data.unit === 'kg' ? 'kg' : 'lbs'}`;
  } else if ((event.type === 'milestone' || event.type === 'appointment') && typeof data.title === 'string') {
    title = data.title;
  }

  const photos = atts.filter((a) => a.kind === 'photo');
  const files = atts.filter((a) => a.kind !== 'photo');
  // No backup-status line: photo persistence is OFF app-wide
  // (PHOTOS_PERSIST_ENABLED = false), so nothing ever uploads and no
  // "Backing up…" state may be shown — for photos or files.

  /**
   * The meta row for shareable card types carries the compact
   * "{label} · {day}" kicker (mockup 33B) — no switch, no caption, no
   * visibility label. Sharing status lives only in the top-right family
   * icon. Non-shareable types keep the classic type row + time +
   * visibility label.
   */
  /**
   * Partner mode: the same meta row minus every owner-only control —
   * type dot + label, time beneath, no visibility label, no switch.
   */
  const partnerMetaRow = (
    <View>
      <View style={styles.meta}>
        <View style={styles.metaLeft}>
          <View style={styles.typeRow}>
            <View style={[styles.dot, { backgroundColor: eventDots[meta.dot] }]}>
              <Text style={styles.dotGlyph}>{meta.glyph}</Text>
            </View>
            <Text style={styles.typeLabel}>{meta.label}</Text>
          </View>
          <Text style={styles.time}>{formatTime(event.occurredAt)}</Text>
        </View>
      </View>
    </View>
  );

  const metaRow = partner ? (
    partnerMetaRow
  ) : (
    <View>
      <View style={styles.meta}>
        <View style={styles.metaLeft}>
          {shareableType ? (
            <View style={[styles.typeRow, styles.shrink]}>
              <View style={[styles.dot, { backgroundColor: eventDots[meta.dot] }]}>
                <Text style={styles.dotGlyph}>{meta.glyph}</Text>
              </View>
              <Text
                style={[styles.typeLabel, styles.shrink, styles.shareKicker]}
                testID={`event-card-date-${event.id}`}
                numberOfLines={1}
              >
                {meta.label} · {formatDay(event.occurredAt)}
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.typeRow}>
                <View style={[styles.dot, { backgroundColor: eventDots[meta.dot] }]}>
                  <Text style={styles.dotGlyph}>{meta.glyph}</Text>
                </View>
                <Text style={styles.typeLabel}>{meta.label}</Text>
              </View>
              {!isAppointment ? (
                <Text style={styles.time} testID={`event-card-time-${event.id}`}>{formatTime(event.occurredAt)}</Text>
              ) : null}
            </>
          )}
          {!shareableType && !isAppointment ? (
            <Text style={styles.visibility}>{visibilityLabel(event.visibility)}</Text>
          ) : null}
          {!shareableType && isAppointment ? (
            <Text style={[styles.visibility, styles.visibilityInline]}>
              {visibilityLabel(event.visibility)}
            </Text>
          ) : null}
        </View>
        {!shareableType && isAppointment ? (
          <Text style={[styles.time, styles.timeRight]} testID={`event-card-date-${event.id}`}>{formatTime(event.occurredAt)}</Text>
        ) : null}
      </View>
    </View>
  );

  const bodyContent = (
    <>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {isAppointment && !partner ? (
        <Text style={styles.questions} testID={`event-card-questions-${event.id}`}>
          {questionsLine(appointmentQuestions.length)}
        </Text>
      ) : null}
      {/* Partner mode: the appointment's essential info (when + who)
          in the same slot/typography — the feed's "{n} questions to ask"
          is the owner's business. */}
      {isAppointment && partner ? (
        <Text style={styles.questions} testID={`event-card-apptinfo-${event.id}`}>
          {partnerApptInfoLine(data, event.occurredAt)}
        </Text>
      ) : null}
      {/* Kick sessions render their own section (mockup 23): session
          line, strength note, and — owner side only — the deviation-only
          appointment link. Partner mode renders the same lines without
          the owner actions. */}
      {isKickSession ? <KickFeedSection event={event} partnerMode={partner} /> : null}
      {isLaborCard ? (
        showPartnerWave ? (
          <ContractionWave
            count={waveCount}
            spanSec={waveSpanSec}
            avgIntervalSec={waveAvgIntervalSec}
            occurredAt={event.occurredAt}
          />
        ) : (
          <LaborFeedSection event={event} />
        )
      ) : null}
      {!isReport && text ? <Text style={styles.text}>{text}</Text> : null}
      {chips.length > 0 ? (
        <View style={styles.chipRow}>
          {chips.map((c) => (
            <View key={c} style={styles.schip}>
              <Text style={styles.schipText}>{c}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {!isReport && photos.length > 0 ? (
        <View style={styles.photoRow}>
          {photos.slice(0, 3).map((p, i) => (
            <PhotoPlaceholder
              key={p.id || i}
              label={p.name ?? 'Photo'}
            />
          ))}
        </View>
      ) : null}
      {!isReport && files.length > 0 ? (
        <View style={styles.chipRow}>
          {files.map((f, i) => (
            <View key={f.id || i} style={styles.fchip}>
              <Text style={styles.fchipText}>▤ {f.name ?? 'Attachment'}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {isReport ? <ReportSummarySection event={event} partnerMode={partner} /> : null}
      {/* Mockup 34 (owner side): the partner's heart shows up here as
          "Loved by {partner name}". Quiet, warm, never a control. */}
      {!partner && lovedBy && lovedBy.length > 0 ? (
        <Text style={styles.lovedBy} testID={`event-card-lovedby-${event.id}`}>
          ♥ {lovedByLabel(lovedBy)}
        </Text>
      ) : null}
      {/* Partner side: the same quiet line, partner wording, under the
          body — while the heart itself lives in the top-right corner. */}
      {partner && partnerLoveText ? (
        <Text style={styles.lovedBy} testID={`partner-lovedby-${event.id}`}>
          ♥ {partnerLoveText}
        </Text>
      ) : null}
    </>
  );

  return (
    <View style={deletable || partner ? styles.cardWrap : undefined}>
      {appointmentPressable ? (
        <Card
          style={[styles.card, deletable && styles.cardDeletable, showFamilyIcon && styles.cardShared]}
          testID={`event-card-${event.id}`}
        >
          {metaRow}
          <Pressable
            testID={`event-card-pressable-${event.id}`}
            onPress={() => onAppointmentPress!(event.id)}
            accessibilityRole="button"
            accessibilityLabel={`Appointment. ${title ?? ''}. Tap to open.`}
          >
            {bodyContent}
          </Pressable>
        </Card>
      ) : (
        <Card
          style={[styles.card, deletable && styles.cardDeletable, showFamilyIcon && styles.cardShared, partner && styles.cardPartner]}
          testID={`event-card-${event.id}`}
        >
          {metaRow}
          {bodyContent}
        </Card>
      )}
      {deletable ? (
        <Pressable
          testID={`event-card-delete-${event.id}`}
          accessibilityRole="button"
          accessibilityLabel={delCopy!.xLabel}
          onPress={() => onCardDelete!(event)}
          hitSlop={8}
          style={({ pressed }) => [styles.delBtn, pressed && styles.delPressed]}
        >
          <Text style={styles.delGlyph}>×</Text>
        </Pressable>
      ) : null}
      {/* Mockup 33B: the read-only family icon — shared entries only,
          top-right, immediately left of the ×. A status indicator, NOT a
          control: no Pressable, no tap target. */}
      {showFamilyIcon ? (
        <FamilyShareIcon
          testID={`event-card-share-icon-${event.id}`}
          style={styles.shareIcon}
        />
      ) : null}
      {/* Partner home: the ONLY allowed difference from the feed card —
          the heart sits in the top-right corner (same 44×44 corner
          pattern as the feed's delete ×), never nested in the card. */}
      {partner ? (
        <Pressable
          testID={`partner-heart-${event.id}`}
          accessibilityRole="button"
          accessibilityLabel={loved ? 'Unlove this moment' : 'Love this moment'}
          onPress={() => onToggleLove?.(event.id)}
          hitSlop={10}
          style={({ pressed }) => [styles.heartBtn, pressed && styles.delPressed]}
        >
          <HeartGlyph loved={!!loved} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  /**
   * Mockup 18/30: relative wrapper so the delete × can sit in the card's
   * top-right corner as a sibling of the card Pressable — a sibling never
   * triggers the card's onPress, so tapping × never opens the editor and
   * never toggles report summaries.
   */
  cardWrap: {
    position: 'relative',
  },
  /** Extra right padding keeps the meta row clear of the × hit zone. */
  cardDeletable: {
    paddingRight: 52,
  },
  /** Mockup 18 delete ×: 44×44 hit area, top-right, muted stone. */
  delBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  delPressed: {
    opacity: 0.5,
  },
  /**
   * Partner heart: the ONLY allowed partner/feed difference — the same
   * 44×44 top-right corner pattern as the delete ×.
   */
  heartBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Partner cards: extra right padding keeps the meta row clear of the heart. */
  cardPartner: {
    paddingRight: 52,
  },
  delGlyph: {
    fontSize: 19,
    lineHeight: 24,
    color: '#B7ACA0',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  shrink: {
    flexShrink: 1,
  },
  shareKicker: {
    letterSpacing: 0.2,
  },
  metaDate: {
    flexShrink: 1,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotGlyph: {
    color: '#fff',
    fontSize: 13,
  },
  typeLabel: {
    ...typeScale.footnote,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  /** Mockup 34: "Loved by {partner name}" — warm, quiet, coral-deep. */
  lovedBy: {
    ...typeScale.footnote,
    color: colors.coralDeep,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  time: {
    ...typeScale.footnote,
    color: colors.muted,
  },
  // Appointment cards: the date rides the right end of the meta row.
  timeRight: {
    marginLeft: 'auto',
  },
  // Appointment cards: visibility sits right after the type label instead
  // of riding the right end (the date takes that spot).
  visibilityInline: {
    marginLeft: 0,
  },
  visibility: {
    ...typeScale.footnote,
    color: colors.muted,
    fontWeight: '600',
    marginLeft: 'auto',
  },
  // Mockup 33B: read-only family icon — shared entries only. Absolute,
  // immediately left of the 44×44 delete ×, vertically centered on it.
  // Non-interactive: no tap target, no Pressable.
  shareIcon: {
    position: 'absolute',
    top: 16,
    right: 52,
  },
  /** Mockup 33B: extra right padding clears the family icon + × corner. */
  cardShared: {
    paddingRight: 88,
  },
  title: {
    ...typeScale.headline,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  text: {
    ...typeScale.body,
    color: '#5C554D',
    lineHeight: 24,
  },
  /* Appointment card: dynamic "{n} questions to ask" line. */
  questions: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.coralDeep,
    marginBottom: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  schip: {
    backgroundColor: colors.blush,
    borderRadius: radii.chip,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
  },
  schipText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.coralDeep,
  },
  fchip: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.docPreview,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  fchipText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.ink,
  },
  photoRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  /* Photo placeholder: affordance only — no bytes are ever loaded. */
  photoPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 14,
    backgroundColor: colors.blush,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CFC4B4',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  photoGlyph: {
    fontSize: 26,
    color: colors.muted,
  },
  photoLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  /* Report summary (Anuraj-approved Sept 2026). */
  summaryLoading: {
    marginTop: spacing.sm,
    backgroundColor: colors.blush,
    borderRadius: radii.card,
    padding: spacing.md,
  },
  summaryLoadingText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.coralDeep,
  },
  summaryCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.blush,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  summaryTitle: {
    fontFamily: fontDisplay,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '600',
    color: colors.ink,
  },
  summaryBody: {
    ...typeScale.body,
    color: '#5C554D',
    lineHeight: 24,
  },
  /** Relative anchor for the hidden overflow-measurement twin. */
  summaryBodyWrap: {
    position: 'relative',
  },
  /**
   * The overflow-measurement twin: identical text, no clamp, invisible
   * and non-interactive. Its laid-out height tells us whether the
   * visible text overflows the 4-line clamp. Hidden from assistive tech
   * (duplicate content).
   */
  summaryBodyMeasure: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
  },
  /** "Show more" / "Show less" on long report summaries: coral, 44pt. */
  summaryToggle: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  summaryToggleText: {
    ...typeScale.subhead,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  summaryDisclaimer: {
    ...typeScale.footnote,
    color: colors.muted,
    fontStyle: 'italic',
  },
  summaryFailedText: {
    ...typeScale.subhead,
    color: '#5C554D',
    marginTop: spacing.sm,
  },
});
