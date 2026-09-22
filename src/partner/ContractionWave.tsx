/**
 * Warm contraction wave (mockup 34, Anuraj approved Sept 2026): a gentle
 * periwinkle wave — one even bump per contraction, never red/amber/green —
 * with a single calm summary line beneath. Rendered inside the partner
 * home's shared feed cards for contraction-timing entries (EventCard
 * partnerMode), in place of the feed's plain text lines.
 */

import { StyleSheet, Text, View } from 'react-native';
import { Path, Svg, Text as SvgText } from 'react-native-svg';
import { colors, spacing, type as typeScale } from '../theme/tokens';
import { contractionSummaryLine, contractionWave } from './partnerHome';

/** Periwinkle from the approved mockup — the wave is never red/amber/green. */
const WAVE = '#5E8FA8';
const WAVE_FILL = 'rgba(94,143,168,0.16)';

export default function ContractionWave({
  count,
  spanSec,
  avgIntervalSec,
  occurredAt,
}: {
  count: number;
  spanSec: number;
  avgIntervalSec: number | null;
  occurredAt: string;
}) {
  const layout = contractionWave(count, spanSec, occurredAt);
  if (!layout) return null;
  const W = 312;
  const H = 112;
  const pad = 16;
  const base = 76;
  const n = layout.bumps.length;
  const segW = (W - 2 * pad) / n;
  let tops = '';
  for (let i = 0; i < n; i++) {
    const x0 = pad + i * segW;
    const cx = x0 + segW / 2;
    // Gentle, even bumps — one per contraction; the count IS the shape.
    const h = 34;
    const y = Math.round(base - h);
    tops +=
      (i === 0 ? `M ${x0},${base} ` : '') +
      `C ${Math.round(x0 + segW * 0.22)},${base} ${Math.round(x0 + segW * 0.22)},${y} ${Math.round(cx)},${y} ` +
      `C ${Math.round(x0 + segW * 0.78)},${y} ${Math.round(x0 + segW * 0.78)},${base} ${Math.round(x0 + segW)},${base} `;
  }
  const area = `${tops}L ${W - pad},${H} L ${pad},${H} Z`;
  return (
    <View style={styles.waveWrap} testID="partner-wave">
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} accessibilityLabel="Gentle wave of this contraction-timing session">
        <Path d={area} fill={WAVE_FILL} />
        <Path d={tops} fill="none" stroke={WAVE} strokeWidth={2.5} strokeLinecap="round" />
        <SvgText x={pad} y={H - 8} textAnchor="start" fontSize={10.5} fill={colors.muted}>
          {layout.startLabel}
        </SvgText>
        <SvgText x={W - pad} y={H - 8} textAnchor="end" fontSize={10.5} fill={colors.muted}>
          {layout.endLabel}
        </SvgText>
      </Svg>
      <Text style={styles.waveSummary}>{contractionSummaryLine(count, avgIntervalSec)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  waveWrap: { marginTop: spacing.sm },
  waveSummary: { ...typeScale.body, color: colors.ink, marginTop: spacing.sm, textAlign: 'center' },
});
