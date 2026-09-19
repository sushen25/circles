import { usePathname, useRouter } from 'expo-router';

import { safeReturnPath } from '../../../data/auth/returnPath';

/**
 * "I have an account" (ADR 0022): sign in, then back to the plan link this
 * person is on. The return path is this page's own path, and only if it is a
 * plan link (`safeReturnPath`); the gate on that link then lets a member in or
 * offers an account that is not one "Join <circle> as <name>".
 */
export function useHaveAccount(): () => void {
  const router = useRouter();
  const pathname = usePathname();

  return () => {
    const next = safeReturnPath(pathname);
    router.push(next === undefined ? '/sign-in' : { pathname: '/sign-in', params: { next } });
  };
}
