import { useLocalSearchParams } from 'expo-router';

import { CheckEmailFlow } from '../../../src/features/communication/CheckEmailFlow';
import { MembershipGate } from '../../../src/features/identity/join/MembershipGate';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <CheckEmailFlow code={code} />
    </MembershipGate>
  );
}
