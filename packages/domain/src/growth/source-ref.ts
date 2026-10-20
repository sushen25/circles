/**
 * The campaign tag a link carries (`?from=<tag>`, SUS-240): a label for the post
 * a stranger came from, never for the person.
 *
 * One rule, here, so the app that reads it off the address, the Edge Function
 * that forwards it and the database constraint that finally stores it say the
 * same thing: one to forty of lowercase letters, digits and hyphens. A tag is a
 * slug and nothing else, so it cannot carry an address, a name or a token.
 *
 * Deliberately general: which prefixes the content loop uses (`tt-`, `ig-`,
 * `rd-`, `cmp-`) is that loop's business and is not hard-coded here.
 * `supabase/migrations` repeats the pattern in a check constraint, and
 * `source-ref.test.ts` holds the two to each other.
 */
export const SOURCE_REF_PATTERN = /^[a-z0-9-]{1,40}$/;

/** The tag, or `undefined` for anything that is not one: absent, malformed, repeated, too long. */
export function parseSourceRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return SOURCE_REF_PATTERN.test(value) ? value : undefined;
}
