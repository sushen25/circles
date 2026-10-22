import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../../../src/features/identity/join/MembershipGate';
import { PlanSharedFlow } from '../../../../../src/features/planning/PlanSharedFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, planId, again, first, tagged } = useLocalSearchParams<{
    id: string;
    planId: string;
    again?: string;
    first?: string;
    tagged?: string;
  }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <PlanSharedFlow
        id={id}
        planId={planId}
        again={again === '1'}
        first={
          first === 'answered' || first === 'later'
            ? { answer: first, tagged: tagged === '1' }
            : undefined
        }
      />
    </MembershipGate>
  );
}
