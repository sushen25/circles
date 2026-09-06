import { useRouter } from 'expo-router';

import { useFixture } from '../../../../src/data/fixtures/useFixture';
import { VolunteerScreen } from '../../../../src/features/planning/VolunteerScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <VolunteerScreen fixture={fixture} onBack={() => router.back()} />;
}
