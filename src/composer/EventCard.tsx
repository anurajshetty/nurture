/**
 * Timeline event card (Epic 2): the keepsake stream on Home.
 *
 * One card per event: type dot + label, relative time, visibility, then
 * the content in the event's own shape (text, symptom chips, mood title,
 * weight line, photo tiles, file chips). Warm, quiet, no clinical chrome.
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import Card from '../components/Card';
import {
  colors,
  eventDots,
  radii,
  spacing,
  type as typeScale,
  type EventDotKind,
} from '../theme/tokens';
import type { LocalEvent } from '../lib/types';

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

interface AttachmentRef {
  kind?: string;
  uri?: string;
  name?: string;
}

function attachmentsOf(data: Record<string, unknown>): AttachmentRef[] {
  const raw = data.attachments;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is AttachmentRef => typeof a === 'object' && a !== null,
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

  const photos = atts.filter((a) => a.kind === 'photo' && a.uri);
  const files = atts.filter((a) => a.kind !== 'photo');

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
      {photos.length > 0 ? (
        <View style={styles.photoRow}>
          {photos.slice(0, 3).map((p, i) => (
            <Image key={p.uri ?? i} source={{ uri: p.uri }} style={styles.photo} />
          ))}
        </View>
      ) : null}
      {files.length > 0 ? (
        <View style={styles.chipRow}>
          {files.map((f, i) => (
            <View key={f.uri ?? i} style={styles.fchip}>
              <Text style={styles.fchipText}>▤ {f.name ?? 'Attachment'}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
});
