import { Redirect } from 'expo-router';
import { useOnboarding } from '../src/onboarding/useOnboarding';

/**
 * Root landing route (Sept 2026): the old Home screen was the tab group's
 * index leaf, so `/` used to resolve to it. With Home removed the group has
 * no index leaf, and an unmatched `/` would show the "Unmatched Route"
 * screen on web. This redirect restores `/` as the front door: finished
 * onboarding → Week (the default landing tab); otherwise → onboarding.
 */
export default function Index() {
  const { loading, completed } = useOnboarding();
  if (loading) return null;
  return <Redirect href={completed ? '/week' : '/onboarding'} />;
}
