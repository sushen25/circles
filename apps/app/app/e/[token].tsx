import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { EmailPrefsScreen } from '../../src/features/communication/EmailPrefsScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <EmailPrefsScreen fixture={fixture} onBack={() => router.back()} />;
}
