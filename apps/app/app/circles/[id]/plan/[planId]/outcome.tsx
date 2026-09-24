import { useLocalSearchParams } from 'expo-router';

import { MorningAfterFlow } from '../../../../../src/features/confirmation/MorningAfterFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { planId } = useLocalSearchParams<{ id: string; planId: string }>();

  return <MorningAfterFlow target={{ planId }} />;
}
