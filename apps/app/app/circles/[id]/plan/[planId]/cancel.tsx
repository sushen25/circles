import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../../../src/features/identity/join/MembershipGate';
import { CancelPlanFlow } from '../../../../../src/features/planning/CancelPlanFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, planId } = useLocalSearchParams<{ id: string; planId: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <CancelPlanFlow id={id} planId={planId} />
    </MembershipGate>
  );
}
