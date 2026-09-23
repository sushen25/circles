import { useRouter } from 'expo-router';

import { EmptyCirclesListScreen } from '../../src/features/circles/EmptyCirclesListScreen';

/**
 * Route only — thin composition, no logic (architecture §7.1). The first-run
 * variant of the circles list, on a route of its own for the gallery; `/circles`
 * shows it itself when the list is empty.
 */
export default function Route() {
  const router = useRouter();

  return (
    <EmptyCirclesListScreen
      onNext={() => router.push('/circles/new')}
      onAccount={() => router.push('/settings/account')}
      onBack={() => router.back()}
    />
  );
}
