import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { LinkInvalidScreen } from '../../src/features/identity/LinkInvalidScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <LinkInvalidScreen fixture={fixture} onBack={() => router.back()} />;
}
