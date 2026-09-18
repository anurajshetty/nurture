import { EmptyState, Screen } from '../../src/components';

/**
 * Home (Epic 0): warm empty state until the timeline + composer land in
 * later epics. Hints the composer is coming — does NOT build it (Epic 2).
 */
export default function HomeScreen() {
  return (
    <Screen bottomPadding={120}>
      <EmptyState
        glyph="✎"
        title="Your story starts here"
        copy="This is where your days will gather — notes, photos, and little moments. The composer is on its way, so saving them will be one tap."
      />
    </Screen>
  );
}
