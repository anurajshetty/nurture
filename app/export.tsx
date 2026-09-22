/**
 * Epic 8 — OB-visit export screen (`/export`).
 *
 * Entry point: the "Export for OB visit" row in You > Your space.
 * Works with `pregnancy.status === 'stopped'` (contract C3) — the screen
 * reads journal events directly and never gates on pregnancy status.
 *
 * Flow mirrors the approved mockup (design/08-export.html):
 *  date-range chips (default "Since last visit") → per-section include
 *  toggles → explicitly-added private notes / photos / partner entries
 *  (partner picker preselects 📄 +Export entries) → live preview →
 *  Generate → iOS share sheet (AirDrop, Mail, Print, Files) or web download.
 *
 * The summary payload is facts-only HTML generated on-device
 * (`src/export/obVisit.ts`); nothing leaves the device except through her
 * explicit share action.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button,
  Screen,
  SectionHeader,
  Toggle,
} from '../src/components';
import { colors, radii, spacing, type as typeScale } from '../src/theme/tokens';
import {
  buildVisitSummary,
  categorizeForExport,
  defaultExportOptions,
  preselectExportMarked,
  renderSummaryHtml,
  SECTION_KEYS,
  SECTION_TITLES,
  summaryCounts,
  type ExportOptions,
  type SectionKey,
  type VisitSummary,
} from '../src/export/obVisit';
import type { LocalEvent } from '../src/lib/types';
import {
  LAST_VISIT_KV_KEY,
  resolveRange,
  type RangePreset,
} from '../src/export/range';
import { shareSummaryHtml, summaryFilename } from '../src/export/share';
import { useTimezoneVersion } from '../src/time/timezone';
import { kvGet, kvSet } from '../src/lib/db';
import { listEventsInRange } from '../src/sync/store';

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'since_last_visit', label: 'Since last visit' },
  { id: 'last_30_days', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom…' },
];

const SECTION_ICONS: Record<SectionKey, string> = {
  symptoms: '✚',
  weight: '◐',
  kicks: '✦',
  notes: '✎',
  questions: '?',
};

const ISO_HINT = 'YYYY-MM-DD';

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function formatGenDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

export default function ExportScreen() {
  const router = useRouter();
  // Timezone-change backstop (Anuraj, Sept 2026): the visit summary is
  // memoized with device-local times — recompute it when the zone changes
  // mid-session.
  const tzVersion = useTimezoneVersion();
  const [preset, setPreset] = useState<RangePreset>('since_last_visit');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [storedLastVisit, setStoredLastVisit] = useState<string | null>(null);
  const [allEvents, setAllEvents] = useState<LocalEvent[]>([]);
  const [options, setOptions] = useState<ExportOptions>(defaultExportOptions);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      setStoredLastVisit(kvGet(LAST_VISIT_KV_KEY));
    } catch { /* kv unavailable — appointment fallback still works */ }
    try {
      // Wide window, loaded once; range slicing is client-side below.
      setAllEvents(listEventsInRange('2000-01-01', '2100-01-01', 2000));
    } catch { setAllEvents([]); }
  }, []);

  const nowISO = useMemo(() => new Date().toISOString(), []);

  const resolvedResult = useMemo(() => {
    try {
      return {
        range: resolveRange({
          preset,
          now: new Date(nowISO),
          events: allEvents,
          storedLastVisitISO: storedLastVisit,
          customStartISO: customStart.trim() || undefined,
          customEndISO: customEnd.trim() || undefined,
        }),
        error: null as string | null,
      };
    } catch (err) {
      return {
        range: null,
        error: err instanceof Error ? err.message : 'That range didn’t work.',
      };
    }
  }, [preset, customStart, customEnd, storedLastVisit, allEvents, nowISO]);

  const resolved = resolvedResult.range;
  const rangeError = resolvedResult.error;

  const inRange = useMemo(() => {
    if (!resolved) return [];
    return allEvents.filter((e) => {
      const d = dayOf(e.occurredAt);
      return d >= resolved.startISO && d < resolved.endISO;
    });
  }, [allEvents, resolved]);

  const cat = useMemo(() => categorizeForExport(inRange), [inRange]);

  const summary: VisitSummary | null = useMemo(() => {
    if (!resolved) return null;
    return buildVisitSummary(
      cat,
      options,
      { startISO: resolved.startISO, endISO: resolved.endISO, label: resolved.label },
      nowISO,
    );
  }, [cat, options, resolved, nowISO, tzVersion]);

  const counts = useMemo(
    () => (summary ? summaryCounts(summary) : null),
    [summary],
  );

  // Preselect 📄 +Export partner entries the first time the picker data loads.
  useEffect(() => {
    setOptions((prev) => {
      if (prev.partnerEntryIds.length > 0) return prev;
      const pre = preselectExportMarked(cat.partnerEntries);
      return pre.length ? { ...prev, partnerEntryIds: pre } : prev;
    });
  }, [cat.partnerEntries]);

  const toggleSection = (key: SectionKey) =>
    setOptions((p) => ({ ...p, sections: { ...p.sections, [key]: !p.sections[key] } }));

  const togglePartnerEntry = (id: string) =>
    setOptions((p) => ({
      ...p,
      partnerEntryIds: p.partnerEntryIds.includes(id)
        ? p.partnerEntryIds.filter((x) => x !== id)
        : [...p.partnerEntryIds, id],
    }));

  const rememberAsLastVisit = () => {
    const start = customStart.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      setToast('Enter the start date first (YYYY-MM-DD).');
      return;
    }
    try {
      kvSet(LAST_VISIT_KV_KEY, start);
      setStoredLastVisit(start);
      setPreset('since_last_visit');
      setToast('Saved — “Since last visit” now starts there.');
    } catch {
      setToast('Couldn’t save that date on this device.');
    }
  };

  const handleGenerate = async () => {
    if (!summary || generating) return;
    setGenerating(true);
    try {
      const html = renderSummaryHtml(summary);
      const filename = summaryFilename(nowISO);
      const result = await shareSummaryHtml(html, filename);
      if (result.ok) {
        setToast(
          result.method === 'download'
            ? 'Your summary is downloading.'
            : 'Summary ready — pick where to send it.',
        );
      } else {
        setToast(result.error ?? 'Something didn’t work — your data stays safe in the app.');
      }
    } finally {
      setGenerating(false);
    }
  };

  const rangeCaption = resolved
    ? resolved.source === 'stored'
      ? `Since your saved last visit · ${resolved.label}`
      : resolved.source === 'appointment'
        ? `Since your last appointment · ${resolved.label}`
        : resolved.label
    : 'Choose a range to preview your summary.';

  return (
    <Screen testID="export-screen">
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back to You"
        style={styles.backRow}
      >
        <Text style={styles.backChevron}>‹</Text>
        <Text style={styles.backLabel}>You</Text>
      </Pressable>

      <Text style={styles.title}>Visit summary</Text>
      <Text style={styles.intro}>
        A record <Text style={styles.introBold}>you</Text> entered — to bring to your
        appointment. Generated on this device, shared only when you say so.
      </Text>

      <SectionHeader title="Date range" />
      <View style={styles.chips}>
        {PRESETS.map((p) => {
          const active = preset === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => setPreset(p.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              testID={`range-chip-${p.id}`}
              style={[styles.chip, active && styles.chipOn]}
            >
              <Text style={[styles.chipText, active && styles.chipTextOn]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.note}>{rangeCaption}</Text>

      {preset === 'custom' && (
        <View style={styles.customRow}>
          <View style={styles.customField}>
            <Text style={styles.customLabel}>From</Text>
            <TextInput
              testID="custom-start-input"
              value={customStart}
              onChangeText={setCustomStart}
              placeholder={ISO_HINT}
              autoCapitalize="none"
              style={styles.customInput}
            />
          </View>
          <View style={styles.customField}>
            <Text style={styles.customLabel}>To</Text>
            <TextInput
              testID="custom-end-input"
              value={customEnd}
              onChangeText={setCustomEnd}
              placeholder={ISO_HINT}
              autoCapitalize="none"
              style={styles.customInput}
            />
          </View>
          <Pressable onPress={rememberAsLastVisit} accessibilityRole="button" style={styles.saveVisit}>
            <Text style={styles.saveVisitText}>Remember as my last visit</Text>
          </Pressable>
        </View>
      )}
      {rangeError && <Text style={styles.error}>{rangeError}</Text>}

      <SectionHeader title="Include" />
      <View style={styles.rows}>
        {SECTION_KEYS.map((key) => (
          <View key={key} style={styles.row}>
            <View style={styles.rowIcon}>
              <Text style={styles.rowGlyph}>{SECTION_ICONS[key]}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{SECTION_TITLES[key]}</Text>
              <Text style={styles.rowSub}>
                {counts ? `${counts[key]} ${counts[key] === 1 ? 'entry' : 'entries'}` : '—'}
              </Text>
            </View>
            <Toggle
              value={options.sections[key]}
              onValueChange={() => toggleSection(key)}
              testID={`include-toggle-${key}`}
              accessibilityLabel={`Include ${SECTION_TITLES[key]}`}
            />
          </View>
        ))}
      </View>

      <SectionHeader title="Left out by default" />
      <View style={styles.rows}>
        <View style={styles.row}>
          <View style={[styles.rowIcon, styles.rowIconMuted]}>
            <Text style={styles.rowGlyph}>🔒</Text>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Private notes</Text>
            <Text style={styles.rowSub}>Never included unless you add them</Text>
          </View>
          <Pressable
            onPress={() => setOptions((p) => ({ ...p, includePrivateNotes: !p.includePrivateNotes }))}
            accessibilityRole="button"
            testID="add-private-notes"
            style={styles.addLink}
          >
            <Text style={styles.addLinkText}>{options.includePrivateNotes ? 'Added ✓' : 'Add'}</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <View style={[styles.rowIcon, styles.rowIconMuted]}>
            <Text style={styles.rowGlyph}>◉</Text>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Photos</Text>
            <Text style={styles.rowSub}>Location data is removed when shared</Text>
          </View>
          <Pressable
            onPress={() => setOptions((p) => ({ ...p, includePhotos: !p.includePhotos }))}
            accessibilityRole="button"
            testID="add-photos"
            style={styles.addLink}
          >
            <Text style={styles.addLinkText}>{options.includePhotos ? 'Added ✓' : 'Add'}</Text>
          </Pressable>
        </View>

        <View>
          <View style={styles.row}>
            <View style={[styles.rowIcon, styles.rowIconMuted]}>
              <Text style={styles.rowGlyph}>👥</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Partner entries</Text>
              <Text style={styles.rowSub}>
                Only with your explicit say-so · entries marked 📄 +Export are pre-selected
              </Text>
            </View>
            <Pressable
              onPress={() => setPartnerOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: partnerOpen }}
              testID="add-partner-entries"
              style={styles.addLink}
            >
              <Text style={styles.addLinkText}>{partnerOpen ? 'Hide' : 'Add'}</Text>
            </Pressable>
          </View>
          {partnerOpen && (
            <View style={styles.partnerList}>
              {cat.partnerEntries.length === 0 && (
                <Text style={styles.note}>No partner entries in this range.</Text>
              )}
              {cat.partnerEntries.map((e) => {
                const d = (e.data ?? {}) as Record<string, unknown>;
                const text =
                  typeof d.text === 'string' && d.text.trim()
                    ? d.text.trim()
                    : `${e.type} · ${dayOf(e.occurredAt)}`;
                const checked = options.partnerEntryIds.includes(e.id);
                return (
                  <View key={e.id} style={styles.partnerRow}>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {e.visibility === 'export' ? '📄 ' : ''}{text}
                      </Text>
                      <Text style={styles.rowSub}>{dayOf(e.occurredAt)}</Text>
                    </View>
                    <Toggle
                      value={checked}
                      onValueChange={() => togglePartnerEntry(e.id)}
                      testID={`partner-entry-toggle-${e.id}`}
                      accessibilityLabel={`Include partner entry: ${text}`}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>

      <SectionHeader title="Preview" />
      {summary ? (
        <View style={styles.doc} testID="summary-preview">
          <Text style={styles.docTitle}>Visit summary</Text>
          <Text style={styles.docSub}>
            {summary.rangeLabel}{'\n'}
            A user-entered record — not a clinical chart.{'\n'}
            Generated {formatGenDate(summary.generatedAtISO)} on this device.
          </Text>

          {summary.symptoms.length > 0 && options.sections.symptoms && (
            <View>
              <Text style={styles.docSec}>
                Symptoms · {summary.symptoms.reduce((n, x) => n + x.count, 0)} entries
              </Text>
              {summary.symptoms.map((x) => {
                const max = Math.max(...summary.symptoms.map((y) => y.count));
                return (
                  <View key={x.name} style={styles.bar}>
                    <View style={styles.barLabel}>
                      <Text style={styles.barName}>{x.name}</Text>
                      <Text style={styles.barCount}>{x.count}×</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.round((x.count / max) * 100)}%` }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {summary.weight.length > 0 && options.sections.weight && (
            <View>
              <Text style={styles.docSec}>Weight trend · {summary.weight.length} entries</Text>
              {summary.weight.map((r, i) => (
                <Text key={`${r.dateISO}-${i}`} style={styles.docLine}>
                  {r.dateISO}: {r.value}{r.unit ? ` ${r.unit}` : ''}
                </Text>
              ))}
              <Text style={styles.docNote}>Recorded values only, no targets.</Text>
            </View>
          )}

          {summary.kicks.length > 0 && options.sections.kicks && (
            <View>
              <Text style={styles.docSec}>Kick sessions · {summary.kicks.length}</Text>
              {summary.kicks.map((k, i) => (
                <Text key={`${k.dateISO}-${i}`} style={styles.docLine}>
                  • {k.dateISO}
                  {k.movements !== null ? ` — ${k.movements} movements` : ''}
                  {k.durationMin !== null ? ` · ${k.durationMin} min` : ''}
                </Text>
              ))}
            </View>
          )}

          {summary.notes.length > 0 && options.sections.notes && (
            <View>
              <Text style={styles.docSec}>Notes · {summary.notes.length} entries</Text>
              {summary.notes.map((n, i) => (
                <Text key={`${n.dateISO}-${i}`} style={styles.docLine}>
                  • {n.dateISO}{n.fromPartner ? ' (partner)' : ''} — “{n.text}”
                </Text>
              ))}
            </View>
          )}

          {summary.questions.length > 0 && options.sections.questions && (
            <View>
              <Text style={styles.docSec}>Questions to ask</Text>
              {summary.questions.map((q, i) => (
                <View key={i} style={styles.qBox}>
                  <Text style={styles.docLine}>{q}</Text>
                </View>
              ))}
            </View>
          )}

          {summary.photos.length > 0 && (
            <View>
              <Text style={styles.docSec}>
                Photos · {summary.photos.length} (described, not attached)
              </Text>
              {summary.photos.map((p, i) => (
                <Text key={`${p.dateISO}-${i}`} style={styles.docLine}>
                  • {p.dateISO} — {p.name}
                </Text>
              ))}
              <Text style={styles.docNote}>Location data is removed when photos are shared.</Text>
            </View>
          )}
        </View>
      ) : (
        <Text style={styles.note}>Choose a valid range to preview your summary.</Text>
      )}

      <View style={styles.generateWrap}>
        <Button
          title={generating ? 'Generating…' : 'Generate summary'}
          onPress={handleGenerate}
          testID="generate-button"
        />
      </View>

      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  backChevron: { fontSize: 22, color: colors.coralDeep, marginRight: 2 },
  backLabel: { fontSize: 16, color: colors.coralDeep },
  title: { ...typeScale.display, color: colors.ink, marginBottom: spacing.xs },
  intro: { ...typeScale.body, color: colors.muted, lineHeight: 22, marginBottom: spacing.sm },
  introBold: { fontWeight: '700', color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.chip,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.blush, borderColor: colors.coral },
  chipText: { ...typeScale.body, color: colors.ink },
  chipTextOn: { fontWeight: '700', color: colors.coralDeep },
  note: { ...typeScale.footnote, color: colors.muted, marginBottom: spacing.md, lineHeight: 18 },
  error: { ...typeScale.footnote, color: colors.coralDeep, marginBottom: spacing.md },
  customRow: { marginBottom: spacing.md, gap: spacing.sm },
  customField: { gap: 4 },
  customLabel: { ...typeScale.footnote, color: colors.muted },
  customInput: {
    ...typeScale.body,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    color: colors.ink,
  },
  saveVisit: { paddingVertical: spacing.sm },
  saveVisitText: { ...typeScale.body, color: colors.coralDeep, fontWeight: '600' },
  rows: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: spacing.md,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.blush,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconMuted: { backgroundColor: colors.segmentedBg },
  rowGlyph: { fontSize: 18, color: colors.ink },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...typeScale.body, color: colors.ink, fontWeight: '600' },
  rowSub: { ...typeScale.footnote, color: colors.muted },
  addLink: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  addLinkText: { ...typeScale.body, color: colors.sageDeep, fontWeight: '600' },
  partnerList: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radii.card,
    padding: spacing.sm,
  },
  doc: {
    backgroundColor: colors.card,
    borderRadius: radii.docPreview,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  docTitle: { ...typeScale.title, color: colors.ink, marginBottom: 4 },
  docSub: { ...typeScale.footnote, color: colors.muted, lineHeight: 19, marginBottom: spacing.sm },
  docSec: {
    ...typeScale.footnote,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.sageDeep,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  docLine: { ...typeScale.body, color: colors.ink, lineHeight: 24 },
  docNote: { ...typeScale.footnote, color: colors.muted, marginTop: 4, lineHeight: 18 },
  bar: { marginBottom: spacing.sm },
  barLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barName: { ...typeScale.body, color: colors.ink },
  barCount: { ...typeScale.body, color: colors.muted },
  barTrack: { height: 8, backgroundColor: colors.segmentedBg, borderRadius: 999 },
  barFill: { height: '100%', backgroundColor: colors.coral, borderRadius: 999 },
  qBox: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  generateWrap: { marginBottom: spacing.xxl },
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 90,
    backgroundColor: colors.ink,
    borderRadius: radii.card,
    padding: spacing.md,
    alignItems: 'center',
  },
  toastText: { color: '#fff', ...typeScale.body, textAlign: 'center' },
});
