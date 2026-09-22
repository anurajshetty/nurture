/**
 * Partner sharing — invite code entry (mockup 33 rev C).
 *
 * Two required fields: NAME + CODE. Every code is a named invite, and
 * redemption binds the name to the code (case-insensitive): a wrong name
 * is invalid, exactly like a wrong code. Verify stays quiet until both
 * are valid, then coral. Only two outcomes exist — valid or invalid —
 * so both wrong-name and wrong-code show the same warm error copy.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../components';
import { colors, minTouch, radii, spacing, type as typeScale } from '../theme/tokens';
import { kvGet, kvSet } from '../lib/db';
import {
  isValidCodeFormat,
  isValidName,
  normalizeCode,
  normalizeName,
  redeemInvite,
} from './inviteCodes';
import { setPartnerNames } from './partnerHome';

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
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSub, setErrorSub] = useState<string | null>(null);

  const ready = isValidName(name) && isValidCodeFormat(code);

  const verify = async () => {
    if (!ready || checking) return;
    setChecking(true);
    setError(null);
    setErrorSub(null);
    const result = await redeemInvite(code, name);
    setChecking(false);
    if (result.status === 'ok') {
      // Persist both names (mockup 34): her name titles the partner home
      // ("{her name}'s journey") and his name labels his own heart.
      setPartnerNames({ get: kvGet, set: kvSet }, name, result.ownerName);
      onVerified();
      return;
    }
    if (result.status === 'invalid_code') {
      // Wrong name or wrong code — same warm copy, always.
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
        <Text style={styles.backTitle}>Enter your invite</Text>
      </View>

      <Text style={styles.note}>
        Your partner invited you by name. Enter the <Text style={styles.bold}>name</Text> and the{' '}
        <Text style={styles.bold}>6-character code</Text> they shared with you.
      </Text>

      <Text style={styles.fieldLabel}>Your name</Text>
      <TextInput
        value={name}
        onChangeText={(t) => {
          setName(t);
          setError(null);
          setErrorSub(null);
        }}
        placeholder="The name on your invite"
        placeholderTextColor={colors.muted}
        autoCapitalize="words"
        autoCorrect={false}
        style={[styles.input, error ? styles.inputInvalid : null]}
        accessibilityLabel="Your name"
        testID="code-entry-name"
      />

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
        style={[styles.codein, error ? styles.inputInvalid : null]}
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
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    height: 60,
    fontSize: 18,
    color: colors.ink,
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
  inputInvalid: { borderColor: colors.coralDeep, backgroundColor: '#FDF4EF' },
  err: { ...typeScale.body, color: colors.coralDeep, fontWeight: '600', marginTop: spacing.md, lineHeight: 21 },
  errSub: { ...typeScale.subhead, color: colors.muted, marginTop: 4, lineHeight: 19 },
  spacer: { flex: 1, minHeight: spacing.lg },
});
