import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { EmailVerifiedScreen } from '../../src/features/communication/EmailVerifiedScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <EmailVerifiedScreen fixture={fixture} onBack={() => router.back()} />;
}
