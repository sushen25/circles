import { useLocalSearchParams, useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { PlanLinkFlow } from '../../src/features/availability/PlanLinkFlow';
import { MembershipGate } from '../../src/features/identity/join/MembershipGate';
import { CandidatesMemberScreen } from '../../src/features/scheduling/CandidatesMemberScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <MembershipGate target={{ kind: 'plan', code }}>
      <PlanLinkFlow code={code}>
        <CandidatesMemberScreen
          fixture={fixture}
          onChangeMyTimes={() => router.push({ pathname: '/j/[code]', params: { code } })}
          onBack={() => router.back()}
        />
      </PlanLinkFlow>
    </MembershipGate>
  );
}
