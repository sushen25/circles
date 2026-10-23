import { useLocalSearchParams } from 'expo-router';

import { AnsweredGate } from '../../src/features/availability/AnsweredGate';
import { AvailabilityFlow } from '../../src/features/availability/AvailabilityFlow';
import { returnToOf } from '../../src/features/availability/useSendAnswer';
import { MembershipGate } from '../../src/features/identity/join/MembershipGate';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { code, returnTo, edit } = useLocalSearchParams<{
    code: string;
    returnTo?: string;
    edit?: string;
  }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <AnsweredGate code={code} edit={edit === '1' || returnTo !== undefined}>
        <AvailabilityFlow code={code} step="times" returnTo={returnToOf(returnTo)} />
      </AnsweredGate>
    </MembershipGate>
  );
}
