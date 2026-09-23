import { useLocalSearchParams } from 'expo-router';

import { SettingsFlow } from '../../../src/features/circles/SettingsFlow';
import { MembershipGate } from '../../../src/features/identity/join/MembershipGate';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <MembershipGate target={{ kind: 'circle', id }}>
      <SettingsFlow id={id} />
    </MembershipGate>
  );
}
