import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../../../src/features/identity/join/MembershipGate';
import { PlanSharedFlow } from '../../../../../src/features/planning/PlanSharedFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, planId } = useLocalSearchParams<{ id: string; planId: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <PlanSharedFlow id={id} planId={planId} />
    </MembershipGate>
  );
}
