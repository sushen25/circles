import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { InterestPromptScreen } from '../../../../src/features/planning/InterestPromptScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <InterestPromptScreen fixture={fixture} onBack={() => router.back()} />;
}
