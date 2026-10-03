import { useLocalSearchParams } from 'expo-router';

import { SetTimeFlow } from '../../../../../src/features/confirmation/SetTimeFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id, planId, mode, start, end } = useLocalSearchParams<{
    id: string;
    planId: string;
    mode?: string;
    start?: string;
    end?: string;
  }>();

  return (
    <SetTimeFlow
      id={id}
      planId={planId}
      mode={mode === 'edit' ? 'edit' : 'lock'}
      start={start}
      end={end}
    />
  );
}
