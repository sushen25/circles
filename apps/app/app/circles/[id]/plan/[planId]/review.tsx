import { useLocalSearchParams } from 'expo-router';

import { ReviewFlow } from '../../../../../src/features/confirmation/ReviewFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, planId, candidate } = useLocalSearchParams<{
    id: string;
    planId: string;
    candidate?: string;
  }>();

  return <ReviewFlow id={id} planId={planId} candidate={candidate} />;
}
