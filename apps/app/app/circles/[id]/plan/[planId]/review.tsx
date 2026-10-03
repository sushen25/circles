import { useLocalSearchParams } from 'expo-router';

import { OwnReviewFlow } from '../../../../../src/features/confirmation/OwnReviewFlow';
import { ReviewFlow } from '../../../../../src/features/confirmation/ReviewFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, planId, candidate, start, end } = useLocalSearchParams<{
    id: string;
    planId: string;
    candidate?: string;
    start?: string;
    end?: string;
  }>();

  // A time the organiser chose themselves, instead of one of the options (ADR 0051).
  if (candidate === undefined && start !== undefined && end !== undefined) {
    return <OwnReviewFlow id={id} planId={planId} start={start} end={end} />;
  }
  return <ReviewFlow id={id} planId={planId} candidate={candidate} />;
}
