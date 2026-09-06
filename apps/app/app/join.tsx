import { useRouter } from 'expo-router';

import { useFixture } from '../src/data/fixtures/useFixture';
import { MainScreen } from '../src/features/identity/MainScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <MainScreen
      fixture={fixture}
      onWhatIsBrand={() => router.push('/app')}
      onBack={() => router.back()}
    />
  );
}
