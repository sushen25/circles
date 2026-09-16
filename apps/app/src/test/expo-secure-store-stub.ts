/**
 * `expo-secure-store`, for a runtime that is not a phone.
 *
 * The real package imports `expo-modules-core`, which reads React Native's
 * `__DEV__` at import time and then reaches for `globalThis.expo.EventEmitter`
 * — a global installed by the native runtime. Under Vitest neither exists, so
 * the import throws before any test runs. Stubbing the *native runtime* to get
 * past that would be inventing a phone; stubbing the one module we actually
 * call is honest about what is being tested.
 *
 * The unit tests do not use this — `storage.test.ts` mocks the module itself,
 * with Android's 2048-byte limit enforced, because the limit is the thing that
 * test exists to prove. This exists so the *integration* suite can import the
 * storage adapter at all. It runs there as web (`Platform.OS === 'web'` under
 * `react-native-web`), so nothing here is reached; it only has to load.
 *
 * Deliberately not exported from the app: `vitest.config.ts` aliases the
 * package name to this file, so nothing has to remember to use it.
 */

const store = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}
