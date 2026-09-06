import { useRouter } from 'expo-router';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { DiagnosticsScreen } from '../../src/features/identity/DiagnosticsScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return <DiagnosticsScreen fixture={fixture} onBack={() => router.back()} />;
}
