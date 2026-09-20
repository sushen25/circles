import { useLocalSearchParams } from 'expo-router';

import { InviteCircleFlow } from '../../../src/features/circles/InviteCircleFlow';
import { MembershipGate } from '../../../src/features/identity/join/MembershipGate';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <InviteCircleFlow id={id} />
    </MembershipGate>
  );
}
