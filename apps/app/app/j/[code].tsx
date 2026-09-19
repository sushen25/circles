import { useLocalSearchParams } from 'expo-router';

import { AvailabilityFlow } from '../../src/features/availability/AvailabilityFlow';
import { MembershipGate } from '../../src/features/identity/join/MembershipGate';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <AvailabilityFlow code={code} step="times" />
    </MembershipGate>
  );
}
