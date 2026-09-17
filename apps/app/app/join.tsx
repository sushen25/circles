import { useRouter } from 'expo-router';

import { hasBackend } from '../src/data/auth/client';
import { useFixture } from '../src/data/fixtures/useFixture';
import { MainScreen } from '../src/features/identity/MainScreen';
import { JoinFlow } from '../src/features/identity/join/JoinFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  return hasBackend() ? <JoinFlow /> : <FixtureRoute />;
}

/** The gallery and the smoke export, which have no backend to join. */
function FixtureRoute() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <MainScreen
      fixture={fixture}
      onNext={() => router.push('/join/name')}
      onWhatIsBrand={() => router.push('/get-the-app')}
      onBack={() => router.back()}
    />
  );
}
