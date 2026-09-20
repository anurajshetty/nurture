/**
 * Ask Willow — locked app copy (Anuraj, Sept 20, 2026).
 *
 * Verbatim-consent copy and the at-limit treatment are Anuraj-approved
 * mockup text: do not reword without his approval. Two copy decisions
 * were NOT in the mockups (flagged as Anuraj product decisions):
 *   - UNAVAILABLE: the quiet not-deployed state.
 *   - SEND_FAILED: the transient send-failure line.
 *   - UNAUTHENTICATED: the signed-out state.
 *
 * The daily cap is NEVER hardcoded here: every count comes from the
 * server (remaining + dailyLimit in each response).
 */

/** Consent sheet. */
export const CONSENT_TITLE = 'Before you ask';
export const CONSENT_LEDE = 'This chat answers your pregnancy questions using AI.';
export const CONSENT_BULLETS: readonly string[] = [
  'Your conversation stays on this phone — we don’t keep a copy of your chats.',
  'This is general information only, not medical advice. If something feels urgent or wrong, call your care team — don’t wait on an answer here.',
];
export const CONSENT_NOT_NOW = 'Not now';
export const CONSENT_UNDERSTAND = 'I understand';

/** Chat screen. */
export const CHAT_TITLE = 'Ask Willow';
export const CHAT_BACK_LABEL = '‹ Week';
/** Fixed disclaimer, rendered exactly once under the header — never
 *  inside model-answer bubbles (Anuraj, Sept 2026). */
export const CHAT_DISCLAIMER = "This isn't medical advice.";
export const CHAT_GREETING = 'Hi — ask me anything about your pregnancy or the weeks ahead.';
export const CHAT_INPUT_PLACEHOLDER = 'Ask about your pregnancy…';
export const CHAT_SEND_LABEL = 'Send';
export const CHAT_TYPING_LABEL = 'Willow is thinking…';

/** Quiet server-driven quota line, e.g. "7 of 10 left today". */
export function quotaLine(remaining: number, dailyLimit: number): string {
  return `${remaining} of ${dailyLimit} left today`;
}

/** At-limit treatment (mockup 20, Anuraj-approved). The number is the
 *  server's dailyLimit — displayed, never hardcoded. */
export function atLimitTitle(dailyLimit: number): string {
  return `That’s today’s ${dailyLimit}`;
}
export const AT_LIMIT_BODY =
  'I’ll be here tomorrow. Anything that can’t wait — your care team is the right call, not a chat window.';
export const AT_LIMIT_RESET = 'Back at midnight';

/** Inline system line appended when the answer that just arrived used up
 *  the last question of the day (mockup 20). */
export function lastQuestionLine(dailyLimit: number): string {
  return `That was today’s ${ordinal(dailyLimit)} — I’ll be here tomorrow.`;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Quiet not-deployed state — Anuraj product decision (not in mockups). */
export const UNAVAILABLE =
  'Ask Willow isn’t available yet. It’ll be ready once the chat service is switched on.';

/** Transient send failure — Anuraj product decision (not in mockups). */
export const SEND_FAILED = 'That didn’t go through — try again in a moment.';

/** Signed-out state — Anuraj product decision (not in mockups). */
export const UNAUTHENTICATED = 'Sign in to ask Willow.';
