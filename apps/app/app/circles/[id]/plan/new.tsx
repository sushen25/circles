import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../../src/features/identity/join/MembershipGate';
import { FirstPlanFlow } from '../../../../src/features/planning/FirstPlanFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <FirstPlanFlow id={id} />
    </MembershipGate>
  );
}
