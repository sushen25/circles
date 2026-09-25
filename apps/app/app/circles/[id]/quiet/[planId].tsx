import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../../src/features/identity/join/MembershipGate';
import { QuietPlanFlow } from '../../../../src/features/planning/QuietPlanFlow';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * A quiet ask, as its reader may see it. The static routes beside this one
 * (`waiting`, `interest`, …) are the gallery's artboards of each screen.
 */
export default function Route() {
  const { id, planId } = useLocalSearchParams<{ id: string; planId: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <QuietPlanFlow planId={planId} circleId={id} />
    </MembershipGate>
  );
}
