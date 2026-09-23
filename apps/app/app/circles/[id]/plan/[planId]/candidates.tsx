import { useLocalSearchParams } from 'expo-router';

import { CandidatesFlow } from '../../../../../src/features/scheduling/CandidatesFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, planId } = useLocalSearchParams<{ id: string; planId: string }>();

  return <CandidatesFlow id={id} planId={planId} which="candidates" />;
}
