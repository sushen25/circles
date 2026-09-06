import { useRouter } from 'expo-router';

import { useFixture } from '../src/data/fixtures/useFixture';
import { CirclesListScreen } from '../src/features/circles/CirclesListScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <CirclesListScreen
      fixture={fixture}
      onNext={() => router.push('/circles/sunday-crew')}
      onBack={() => router.back()}
    />
  );
}
