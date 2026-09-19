import { useLocalSearchParams } from 'expo-router';

import { SaveAccessFlow } from '../../../src/features/identity/SaveAccessFlow';
import { MembershipGate } from '../../../src/features/identity/join/MembershipGate';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * Beside the Sent screen it follows (§5.1: "a tertiary Save access on every
 * device link follows the email card"). `/a` is the emailed re-entry link.
 */
export default function Route() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <SaveAccessFlow code={code} />
    </MembershipGate>
  );
}
