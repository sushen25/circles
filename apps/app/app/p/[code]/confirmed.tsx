import { useLocalSearchParams } from 'expo-router';

import { ConfirmedFlow } from '../../../src/features/confirmation/ConfirmedFlow';
import { MembershipGate } from '../../../src/features/identity/join/MembershipGate';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <ConfirmedFlow target={{ code }} fixtureAs="member" />
    </MembershipGate>
  );
}
