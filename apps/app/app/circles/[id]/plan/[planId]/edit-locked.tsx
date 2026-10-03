import { useLocalSearchParams } from 'expo-router';

import { EditLockedFlow } from '../../../../../src/features/confirmation/EditLockedFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, planId, start, end } = useLocalSearchParams<{
    id: string;
    planId: string;
    start?: string;
    end?: string;
  }>();

  return <EditLockedFlow id={id} planId={planId} start={start} end={end} />;
}
