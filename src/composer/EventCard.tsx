/**
 * Timeline event card (Epic 2): the keepsake stream on Home.
 *
 * One card per event: type dot + label, relative time, visibility, then
 * the content in the event's own shape (text, symptom chips, mood title,
 * weight line, photo tiles, file chips). Warm, quiet, no clinical chrome.
 */

import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { bucketForKind, type EventAttachment, type LocalEvent } from '../lib/types';
import { getSignedMediaUrl } from '../sync/media';
import { getEvent } from '../sync/store';
import {
  readReportSummaryState,
  REPORT_SUMMARY_DISCLAIMER,
  summarizableAttachment,
  summarizeReport,
  writeReportSummaryState,
  type ReportSummaryState,
} from '../reportSummary/client';

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
  kick_session: { label: 'Kicks', glyph: '✦', dot: 'kick' },
  question: { label: 'Question', glyph: '◉', dot: 'question' },
};

function metaFor(type: string): TypeMeta {
  return TYPE_META[type] ?? { label: 'Moment', glyph: '◐', dot: 'note' };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  const dayMs = 86_400_000;
  const dayDiff = Math.round((startOf(now).getTime() - startOf(d).getTime()) / dayMs);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (dayDiff <= 0) return `Today · ${time}`;
  if (dayDiff === 1) return `Yesterday · ${time}`;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} · ${time}`;
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
 * Resolves the viewable URI for an attachment: the device-local copy when
 * present, otherwise a short-lived signed URL for the cloud backup (e.g.
 * on a second device, or on web after a tab was closed).
 */
function useAttachmentUri(a: EventAttachment): string | null {
  const [uri, setUri] = useState<string | null>(a.local_uri ?? null);
  useEffect(() => {
    let live = true;
    if (a.local_uri) {
      setUri(a.local_uri);
      return;
    }
    if (a.upload === 'done' && a.storage_path) {
      setUri(null);
      void getSignedMediaUrl(bucketForKind(a.kind), a.storage_path).then((signed) => {
        if (live) setUri(signed);
      });
    } else {
      setUri(null);
    }
    return () => {
      live = false;
    };
  }, [a.local_uri, a.upload, a.storage_path, a.kind]);
  return uri;
}

function MediaPhoto({ attachment }: { attachment: EventAttachment }) {
  const uri = useAttachmentUri(attachment);
  if (!uri) return null;
  return <Image source={{ uri }} style={styles.photo} />;
}

/** One-line honest backup status for the card's attachments. */
function backupStatus(atts: EventAttachment[]): string | null {
  if (atts.some((a) => a.upload === 'failed')) return 'Not backed up yet';
  if (atts.some((a) => a.upload === 'pending')) return 'Backing up…';
  return null;
}

/* ------------------------------------------------------------------ */
/* Report summary (Anuraj-approved Sept 2026).                          */
/*                                                                     */
/* Report-category timeline entries only. After a report's attachment   */
/* upload reaches `upload: 'done'` with a `storage_path`, the entry     */
/* shows "Reading your report…" while the app invokes the              */
/* `report-summary` edge function, then renders the summary card        */
/* (serif title, plain-language body, attachment row with the           */
/* LLM-derived friendly name + Open ›, fixed disclaimer). On any        */
/* failure the card says "Couldn't read this one — try a clearer        */
/* photo." with Try again; the original attachment stays openable.      */
/* The summary state lives on `event.data.reportSummary` so it          */
/* survives reloads and syncs like any other payload change.            */
/* ------------------------------------------------------------------ */

/** Event ids with a summary request currently in flight (survives remounts). */
const inflightSummaries = new Set<string>();

/** Opens the original file: device-local copy, else a signed cloud URL. */
async function openReportAttachment(att: EventAttachment): Promise<void> {
  try {
    let uri: string | null = att.local_uri ?? null;
    if (!uri && att.upload === 'done' && att.storage_path) {
      uri = await getSignedMediaUrl(bucketForKind(att.kind), att.storage_path);
    }
    if (uri) await Linking.openURL(uri);
  } catch {
    // Best-effort: opening never throws into the card.
  }
}

function SummaryAttachmentRow({
  attachment,
  friendlyName,
  caption,
}: {
  attachment: EventAttachment;
  /** The LLM-derived name (ready state) or null to show the raw filename. */
  friendlyName: string | null;
  /** Overrides the "Auto-named from your report" caption (e.g. "Backing up…"). */
  caption?: string | null;
}) {
  return (
    <View style={styles.summaryAttRow}>
      <View style={styles.summaryAttInfo}>
        <Text style={styles.summaryAttName} numberOfLines={1}>
          {friendlyName ?? attachment.name}
        </Text>
        {caption || friendlyName ? (
          <Text style={styles.summaryAttCaption}>
            {caption ?? 'Auto-named from your report'}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => void openReportAttachment(attachment)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${friendlyName ?? attachment.name}`}
        testID="report-summary-open"
        style={({ pressed }) => [styles.summaryOpen, pressed && styles.summaryOpenPressed]}>
        <Text style={styles.summaryOpenText}>Open ›</Text>
      </Pressable>
    </View>
  );
}

function ReportSummarySection({ event }: { event: LocalEvent }) {
  // A persisted 'reading' state is stale after an app relaunch (the request
  // died with the JS runtime) — display it, but let the trigger below
  // re-invoke since nothing is actually in flight.
  const persisted = readReportSummaryState(event.data);
  const [state, setState] = useState<ReportSummaryState | null>(() => persisted);
  const [attachment, setAttachment] = useState<EventAttachment | null>(() =>
    summarizableAttachment(attachmentsOf(event.data)),
  );
  const [rawAttachment, setRawAttachment] = useState<EventAttachment | null>(
    () => attachmentsOf(event.data)[0] ?? null,
  );

  // Moves the section into the 'reading' state (persisted + set). The
  // edge-function request itself fires from the effect below, AFTER React
  // commits 'reading' — effects run post-commit, so "Reading your report…"
  // is guaranteed to be painted before the network request starts.
  // (Setting state and awaiting the fetch in the same tick lets React
  // batch/skip the intermediate paint, so the loading indicator never
  // appears.)
  const beginReading = useCallback(
    (att: EventAttachment) => {
      const reading: ReportSummaryState = { status: 'reading' };
      writeReportSummaryState(event.id, reading);
      setAttachment(att);
      setState(reading);
    },
    [event.id],
  );

  // Fires the summary request once 'reading' has committed (and only then).
  useEffect(() => {
    if (state?.status !== 'reading') return;
    if (!attachment) return;
    if (inflightSummaries.has(event.id)) return;
    inflightSummaries.add(event.id);
    const att = attachment;
    let cancelled = false;
    (async () => {
      try {
        const result = await summarizeReport({
          eventId: event.id,
          bucket: bucketForKind(att.kind),
          storagePath: att.storage_path ?? '',
          mimeType: att.mimeType ?? '',
        });
        if (cancelled) return;
        const ready: ReportSummaryState = { status: 'ready', ...result };
        writeReportSummaryState(event.id, ready);
        setState(ready);
      } catch {
        if (cancelled) return;
        const failed: ReportSummaryState = { status: 'failed' };
        writeReportSummaryState(event.id, failed);
        setState(failed);
      } finally {
        inflightSummaries.delete(event.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state?.status, event.id, attachment]);

  useEffect(() => {
    if (event.type !== 'report') return;
    let live = true;

    // The card's props are a snapshot: re-read the event from the store so
    // the trigger sees the attachment's upload completion even though the
    // background media drain never re-renders this card.
    const check = () => {
      if (!live) return;
      const fresh = getEvent(event.id);
      const data = fresh?.data ?? event.data;
      const stored = readReportSummaryState(data);
      // Stale 'reading' (persisted by a request that died with the JS
      // runtime) re-triggers below; a genuinely in-flight request doesn't.
      const next =
        stored?.status === 'reading' && !inflightSummaries.has(event.id) ? null : stored;
      setState((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      const att = summarizableAttachment(attachmentsOf(data));
      setAttachment((prev) => (prev?.id === att?.id ? prev : att));
      const raw = attachmentsOf(data)[0] ?? null;
      setRawAttachment((prev) => (prev?.id === raw?.id ? prev : raw));
      // Trigger: attachment backed up, no summary state yet, nothing in flight.
      // beginReading only sets state; the fetch effect fires after commit.
      if (!next && att && !inflightSummaries.has(event.id)) {
        beginReading(att);
      }
    };
    check();
    const timer = setInterval(check, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [event.id, event.type, beginReading]);

  if (event.type !== 'report') return null;
  // The section owns all attachment display for report entries (the card
  // suppresses its generic photo/file/backup rendering for reports).
  const displayAttachment = attachment ?? rawAttachment;
  if (!displayAttachment) return null;

  if (!state) {
    // Attachment exists but isn't backed up yet — honest backup status on
    // the attachment row itself.
    return (
      <SummaryAttachmentRow
        attachment={displayAttachment}
        friendlyName={null}
        caption={displayAttachment.upload === 'failed' ? 'Not backed up yet' : 'Backing up…'}
      />
    );
  }

  if (state.status === 'reading') {
    return (
      <View style={styles.summaryLoading} testID="report-summary-loading">
        <Text style={styles.summaryLoadingText}>Reading your report…</Text>
      </View>
    );
  }

  if (state.status === 'failed') {
    return (
      <View testID="report-summary-failed">
        <Text style={styles.summaryFailedText}>Couldn&apos;t read this one — try a clearer photo.</Text>
        <Pressable
          onPress={() => {
            // Try again re-invokes against the same backed-up attachment.
            // beginReading only sets state; the fetch effect fires after commit.
            if (attachment) beginReading(attachment);
          }}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          testID="report-summary-retry"
          style={({ pressed }) => [styles.retryBtn, pressed && styles.retryPressed]}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
        <SummaryAttachmentRow attachment={displayAttachment} friendlyName={null} />
      </View>
    );
  }

  return (
    <View style={styles.summaryCard} testID="report-summary-card">
      <Text style={styles.summaryTitle} testID="report-summary-title">
        {state.title}
      </Text>
      <Text style={styles.summaryBody}>{state.summary}</Text>
      <SummaryAttachmentRow attachment={displayAttachment} friendlyName={state.attachmentName} />
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

export default function EventCard({ event }: { event: LocalEvent }) {
  const meta = metaFor(event.type);
  const data = event.data;
  const text = typeof data.text === 'string' ? data.text : typeof data.note === 'string' ? data.note : '';
  const atts = attachmentsOf(data);
  // Report entries render their attachment exclusively through
  // ReportSummarySection (friendly name + Open ›, honest backup status);
  // the generic photo/file/backup rendering below is suppressed for them.
  const isReport = event.type === 'report';

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
  const status = backupStatus(atts);

  return (
    <Card style={styles.card} testID={`event-card-${event.id}`}>
      <View style={styles.meta}>
        <View style={styles.typeRow}>
          <View style={[styles.dot, { backgroundColor: eventDots[meta.dot] }]}>
            <Text style={styles.dotGlyph}>{meta.glyph}</Text>
          </View>
          <Text style={styles.typeLabel}>{meta.label}</Text>
        </View>
        <Text style={styles.time}>{formatTime(event.occurredAt)}</Text>
        <Text style={styles.visibility}>{visibilityLabel(event.visibility)}</Text>
      </View>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {text ? <Text style={styles.text}>{text}</Text> : null}
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
            <MediaPhoto key={p.id || i} attachment={p} />
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
      {isReport ? <ReportSummarySection event={event} /> : null}
      {!isReport && status ? <Text style={styles.backupStatus}>{status}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
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
  time: {
    ...typeScale.footnote,
    color: colors.muted,
  },
  visibility: {
    ...typeScale.footnote,
    color: colors.muted,
    fontWeight: '600',
    marginLeft: 'auto',
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
  photo: {
    width: 96,
    height: 96,
    borderRadius: 14,
    backgroundColor: colors.blush,
  },
  backupStatus: {
    ...typeScale.footnote,
    color: colors.muted,
    marginTop: spacing.sm,
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
  summaryAttRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#fff',
    borderRadius: radii.docPreview,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  summaryAttInfo: {
    flex: 1,
  },
  summaryAttName: {
    ...typeScale.subhead,
    fontWeight: '700',
    color: colors.ink,
  },
  summaryAttCaption: {
    ...typeScale.footnote,
    color: colors.muted,
    marginTop: 2,
  },
  summaryOpen: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  summaryOpenPressed: {
    opacity: 0.6,
  },
  summaryOpenText: {
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
  retryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.coral,
    borderRadius: radii.chip,
    paddingVertical: spacing.sm,
    paddingHorizontal: 18,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  retryPressed: {
    backgroundColor: colors.coralDeep,
  },
  retryText: {
    ...typeScale.subhead,
    fontWeight: '700',
    color: '#fff',
  },
});
