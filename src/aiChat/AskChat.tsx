import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii as radius, spacing, type } from '../theme/tokens';
import {
  AT_LIMIT_BODY,
  AT_LIMIT_RESET,
  atLimitTitle,
  CHAT_BACK_LABEL,
  CHAT_DISCLAIMER,
  CHAT_GREETING,
  CHAT_INPUT_PLACEHOLDER,
  CHAT_SEND_LABEL,
  CHAT_TITLE,
  CHAT_TYPING_LABEL,
  lastQuestionLine,
  quotaLine,
  SEND_FAILED,
  UNAVAILABLE,
} from './copy';
import {
  askWillow,
  AskWillowError,
  getChatQuota,
  type ChatQuota,
} from './client';
import { buildAskContext } from './context';
import {
  appendChatTurn,
  loadChatHistory,
  markFirstQuestionAsked,
  type ChatTurn,
} from './history';

type ChatStatus = 'ready' | 'sending' | 'at-limit' | 'unavailable';

/**
 * Ask Willow full-screen chat (Anuraj, Sept 20, 2026).
 *
 * - Full-screen takeover from Week; no tab bar (Modal presentation).
 * - Header: "‹ Week" + serif "Ask Willow"; the fixed disclaimer
 *   "This isn't medical advice." renders EXACTLY ONCE, directly under
 *   the header — never inside answer bubbles.
 * - Text-only English; no mic/voice/recording UI anywhere.
 * - Willow bubbles white/left; user bubbles blush/right; empty state
 *   greeting; no starter chips.
 * - Quota line is server-driven ("7 of 10 left today"); at the daily
 *   cap the input is replaced by the calm limit card.
 * - History is on-device only (KV); the server is stateless.
 */
export function AskChat({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [status, setStatus] = useState<ChatStatus>('ready');
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [quota, setQuota] = useState<ChatQuota | null>(null);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unavailableCopy, setUnavailableCopy] = useState<string>(UNAVAILABLE);

  const scrollToEnd = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Fresh open: load on-device history + today's server quota.
  useEffect(() => {
    if (!visible) return;
    setMessages(loadChatHistory());
    setInput('');
    setSendError('');
    setTyping(false);
    setStatus('ready');
    let cancelled = false;
    getChatQuota()
      .then((q) => {
        if (cancelled) return;
        setQuota(q);
        if (q.remaining <= 0) setStatus('at-limit');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof AskWillowError && e.code === 'not_configured') {
          setStatus('unavailable');
          setUnavailableCopy(UNAVAILABLE);
        }
        // Other quota failures (network): chat stays usable; the send
        // path surfaces its own error. The quota line hides until the
        // server answers. There is no sign-in gate (Anuraj, Sept 20,
        // 2026), so nothing here shows an "unavailable" state.
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const addTurn = useCallback((turn: Omit<ChatTurn, 'at'>) => {
    appendChatTurn(turn);
    setMessages((prev) => [...prev, { ...turn, at: new Date().toISOString() }]);
  }, []);

  const goAtLimit = useCallback(
    (dailyLimit: number) => {
      // dailyLimit is always server-provided here: the client never
      // invents the cap (Anuraj, Sept 20, 2026).
      setQuota({ remaining: 0, dailyLimit });
      addTurn({ role: 'willow', kind: 'sys', text: lastQuestionLine(dailyLimit) });
      setStatus('at-limit');
    },
    [addTurn],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || typing || status === 'at-limit' || status === 'unavailable') return;
    setInput('');
    setSendError(null);
    setTyping(true);
    // The question is actually sent now: consent never returns after
    // this point, even if the backend fails (Anuraj, Sept 20, 2026).
    markFirstQuestionAsked();
    // Build the context BEFORE appending the user's own turn: the
    // question travels as `question`; the context history must hold
    // only PRIOR turns.
    const context = buildAskContext();
    addTurn({ role: 'user', kind: 'user', text });
    try {
      const res = await askWillow(text, context);
      setTyping(false);
      setQuota({ remaining: res.remaining, dailyLimit: res.dailyLimit });
      addTurn({ role: 'willow', kind: res.kind, text: res.text });
      if (res.remaining <= 0) goAtLimit(res.dailyLimit);
      else setStatus('ready');
    } catch (e) {
      setTyping(false);
      if (e instanceof AskWillowError) {
        if (e.code === 'limit_reached') {
          // The cap comes from the server's limit response or from the
          // server-fetched quota at open. If neither exists, the
          // response is malformed — show a generic error rather than
          // inventing a number.
          const cap = e.dailyLimit ?? quota?.dailyLimit;
          if (cap != null) {
            goAtLimit(cap);
            return;
          }
        }
        if (e.code === 'not_configured') {
          setStatus('unavailable');
          setUnavailableCopy(UNAVAILABLE);
          return;
        }
      }
      setSendError(SEND_FAILED);
      setStatus('ready');
    }
  }, [input, typing, status, addTurn, goAtLimit, quota]);

  const showEmpty = messages.length === 0 && !typing;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            testID="ask-chat-back"
            accessibilityRole="button"
            accessibilityLabel="Back to Week"
            onPress={onClose}
            hitSlop={12}
            style={styles.backHit}
          >
            <Text style={styles.back}>{CHAT_BACK_LABEL}</Text>
          </Pressable>
          <Text style={styles.title}>{CHAT_TITLE}</Text>
          <View style={styles.backHit} />
        </View>
        {/* Fixed disclaimer — exactly once, directly under the header. */}
        <Text testID="ask-chat-disclaimer" style={styles.disclaimer}>
          {CHAT_DISCLAIMER}
        </Text>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          testID="ask-chat-messages"
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={scrollToEnd}
          keyboardShouldPersistTaps="handled"
        >
          {showEmpty && (
            <View testID="ask-chat-greeting" style={styles.bubbleWillow}>
              <Text style={styles.bubbleText}>{CHAT_GREETING}</Text>
            </View>
          )}
          {messages.map((m, i) =>
            m.kind === 'sys' ? (
              <Text key={`${m.at}-${i}`} testID="ask-chat-sysline" style={styles.sysline}>
                {m.text}
              </Text>
            ) : (
              <View
                key={`${m.at}-${i}`}
                testID={m.role === 'user' ? 'ask-chat-user' : 'ask-chat-willow'}
                style={m.role === 'user' ? styles.bubbleUser : styles.bubbleWillow}
              >
                <Text style={styles.bubbleText}>{m.text}</Text>
              </View>
            ),
          )}
          {typing && (
            <View testID="ask-chat-typing" style={styles.bubbleWillow}>
              <View style={styles.typingRow}>
                <ActivityIndicator size="small" color={colors.muted} />
                <Text style={styles.typingText}>{CHAT_TYPING_LABEL}</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Quota line — server-driven, hidden until the server answers. */}
        {quota && status !== 'at-limit' && status !== 'unavailable' && (
          <Text testID="ask-chat-quota" style={styles.quota}>
            {quotaLine(quota.remaining, quota.dailyLimit)}
          </Text>
        )}

        {/* Composer / at-limit / unavailable */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            {status === 'at-limit' && quota ? (
              <View testID="ask-chat-limit" style={styles.limitCard}>
                <Text style={styles.limitTitle}>{atLimitTitle(quota.dailyLimit)}</Text>
                <Text style={styles.limitBody}>{AT_LIMIT_BODY}</Text>
                <Text style={styles.limitReset}>{AT_LIMIT_RESET}</Text>
              </View>
            ) : status === 'unavailable' ? (
              <Text testID="ask-chat-unavailable" style={styles.unavailable}>
                {unavailableCopy}
              </Text>
            ) : (
              <View>
                {sendError && (
                  <Text testID="ask-chat-send-error" style={styles.sendError}>
                    {sendError}
                  </Text>
                )}
                <View style={styles.composer}>
                  <TextInput
                    testID="ask-chat-input"
                    style={styles.input}
                    value={input}
                    onChangeText={(t) => {
                      setInput(t);
                      if (sendError) setSendError(null);
                    }}
                    placeholder={CHAT_INPUT_PLACEHOLDER}
                    placeholderTextColor={colors.muted}
                    returnKeyType="send"
                    onSubmitEditing={send}
                    blurOnSubmit={false}
                    editable={!typing}
                    maxLength={2000}
                    accessibilityLabel="Ask Willow a question"
                  />
                  <Pressable
                    testID="ask-chat-send"
                    accessibilityRole="button"
                    accessibilityLabel={CHAT_SEND_LABEL}
                    onPress={send}
                    disabled={typing || input.trim().length === 0}
                    style={({ pressed }) => [
                      styles.send,
                      (typing || input.trim().length === 0) && styles.sendDisabled,
                      pressed && styles.sendPressed,
                    ]}
                  >
                    <Text style={styles.sendLabel}>{CHAT_SEND_LABEL}</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  backHit: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  back: { ...type.body, color: colors.coralDeep, fontWeight: '600' },
  title: { flex: 1, textAlign: 'center', ...type.title, color: colors.ink },
  disclaimer: {
    ...type.footnote,
    color: colors.muted,
    textAlign: 'center',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  messages: { flex: 1 },
  messagesContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm },
  bubbleWillow: {
    alignSelf: 'flex-start',
    maxWidth: '82%',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderTopLeftRadius: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
    backgroundColor: colors.blush,
    borderRadius: radius.card,
    borderTopRightRadius: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleText: { ...type.body, color: colors.ink },
  sysline: { ...type.footnote, color: colors.muted, textAlign: 'center', marginVertical: spacing.xs },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  typingText: { ...type.footnote, color: colors.muted },
  quota: { ...type.footnote, color: colors.muted, textAlign: 'center', paddingVertical: spacing.xs },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    ...type.body,
    color: colors.ink,
  },
  send: {
    minHeight: 48,
    minWidth: 72,
    paddingHorizontal: spacing.md,
    borderRadius: radius.chip,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.45 },
  sendPressed: { backgroundColor: colors.coralDeep },
  sendLabel: { ...type.body, fontWeight: '600', color: '#FFFFFF' },
  sendError: { ...type.footnote, color: colors.coralDeep, textAlign: 'center', marginBottom: spacing.xs },
  limitCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  limitTitle: { ...type.headline, color: colors.ink, textAlign: 'center' },
  limitBody: { ...type.body, color: colors.ink, textAlign: 'center' },
  limitReset: { ...type.footnote, color: colors.muted, textAlign: 'center' },
  unavailable: { ...type.body, color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg },
});
