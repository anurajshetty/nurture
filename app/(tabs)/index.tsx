/**
 * Home — the morning briefing (track "new Home").
 *
 * Renders the BriefingScreen built by the briefing-UI track. No composer
 * here: logging lives on the Logs tab. This route is the tab group's
 * initial route, so it's the default landing screen after boot/onboarding.
 */

import Screen from '../../src/components/Screen';
import { BriefingScreen } from '../../src/briefing/BriefingScreen';

export default function HomeScreen() {
  return (
    <Screen testID="home-screen">
      <BriefingScreen />
    </Screen>
  );
}
