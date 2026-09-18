import { EmptyState, Screen } from '../../src/components';

/** Plan (Epic 0): warm empty state until structured logging lands. */
export default function PlanScreen() {
  return (
    <Screen bottomPadding={120}>
      <EmptyState
        glyph="▤"
        title="A calmer kind of plan"
        copy="Symptoms, weight, kicks, appointments, milestones, and questions for your provider — when structured logging arrives, it'll live here, one small step at a time."
      />
    </Screen>
  );
}
