import { useLocalSearchParams } from 'expo-router';

import { PlanLinkFlow } from '../../src/features/availability/PlanLinkFlow';
import { MembershipGate } from '../../src/features/identity/join/MembershipGate';
import { MemberCandidatesFlow } from '../../src/features/scheduling/MemberCandidatesFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <PlanLinkFlow code={code}>
        <MemberCandidatesFlow code={code} />
      </PlanLinkFlow>
    </MembershipGate>
  );
}
