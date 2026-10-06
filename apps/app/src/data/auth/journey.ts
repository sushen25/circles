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
let generation = 0;

/**
 * Which stretch between sign-outs this is. A write made by something started
 * before a sign-out (a request still in flight) carries the generation it
 * started in and is dropped, so it cannot bring cleared state back.
 */
export function journeyGeneration(): number {
  return generation;
}

export function readJourney<T>(key: string): T | undefined {
  return held.get(key) as T | undefined;
}

export function writeJourney(key: string, value: unknown, since?: number): void {
  if (since !== undefined && since !== generation) return;
  held.set(key, value);
  for (const listener of listeners) listener();
}

export function subscribeJourneys(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sign-out, and tests: nothing is carried to the next person. */
export function forgetJourneys(): void {
  generation += 1;
  held.clear();
  for (const listener of listeners) listener();
}
