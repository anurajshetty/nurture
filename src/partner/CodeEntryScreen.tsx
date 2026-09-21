/**
 * Partner sharing — invite code entry (mockup 33, screen ②).
 *
 * Auto-caps 6-char input; Verify is quiet until 6 chars, then coral.
 * Verify → "Checking…" → valid jumps to connected, invalid shows the
 * warm error. Only two outcomes exist — valid or invalid.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../components';
import { colors, minTouch, radii, spacing, type as typeScale } from '../theme/tokens';
import { isValidCodeFormat, normalizeCode, redeemInviteCode } from './inviteCodes';

const INVALID_COPY = "That code didn't work — check it and try again.";
const INVALID_SUB = 'Codes are 6 characters. If it keeps failing, ask for a fresh one.';
const NOT_READY_COPY = "Partner sharing isn't ready on this phone yet — try again in a bit.";

export default function CodeEntryScreen({
  onBack,
  onVerified,
}: {
  onBack: () => void;
  onVerified: () => void;
}) {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSub, setErrorSub] = useState<string | null>(null);

  const ready = isValidCodeFormat(code);

  const verify = async () => {
    if (!ready || checking) return;
    setChecking(true);
    setError(null);
    setErrorSub(null);
    const result = await redeemInviteCode(code);
    setChecking(false);
    if (result.status === 'ok') {
      onVerified();
      return;
    }
    if (result.status === 'invalid_code') {
      setError(INVALID_COPY);
      setErrorSub(INVALID_SUB);
      return;
    }
    if (result.status === 'not_ready' || result.status === 'not_configured') {
      setError(NOT_READY_COPY);
      setErrorSub(null);
      return;
    }
    setError(INVALID_COPY);
    setErrorSub('Something hiccupped on our side — one more try?');
  };

  return (
    <View style={styles.wrap} testID="code-entry">
      <View style={styles.backrow}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="code-entry-back"
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.backTitle}>Enter your invite code</Text>
      </View>

      <Text style={styles.note}>
        You'll find it in your partner's Willow, under <Text style={styles.bold}>You → Share with your partner</Text>.
      </Text>

      <Text style={styles.fieldLabel}>Invite code</Text>
      <TextInput
        value={code}
        onChangeText={(t) => {
          setCode(normalizeCode(t));
          setError(null);
          setErrorSub(null);
        }}
        placeholder="••••••"
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        maxLength={6}
        style={[styles.codein, error ? styles.codeinInvalid : null]}
        accessibilityLabel="Invite code"
        testID="code-entry-input"
      />
      {error ? (
        <View accessibilityRole="alert" testID="code-entry-error">
          <Text style={styles.err}>{error}</Text>
          {errorSub ? <Text style={styles.errSub}>{errorSub}</Text> : null}
        </View>
      ) : null}

      <View style={styles.spacer} />
      <Button
        title={checking ? 'Checking…' : 'Verify'}
        onPress={verify}
        disabled={!ready || checking}
        loading={checking}
        testID="code-entry-verify"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backrow: { flexDirection: 'row', alignItems: 'center', minHeight: minTouch },
  back: {
    width: minTouch,
    height: minTouch,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backGlyph: { fontSize: 30, color: colors.ink, lineHeight: 32 },
  backTitle: { ...typeScale.headline, color: colors.ink, fontWeight: '700' },
  note: { ...typeScale.body, color: colors.muted, marginTop: spacing.sm, lineHeight: 22 },
  bold: { fontWeight: '700', color: colors.ink },
  fieldLabel: {
    ...typeScale.subhead,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
  },
  codein: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    height: 76,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
    color: colors.ink,
  },
  codeinInvalid: { borderColor: colors.coralDeep, backgroundColor: '#FDF4EF' },
  err: { ...typeScale.body, color: colors.coralDeep, fontWeight: '600', marginTop: spacing.md, lineHeight: 21 },
  errSub: { ...typeScale.subhead, color: colors.muted, marginTop: 4, lineHeight: 19 },
  spacer: { flex: 1, minHeight: spacing.lg },
});
