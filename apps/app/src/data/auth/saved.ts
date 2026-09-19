/**
 * "Your place is saved", said once on the screen the person returns to.
 *
 * The address is personal data, so it is not passed in a URL; it is held here,
 * in memory, between SaveAccess finishing and the screen that sent them there
 * reading it, and the read takes it. Keyed by the plan's code, which both
 * callers (Sent and the verified page) know, so a note is only ever taken by
 * the screen it was written for and nothing is left queued for another.
 */
const saved = new Map<string, string>();

export function noteSavedWith(code: string, address: string): void {
  saved.set(code, address);
}

export function takeSavedWith(code: string): string | undefined {
  const address = saved.get(code);
  saved.delete(code);
  return address;
}
