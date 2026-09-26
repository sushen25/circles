import { APP_LINK_PATHS, brand } from '@circles/config';

import { takeInviteFragment } from '../membership/invite';
import { takeTokenFragment } from './tokens';

/**
 * A link the installed app was opened with, on its way to the router (S3-01a).
 *
 * On the web a link arrives in the address bar, and `index.ts` takes every
 * capability out of the fragment before `expo-router/entry` is evaluated
 * (S1-24, ADR 0023). In the app there is no address bar: the operating system
 * hands the URL to `Linking` — `getInitialURL()` for a cold start, the `url`
 * event while the app is running — and expo-router reads both itself and parses
 * a fragment into its state as a `#` param, where every navigation writes it
 * back. So this runs where the router asks what to do with a system URL
 * (`app/+native-intent.ts`'s `redirectSystemPath`), before any state exists,
 * and applies the **same** two rules the web's capture applies
 * (`takeInviteFragment`, `takeTokenFragment`): the capability is held in
 * memory, and the router is given the path without it.
 *
 * From there it is an ordinary navigation to an ordinary route, so a link opened
 * in the app meets exactly the guards a link opened in a browser meets — the
 * session, `MembershipGate`, Continue-as and the re-entry token's own screen.
 * Nothing here decides who may see what; it only decides what the router sees.
 *
 * A URL on the link host is reduced to its path, so the router never holds the
 * host either. One on this build's own scheme (`circles://…`) or anything else
 * passes through with only the capability removed: the router already knows
 * how to read those, and a link the app does not claim is not this module's to
 * rewrite.
 */
export function routeIncomingLink(
  url: string,
  linkHosts: readonly string[] = defaultHosts(),
  scheme: string = brand.scheme,
): string {
  const parts = splitUrl(url);
  if (parts === null) return url;

  const { origin, search, hash } = parts;
  const ours =
    (/^https?:\/\//i.test(origin) && linkHosts.includes(hostOf(origin))) ||
    origin.toLowerCase().startsWith(`${scheme}:`);
  // `circles://p/abc` is `/p/abc` to the router: a custom scheme's "host" is
  // the first segment of the path.
  const pathname = ours ? routePathOf(parts) : parts.pathname;

  const taken = takeInviteFragment(pathname, hash) || takeTokenFragment(pathname, hash);
  if (ours && isClaimed(pathname)) return `${pathname}${search}${taken ? '' : hash}`;
  const withoutFragment = taken ? url.slice(0, url.length - hash.length) : url;
  return taken ? withoutFragment : wrappedLinkStripped(withoutFragment, search, linkHosts, scheme);
}

/**
 * A development client's own link wraps the real one in `?url=`:
 * `exp+circles://expo-development-client/?url=http%3A%2F%2F…%2Fjoin%23<secret>`.
 * expo-router decodes it — repeatedly, through a wrapper inside a wrapper — and
 * keeps the fragment, so this decodes the same way, and when a fragment is in
 * there, routes the innermost link as if it had arrived on its own. The dev
 * launcher has already used `url` to load the bundle by the time the router
 * asks. Development builds only: a release build has no dev client (review
 * rounds 1 and 2).
 */
function wrappedLinkStripped(
  url: string,
  search: string,
  linkHosts: readonly string[],
  scheme: string,
): string {
  // The parameter itself, not a name that merely ends in `url` (`xurl=`).
  const match = /(?:^\?|&)url=([^&#]*)/.exec(search);
  if (match === null || match[1] === undefined) return url;
  let inner = match[1];
  for (let depth = 0; depth < 8; depth += 1) {
    let next: string;
    try {
      next = decodeURIComponent(inner);
    } catch {
      break;
    }
    if (next === inner) break;
    inner = next;
  }
  if (!inner.includes('#')) return url;
  const at = inner.lastIndexOf('url=');
  const innermost = at === -1 ? inner : inner.slice(at + 'url='.length);
  return routeIncomingLink(innermost, linkHosts, scheme);
}

function routePathOf({ origin, pathname }: UrlParts): string {
  if (/^https?:\/\//i.test(origin)) return pathname;
  const authority = origin.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, '');
  if (authority === '') return pathname;
  return pathname === '/' ? `/${authority}` : `/${authority}${pathname}`;
}

/** The brand's host always; the build's own origin too, so a preview host opens its own build. */
function defaultHosts(): string[] {
  const hosts: string[] = [brand.domain];
  const configured = process.env.EXPO_PUBLIC_APP_ORIGIN;
  if (configured !== undefined && configured !== '') {
    const parts = splitUrl(configured);
    if (parts !== null) hosts.push(hostOf(parts.origin));
  }
  return hosts;
}

/** One of `APP_LINK_PATHS`: the only paths the intent filters and the AASA claim. */
export function isClaimed(pathname: string): boolean {
  return APP_LINK_PATHS.some((entry) =>
    entry.match === 'exact'
      ? pathname.replace(/\/+$/, '') === entry.path
      : pathname.startsWith(entry.path) && pathname.length > entry.path.length,
  );
}

interface UrlParts {
  /** `scheme://host`, or `scheme:` for a URL with no authority. */
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

/**
 * By hand rather than with `URL`: React Native's `URL` is a partial polyfill,
 * and custom schemes (`circles://p/…`, `exp+circles://…`) are exactly where it
 * and a browser's disagree. This needs four substrings, not a parser.
 */
export function splitUrl(url: string): UrlParts | null {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (scheme === null) return null;
  let rest = url.slice(scheme[0].length);
  let origin = scheme[0];
  if (rest.startsWith('//')) {
    const end = rest.slice(2).search(/[/?#]/);
    const authority = end === -1 ? rest.slice(2) : rest.slice(2, 2 + end);
    origin += `//${authority}`;
    rest = rest.slice(2 + authority.length);
  }
  const hashAt = rest.indexOf('#');
  const hash = hashAt === -1 ? '' : rest.slice(hashAt);
  const beforeHash = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const searchAt = beforeHash.indexOf('?');
  const search = searchAt === -1 ? '' : beforeHash.slice(searchAt);
  const pathname = (searchAt === -1 ? beforeHash : beforeHash.slice(0, searchAt)) || '/';
  return { origin, pathname, search, hash };
}

function hostOf(origin: string): string {
  const authority = origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return authority.replace(/^.*@/, '').replace(/:\d+$/, '').toLowerCase();
}
