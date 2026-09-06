import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { CandidatesMemberScreen } from '../../src/features/scheduling/CandidatesMemberScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <CandidatesMemberScreen fixture={fixture} onBack={() => router.back()} />;
}
