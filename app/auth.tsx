import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuth } from '../src/auth/AuthContext';
import { Button, Screen } from '../src/components';
import { colors, radii, spacing, type as typeScale } from '../src/theme/tokens';

/**
 * Warm sign-in. Apple Sign-In (native button) when the device supports it,
 * otherwise email magic link. When Supabase isn't configured yet, a gentle
 * note says so — entries stay on the device in the meantime.
 */
export default function AuthScreen() {
  const { session, loading, signInWithApple, signInWithEmail, isConfigured } = useAuth();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  useEffect(() => {
    // Group paths ('/(tabs)') don't resolve in the static web export —
    // redirect to the Week tab leaf instead (Week job finding, Sept 2026).
    if (!loading && session) router.replace('/week');
  }, [loading, session]);

  const handleApple = async () => {
    setError(null);
    try {
      await signInWithApple();
    } catch {
      // The native sheet handles cancellation quietly; only surface real failures.
      setError('Apple sign-in didn’t go through. Try again, or use email below.');
    }
  };

  const handleEmail = async () => {
    const trimmed = email.trim();
    if (!trimmed || sending) return;
    setError(null);
    setSending(true);
    try {
      await signInWithEmail(trimmed);
      setSent(true);
    } catch {
      setError('That email didn’t send. Check the address and try again.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.coral} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={styles.body}>
        <View style={styles.hero}>
          <View style={styles.medallion} accessibilityElementsHidden>
            <Text style={styles.medallionGlyph}>♥</Text>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Welcome to Willow
          </Text>
          <Text style={styles.sub}>
            A quiet place for your pregnancy — your notes, photos, and milestones,
            kept just for you.
          </Text>
        </View>

        {!isConfigured ? (
          <View style={styles.syncNote} accessibilityRole="summary">
            <Text style={styles.syncGlyph} accessibilityElementsHidden>
              ⓘ
            </Text>
            <Text style={styles.syncText}>
              Sync isn’t set up yet — everything you save stays on this device for now.
            </Text>
          </View>
        ) : null}

        {appleAvailable ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={radii.button}
            style={styles.appleButton}
            onPress={handleApple}
          />
        ) : null}

        {appleAvailable ? (
          <View style={styles.divider} accessibilityElementsHidden>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>
        ) : null}

        {sent ? (
          <View style={styles.sentCard}>
            <Text style={styles.sentTitle}>Check your email</Text>
            <Text style={styles.sentText}>
              We sent a sign-in link to {email.trim()}. It’s good for a little while —
              tap it on this device.
            </Text>
            <Pressable
              onPress={() => {
                setSent(false);
                setEmail('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Use a different email"
              style={styles.changeEmail}
            >
              <Text style={styles.changeEmailText}>Use a different email</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={handleEmail}
              editable={!sending}
              style={styles.input}
              accessibilityLabel="Email address"
            />
            <Button
              title="Send sign-in link"
              onPress={handleEmail}
              loading={sending}
              disabled={sending || email.trim().length === 0}
              style={styles.sendButton}
              testID="send-magic-link"
            />
          </View>
        )}

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <View style={styles.spacer} />

        <Text style={styles.fine}>
          No password to remember. Your journal stays private — only you can read it.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  medallion: {
    width: 76,
    height: 76,
    borderRadius: radii.chip,
    backgroundColor: colors.blush,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  medallionGlyph: {
    fontSize: 34,
    color: colors.coralDeep,
    lineHeight: 40,
  },
  title: {
    ...typeScale.display,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  sub: {
    ...typeScale.body,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 300,
  },
  syncNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.sageTint,
    borderRadius: radii.card,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  syncGlyph: {
    fontSize: 16,
    color: colors.sageDeep,
    lineHeight: 20,
  },
  syncText: {
    ...typeScale.subhead,
    color: colors.sageDeep,
    flex: 1,
  },
  appleButton: {
    width: '100%',
    height: 56,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  dividerText: {
    ...typeScale.subhead,
    color: colors.muted,
  },
  fieldLabel: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: 56,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.ink,
  },
  sendButton: {
    marginTop: spacing.md,
  },
  sentCard: {
    backgroundColor: colors.sageTint,
    borderRadius: radii.card,
    padding: spacing.lg,
  },
  sentTitle: {
    ...typeScale.headline,
    color: colors.sageDeep,
    marginBottom: spacing.xs,
  },
  sentText: {
    ...typeScale.body,
    color: colors.ink,
  },
  changeEmail: {
    minHeight: 48,
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  changeEmailText: {
    ...typeScale.subhead,
    fontWeight: '600',
    color: colors.coralDeep,
  },
  error: {
    ...typeScale.subhead,
    color: colors.coralDeep,
    fontWeight: '600',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  fine: {
    ...typeScale.footnote,
    color: colors.muted,
    textAlign: 'center',
    paddingTop: spacing.xl,
  },
  spacer: {
    flex: 1,
    minHeight: spacing.xl,
  },
});
