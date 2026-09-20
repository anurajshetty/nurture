/**
 * Ask Willow on-device state (Anuraj, Sept 20, 2026).
 *
 * - Conversation history lives HERE and nowhere else: the local KV
 *   store, which never syncs. The server is stateless and stores no
 *   chats; Q&A stays out of the feed.
 * - `firstAsked` is the "first question asked" flag: the consent sheet
 *   shows on EVERY ask tap until the first question is actually sent;
 *   after that, ask opens the chat directly — forever.
 *
 * Both are best-effort: a storage failure yields empty history / no
 * flag, never a crash.
 */

import { kvGet, kvSet, kvDelete } from '../lib/db';

export interface ChatTurn {
  role: 'user' | 'willow';
  /** 'answer' | 'refusal' | 'handoff' | 'crisis' | 'sys' */
  kind: string;
  text: string;
  at: string; // ISO
}

const HISTORY_KEY = 'aiChat.history.v1';
const FIRST_ASKED_KEY = 'aiChat.firstAsked.v1';
const MAX_TURNS = 50;

function readTurns(): ChatTurn[] {
  try {
    const raw = kvGet(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is ChatTurn =>
        typeof t === 'object' &&
        t !== null &&
        (t.role === 'user' || t.role === 'willow') &&
        typeof t.text === 'string' &&
        typeof t.at === 'string',
    );
  } catch {
    return [];
  }
}

export function loadChatHistory(): ChatTurn[] {
  return readTurns();
}

/** The ≤6 most recent turns, for the server context (server is stateless).
 *  System lines (quota notes) are presentation-only and never sent. */
export function recentTurnsForContext(): Array<{ role: 'user' | 'willow'; text: string }> {
  return readTurns()
    .filter((t) => t.kind !== 'sys')
    .slice(-6)
    .map((t) => ({ role: t.role, text: t.text }));
}

export function appendChatTurn(turn: Omit<ChatTurn, 'at'>): void {
  try {
    const turns = [...readTurns(), { ...turn, at: new Date().toISOString() }];
    kvSet(HISTORY_KEY, JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch {
    /* best-effort */
  }
}

/** True once the first question has actually been sent. */
export function hasAskedFirstQuestion(): boolean {
  try {
    return kvGet(FIRST_ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markFirstQuestionAsked(): void {
  try {
    kvSet(FIRST_ASKED_KEY, '1');
  } catch {
    /* best-effort */
  }
}

/** Test-only reset (wired through ?testhooks=1 in src/testhooks.ts). */
export function clearAiChatState(): void {
  try {
    kvDelete(HISTORY_KEY);
    kvDelete(FIRST_ASKED_KEY);
  } catch {
    /* best-effort */
  }
}
