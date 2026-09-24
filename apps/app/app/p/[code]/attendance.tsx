import { useLocalSearchParams } from 'expo-router';

import { MorningAfterFlow } from '../../../src/features/confirmation/MorningAfterFlow';
import { MembershipGate } from '../../../src/features/identity/join/MembershipGate';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * The "were you there?" email's button, and circle home's card for a member.
 */
export default function Route() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <MorningAfterFlow target={{ code }} door="attendance" fixtureAs="member" />
    </MembershipGate>
  );
}
