import { useRouter } from 'expo-router';

import { PrivacyScreen } from '../../src/features/identity/PrivacyScreen';

/** Route only — thin composition, no logic (architecture §7.1). Static copy. */
export default function Route() {
  const router = useRouter();

  return (
    <PrivacyScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings/account'))}
    />
  );
}
