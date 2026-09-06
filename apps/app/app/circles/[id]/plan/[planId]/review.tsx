import { useRouter } from 'expo-router';

import { useFixture } from '../../../../../src/data/fixtures/useFixture';
import { ConfirmReviewScreen } from '../../../../../src/features/confirmation/ConfirmReviewScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <ConfirmReviewScreen
      fixture={fixture}
      onNext={() => router.push('/circles/sunday-crew/plan/thu-17/confirmed')}
      onBack={() => router.back()}
    />
  );
}
