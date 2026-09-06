import { useRouter } from 'expo-router';

import { useFixture } from '../../../../../src/data/fixtures/useFixture';
import { OutcomeScreen } from '../../../../../src/features/confirmation/OutcomeScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <OutcomeScreen fixture={fixture} onBack={() => router.back()} />;
}
