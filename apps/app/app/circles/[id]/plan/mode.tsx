import { useLocalSearchParams } from 'expo-router';

import { MembershipGate } from '../../../../src/features/identity/join/MembershipGate';
import { ChooseModeFlow } from '../../../../src/features/planning/ChooseModeFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <ChooseModeFlow id={id} />
    </MembershipGate>
  );
}
