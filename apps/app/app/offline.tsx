import { useRouter } from 'expo-router';

import { OfflineScreen } from '../src/features/system/OfflineScreen';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * The artboard's own URL, for the gallery. In the product this screen is a
 * state of `/j/:code` (`AvailabilityFlow`), not somewhere anybody navigates.
 */
export default function Route() {
  const router = useRouter();

  return <OfflineScreen kind="offline" onBack={() => router.back()} />;
}
