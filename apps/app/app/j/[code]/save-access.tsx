import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { SaveAccessScreen } from '../../../src/features/identity/SaveAccessScreen';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * Was `/a/[token]`, which the scaffold guessed at and which is the re-entry
 * link every plan-update email carries (architecture §5.2). SaveAccess follows
 * the Sent screen (§5.1: "a tertiary Save access on every device link follows
 * the email card"), so it lives beside it. S1-30 wires it.
 */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <SaveAccessScreen fixture={fixture} onBack={() => router.back()} />;
}
