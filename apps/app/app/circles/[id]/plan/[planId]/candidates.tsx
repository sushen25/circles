import { useRouter } from 'expo-router';

import { useFixture } from '../../../../../src/data/fixtures/useFixture';
import { CandidatesScreen } from '../../../../../src/features/scheduling/CandidatesScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <CandidatesScreen
      fixture={fixture}
      onNext={() => router.push('/circles/sunday-crew/plan/thu-17/review')}
      onBack={() => router.back()}
    />
  );
}
