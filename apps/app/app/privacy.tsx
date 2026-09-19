import { useRouter } from 'expo-router';

import { LegalScreen } from '../src/features/identity/LegalScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();

  return (
    <LegalScreen
      kind="privacy"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}
