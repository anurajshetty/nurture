/**
 * Kick session feed card (Willow, mockup 23 — Anuraj approved Sept 20, 2026).
 *
 * Rendered inside the timeline EventCard for `kick_session` events: the
 * session line, the optional strength note, and — only when the session
 * deviates from her usual pattern — the gentle flag, calm care guidance,
 * and the "Save to my next appointment" link. The link attaches the
 * session ONLY to the immediate next future appointment (max 5 per
 * appointment), then confirms for ~2s and disappears.
 *
 * Locked copy:
 * - Flag: "This one felt different from your usual — worth mentioning at
 *   your visit."
 * - Care: "If movements feel less than usual, call your care team — don't
 *   wait on it."
 * Never "abnormal", never "failed", never "baby is fine".
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import type { LocalEvent } from '../lib/types';
import { listEvents } from '../sync/store';
import {
  attachConfirmation,
  attachKick,
  nextFutureAppointment,
  readAttachedKicks,
  saveLinkVisible,
  MAX_KICKS_PER_APPOINTMENT,
} from './appointments';
import { recentKickSessions, deviationReason } from './pattern';
import {
  formatKickDate,
  formatMovementsLine,
  formatStrengthNote,
  readKickSession,
  type KickSession,
} from './session';
import { listKickSessions, saveAttachedKicks } from './store';

/** Exact flag line (Anuraj-approved). */
export const KICK_FLAG_LINE =
  'This one felt different from your usual — worth mentioning at your visit.';

/** Calm care guidance on flagged sessions. */
export const KICK_FEED_CARE_LINE =
  'If movements feel less than usual, call your care team — don’t wait on it.';

export default function KickFeedSection({ event }: { event: LocalEvent }) {
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [linkHidden, setLinkHidden] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const session: KickSession | null = readKickSession(event);

  // Deviation is computed once, against her sessions before this one.
  // All store reads are wrapped: a feed card must never crash the list.
  let reason: 'longer' | 'weaker' | null = null;
  let nextAppt: LocalEvent | null = null;
  let showLink = false;
  if (session && !linkHidden && !confirmed) {
    try {
      const prior = recentKickSessions(
        listKickSessions(),
        session.id,
        undefined,
        session.occurredAt,
      );
      reason = deviationReason(session, prior);
      if (reason !== null) {
        const events = listEvents(500);
        const nowMs = Date.now();
        if (saveLinkVisible({ session, prior, events, nowMs })) {
          showLink = true;
          nextAppt = nextFutureAppointment(events, nowMs);
        }
      }
    } catch {
      reason = null;
      showLink = false;
    }
  } else if (session) {
    // Link hidden/confirmed — the flag still shows on deviating sessions.
    try {
      reason = deviationReason(
        session,
        recentKickSessions(
          listKickSessions(),
          session.id,
          undefined,
          session.occurredAt,
        ),
      );
    } catch {
      reason = null;
    }
  }

  if (!session) return null;

  const strengthNote = formatStrengthNote(session.strength);

  const handleSave = () => {
    if (!nextAppt) return;
    const current = readAttachedKicks(nextAppt.data);
    if (current.length >= MAX_KICKS_PER_APPOINTMENT) return;
    const updated = attachKick(current, session);
    if (updated.length === current.length) return; // already attached
    if (!saveAttachedKicks(nextAppt.id, updated)) return;
    const label = attachConfirmation(
      nextAppt,
      formatKickDate(nextAppt.occurredAt),
    );
    setConfirmed(label);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setConfirmed(null);
      // The link disappears after the confirmation.
      setLinkHidden(true);
    }, 2000);
  };

  return (
    <View testID={`kick-feed-${event.id}`}>
      <Text style={styles.main}>{formatMovementsLine(session)}</Text>
      {strengthNote ? <Text style={styles.sub}>{strengthNote}</Text> : null}
      {reason !== null ? (
        <View>
          <Text style={styles.flag}>{KICK_FLAG_LINE}</Text>
          <Text style={styles.care}>{KICK_FEED_CARE_LINE}</Text>
        </View>
      ) : null}
      {confirmed ? (
        <Text style={styles.confirm} testID={`kick-confirm-${event.id}`}>
          {confirmed}
        </Text>
      ) : showLink ? (
        <Pressable
          testID={`kick-save-appt-${event.id}`}
          accessibilityRole="button"
          accessibilityLabel="Save to my next appointment"
          onPress={handleSave}
          style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
        >
          <Text style={styles.linkText}>Save to my next appointment</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  main: {
    fontSize: 15.5,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 23,
    marginTop: spacing.xs,
  },
  sub: {
    fontSize: 13.5,
    color: colors.muted,
    marginTop: 2,
  },
  flag: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#6B5F52',
    marginTop: spacing.sm,
  },
  care: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  linkBtn: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.coralDeep,
  },
  confirm: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.sageDeep,
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  pressed: {
    opacity: 0.7,
  },
});
