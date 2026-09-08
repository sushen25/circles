/**
 * Fixture override helper, shared by every context's builders.
 *
 * Passing `undefined` for a field means "absent", so a test can write
 * `plan({ organiserUserId: undefined })` for a plan nobody is organising yet.
 * Spreading would instead set the key to `undefined`, which
 * `exactOptionalPropertyTypes` rejects — the distinction the compiler draws is
 * a real one, and this is the one place worth absorbing it.
 */
export type Overrides<T> = { [K in keyof T]?: T[K] | undefined };

export function build<T extends object>(base: T, overrides: Overrides<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out as T;
}
