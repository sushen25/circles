import { useLocalSearchParams } from 'expo-router';

import { ReentryFlow } from '../../src/features/identity/join/ReentryFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { token } = useLocalSearchParams<{ token?: string }>();

  return <ReentryFlow token={token} />;
}
