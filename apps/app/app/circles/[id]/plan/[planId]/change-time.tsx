import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../../../src/features/identity/join/MembershipGate';
import { ChangeTimeFlow } from '../../../../../src/features/planning/ChangeTimeFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, planId } = useLocalSearchParams<{ id: string; planId: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <ChangeTimeFlow id={id} planId={planId} />
    </MembershipGate>
  );
}
