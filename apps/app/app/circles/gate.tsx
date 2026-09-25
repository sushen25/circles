import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { InitiateGateScreen } from '../../src/features/growth/InitiateGateScreen';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * The gallery's view of the organiser gate. The real gate is drawn in place
 * of what it guards (`InitiateGateFlow`), never navigated to, so this route is
 * the artboard and nothing else.
 */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <InitiateGateScreen
      fixture={fixture}
      circleName={fixture.circle.name}
      name={fixture.name}
      onBack={() => router.back()}
      onNotNow={() => router.back()}
    />
  );
}
