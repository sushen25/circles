import { useRouter } from 'expo-router';

import { useFixture } from '../../../../../src/data/fixtures/useFixture';
import { ConfirmedOrgScreen } from '../../../../../src/features/confirmation/ConfirmedOrgScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <ConfirmedOrgScreen
      fixture={fixture}
      onNext={() => router.push('/circles/sunday-crew/plan/thu-17/outcome')}
      onBack={() => router.back()}
    />
  );
}
