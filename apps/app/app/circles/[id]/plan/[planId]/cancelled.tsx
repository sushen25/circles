import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../../../src/features/identity/join/MembershipGate';
import { CancelledFlow } from '../../../../../src/features/planning/CancelledFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, planId } = useLocalSearchParams<{ id: string; planId: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <CancelledFlow id={id} planId={planId} />
    </MembershipGate>
  );
}
