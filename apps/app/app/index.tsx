import { useRouter } from 'expo-router';

import { useFixture } from '../src/data/fixtures/useFixture';
import { WelcomeScreen } from '../src/features/identity/WelcomeScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <WelcomeScreen
      fixture={fixture}
      onNext={() => router.push('/circles')}
      onContinueWithEmail={() => router.push('/(auth)/sign-in')}
      onBack={() => router.back()}
    />
  );
}
