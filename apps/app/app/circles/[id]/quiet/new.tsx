import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../../src/features/identity/join/MembershipGate';
import { QuietSetupFlow } from '../../../../src/features/planning/QuietSetupFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <QuietSetupFlow id={id} />
    </MembershipGate>
  );
}
