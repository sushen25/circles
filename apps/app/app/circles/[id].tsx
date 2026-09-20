import { useLocalSearchParams } from 'expo-router';

import { CircleHomeFlow } from '../../src/features/circles/CircleHomeFlow';
import { MembershipGate } from '../../src/features/identity/join/MembershipGate';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, state } = useLocalSearchParams<{ id: string; state?: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <CircleHomeFlow id={id} state={state} />
    </MembershipGate>
  );
}
