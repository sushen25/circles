import { Platform } from 'react-native';

/**
 * The origin the links this app hands out should point at.
 *
 * On the web, the page's own: a preview deploy's invite should open that
 * preview, and the address bar is the one answer that is never stale. Natively
 * there is no page, so the deploy-time `EXPO_PUBLIC_APP_ORIGIN` (ADR 0001: the
 * domain is configuration, never a literal). `create-circle` returns the invite
 * secret rather than a URL for exactly this reason — the client is the only
 * party that knows its own origin.
 */
export function appOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location !== undefined) {
    return window.location.origin;
  }
  const configured = process.env.EXPO_PUBLIC_APP_ORIGIN;
  if (configured === undefined || configured === '') {
    throw new Error('EXPO_PUBLIC_APP_ORIGIN is not set — see docs/runbooks/environments.md');
  }
  return configured.replace(/\/+$/, '');
}
