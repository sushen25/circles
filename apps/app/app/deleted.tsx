import { useRouter } from 'expo-router';

import { DeletedScreen } from '../src/features/identity/DeletedScreen';

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();

  return <DeletedScreen onDone={() => router.replace('/')} />;
}
