import { useLocalSearchParams } from 'expo-router';

import { SignInFlow } from '../../src/features/identity/SignInFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { next } = useLocalSearchParams<{ next?: string | string[] }>();

  return <SignInFlow returnTo={next} />;
}
