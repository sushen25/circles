import { useLocalSearchParams } from 'expo-router';

import { ConfirmedFlow } from '../../../../../src/features/confirmation/ConfirmedFlow';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { planId } = useLocalSearchParams<{ id: string; planId: string }>();

  return <ConfirmedFlow target={{ planId }} />;
}
