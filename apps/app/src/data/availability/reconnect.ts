import { AppState, Platform } from 'react-native';

/**
 * Calls `retry` whenever sending again is worth a try: the browser says it is
 * online again, or the person comes back to the page or the app.
 *
 * Not only the `online` event, because it does not fire for the commonest
 * failure. `navigator.onLine` stays true on a train between towers and on hotel
 * wifi before the login page, where the device has a network and it goes
 * nowhere. Coming back to the page is the moment somebody expects to see their
 * times go, so it is the other trigger. There is no NetInfo dependency for
 * native; `AppState` returning to `active` is that moment there.
 *
 * Returns the unsubscribe.
 */
export function onChanceToResend(retry: () => void): () => void {
  if (Platform.OS === 'web') {
    const target = globalThis as unknown as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
      document?: { visibilityState?: string };
    };
    if (typeof target.addEventListener !== 'function') return () => undefined;

    const online = () => retry();
    const visible = () => {
      if (target.document?.visibilityState === 'visible') retry();
    };
    target.addEventListener('online', online);
    target.addEventListener('visibilitychange', visible);
    return () => {
      target.removeEventListener?.('online', online);
      target.removeEventListener?.('visibilitychange', visible);
    };
  }

  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') retry();
  });
  return () => subscription.remove();
}
