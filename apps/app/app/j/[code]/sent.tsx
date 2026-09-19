import { useLocalSearchParams } from 'expo-router';

import { SentFlow } from '../../../src/features/availability/SentFlow';
import { MembershipGate } from '../../../src/features/identity/join/MembershipGate';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <SentFlow code={code} />
    </MembershipGate>
  );
}
