import { useRouter } from 'expo-router';

import { useFixture } from '../../../../../src/data/fixtures/useFixture';
import { ChangeTimeScreen } from '../../../../../src/features/confirmation/ChangeTimeScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <ChangeTimeScreen fixture={fixture} onBack={() => router.back()} />;
}
