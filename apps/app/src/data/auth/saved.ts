/**
 * "Your place is saved", said once on the screen the person returns to.
 *
 * The address is personal data, so it is not passed in a URL; it is held here,
 * in memory, between SaveAccess finishing and the previous screen reading it,
 * and the read takes it.
 */
let saved: string | undefined;

export function noteSavedWith(address: string): void {
  saved = address;
}

export function takeSavedWith(): string | undefined {
  const address = saved;
  saved = undefined;
  return address;
}
