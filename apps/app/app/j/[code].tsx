import { useLocalSearchParams, useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { AvailabilityScreen } from '../../src/features/availability/AvailabilityScreen';
import { MembershipGate } from '../../src/features/identity/join/MembershipGate';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <AvailabilityScreen
        fixture={fixture}
        onNoneOfTheseDates={() => router.push('/j/[code]/none')}
        onBack={() => router.back()}
      />
    </MembershipGate>
  );
}
