import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../src/features/identity/join/MembershipGate';
import { RescheduledFlow } from '../../../src/features/planning/MemberChangeFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <RescheduledFlow code={code} />
    </MembershipGate>
  );
}
