/**
 * What a screen holds in memory across a sign-in (SUS-162).
 *
 * Signing a guest into an account the address already has changes the user id,
 * which makes the membership gate above a route replace its children; a screen
 * with a journey in progress (the one-step card on Sent) keeps its place here
 * rather than in component state. It is in memory only, may hold an address the
 * person typed (never in a URL, never in storage), and is **forgotten when the
 * person signs out**, so the next person on the same device inherits nothing.
 *
 * A journey is whatever its owner puts in: this module does not read it.
 */
const held = new Map<string, unknown>();
const listeners = new Set<() => void>();

export function readJourney<T>(key: string): T | undefined {
  return held.get(key) as T | undefined;
}

export function writeJourney(key: string, value: unknown): void {
  held.set(key, value);
  for (const listener of listeners) listener();
}

export function subscribeJourneys(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sign-out, and tests: nothing is carried to the next person. */
export function forgetJourneys(): void {
  held.clear();
  for (const listener of listeners) listener();
}
