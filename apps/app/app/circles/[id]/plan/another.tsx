import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../../src/features/identity/join/MembershipGate';
import { PlanAnotherFlow } from '../../../../src/features/planning/PlanAnotherFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <PlanAnotherFlow id={id} />
    </MembershipGate>
  );
}
