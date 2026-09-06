import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { ConfirmedGuestScreen } from '../../../src/features/confirmation/ConfirmedGuestScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <ConfirmedGuestScreen
      fixture={fixture}
      onICantMakeIt={() => router.push('/p/[code]/attendance')}
      onBack={() => router.back()}
    />
  );
}
