/**
 * Shared device-local timestamp formatting (Anuraj, Sept 2026).
 *
 * Every timestamp in the app renders in the viewer's current device
 * timezone — PST for her, EST for her partner — because these formatters
 * use the device-local Date getters / Intl defaults (no 'Z' suffix, no
 * explicit timeZone override). Absolute instants are stored as ISO strings;
 * formatting happens at render time, so a mid-session timezone change
 * re-renders correctly once the memoized call sites recompute (see
 * src/time/timezone.ts).
 *
 * Extracted from EventCard so unit tests assert the REAL production
 * formatting instead of mirroring it.
 */

/** Start of the device-local calendar day containing x. */
function startOfDay(x: Date): Date {
  const c = new Date(x);
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * "Today · 11:30 PM" / "Yesterday · 2:30 AM" / "Sep 21 · 11:30 PM" —
 * relative-day label plus device-local wall-clock time. Future dates
 * (dayDiff < 0) render their actual date, never "Today".
 */
export function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const dayMs = 86_400_000;
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / dayMs);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (dayDiff === 0) return `Today · ${time}`;
  if (dayDiff === 1) return `Yesterday · ${time}`;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} · ${time}`;
}

/**
 * Compact day label for card headers: "Today", "Yesterday", or "Sep 24" —
 * no time, so the header stays on one line.
 */
export function formatLocalDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const dayMs = 86_400_000;
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / dayMs);
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
