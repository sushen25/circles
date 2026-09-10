/**
 * What counts as a link, and what is safe to put in a file that gets forwarded.
 *
 * One module for both, because they are two conditions on the same value and
 * splitting them is how the weaker one ends up guarding the riskier place: an
 * `.ics` is forwarded, synced to other devices and indexed by desktop search,
 * so it needs everything the confirmed screen needs and more.
 */

/**
 * An address or a map link, and nothing exotic.
 *
 * `http` and `https` only: `javascript:` and `data:` are the reason this check
 * exists at all, and a relative string is not a link a screen can open. Query
 * strings are allowed — a map link is mostly query string.
 */
export function isLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A link that is safe to embed in something that will be forwarded: a real web
 * link, with no query string and no fragment — which is where every secret this
 * product has rides (architecture §14: the invite secret in the fragment,
 * action tokens in the query).
 */
export function isTokenFree(value: string): boolean {
  if (!isLink(value)) return false;
  const url = new URL(value);
  return url.search === '' && url.hash === '';
}
