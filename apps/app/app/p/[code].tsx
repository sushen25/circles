import { useLocalSearchParams } from 'expo-router';

import { PlanLinkFlow } from '../../src/features/availability/PlanLinkFlow';
import { MembershipGate } from '../../src/features/identity/join/MembershipGate';
import { PlanChangeGate } from '../../src/features/planning/MemberChangeFlow';
import { QuietLinkGate } from '../../src/features/planning/QuietLinkGate';
import { MemberCandidatesFlow } from '../../src/features/scheduling/MemberCandidatesFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <QuietLinkGate code={code}>
        <PlanChangeGate code={code}>
          <PlanLinkFlow code={code}>
            <MemberCandidatesFlow code={code} />
          </PlanLinkFlow>
        </PlanChangeGate>
      </QuietLinkGate>
    </MembershipGate>
  );
}
