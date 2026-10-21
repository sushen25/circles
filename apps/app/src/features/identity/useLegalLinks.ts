import { useRouter } from 'expo-router';

/** The two handlers `LegalLine` takes, for a flow that shows it (S4-05). */
export function useLegalLinks() {
  const router = useRouter();
  return {
    onTerms: () => router.push('/terms'),
    onPrivacy: () => router.push('/privacy'),
  };
}
