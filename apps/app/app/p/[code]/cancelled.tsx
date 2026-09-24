import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../src/features/identity/join/MembershipGate';
import { MemberCancelledFlow } from '../../../src/features/planning/MemberChangeFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <MemberCancelledFlow code={code} />
    </MembershipGate>
  );
}
