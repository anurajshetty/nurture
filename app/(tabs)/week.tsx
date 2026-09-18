import { EmptyState, Screen } from '../../src/components';

/** Week (Epic 0): warm empty state until the week view lands. */
export default function WeekScreen() {
  return (
    <Screen bottomPadding={120}>
      <EmptyState
        glyph="◍"
        title="Your week, unfolding"
        copy="Week by week, you'll find gentle size comparisons, highlights, and reading here — written for exactly where you are, never ahead of you."
      />
    </Screen>
  );
}
