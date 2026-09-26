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
  if (taken) return url.slice(0, url.length - hash.length);
  // This build's own scheme always goes to the router as a path, claimed or
  // not: handed the raw URL, the router rebuilds it with every query value
  // decoded, and a `%23` becomes a fragment (review round 7). The dev
  // launcher's own link on it opens the app at its start.
  if (ours && !/^https?:\/\//i.test(origin)) {
    if (pathname === `/${DEV_CLIENT_HOST}` || pathname.startsWith(`/${DEV_CLIENT_HOST}/`))
      return '/';
    return `${pathname}${search}${hash}`;
  }
  return devClientLink(url, parts, scheme) ?? url;
}

/**
 * A development client's own link: `exp+circles://expo-development-client/?url=<Metro's origin>`.
 * expo-router decodes a `url` parameter — leniently, repeatedly, names and
 * all — and keeps any fragment it finds, and five review rounds showed that no
 * list of encodings to refuse keeps up with it. So this is an allowlist of the
 * one shape the dev launcher sends, a bare origin, percent-encoded or not,
 * with plain flags beside it. Anything else opens the app on `/`: losing a
 * crafted wrapped link in a development build costs nothing, and a release
 * build has no dev client to hand it one.
 */
const DEV_CLIENT_HOST = 'expo-development-client';
const DEV_CLIENT_QUERY =
  /^\?(?:[A-Za-z0-9_]+=[A-Za-z0-9_.-]*&)*url=https?(?::|%3A)(?:\/|%2F){2}[A-Za-z0-9.-]+(?:(?::|%3A)[0-9]+)?(?:\/|%2F)?(?:&[A-Za-z0-9_]+=[A-Za-z0-9_.-]*)*$/i;

/**
 * Any scheme but the web's and this build's own is a development client's
 * (`exp+circles:`): release builds register no other. For those the router
 * rebuilds the path with every query value decoded, so a `%23` anywhere
 * becomes a fragment (review round 6). Only the launch link passes.
 */
function devClientLink(url: string, parts: UrlParts, scheme: string): string | null {
  const protocol = parts.origin.slice(0, parts.origin.indexOf(':')).toLowerCase();
  if (protocol === 'http' || protocol === 'https' || protocol === scheme.toLowerCase()) {
    return null;
  }
  const launch =
    parts.origin.toLowerCase() === `${protocol}://${DEV_CLIENT_HOST}` &&
    parts.hash === '' &&
    parts.pathname === '/' &&
    DEV_CLIENT_QUERY.test(parts.search);
  return launch ? url : '/';
}

function routePathOf({ origin, pathname }: UrlParts): string {
  if (/^https?:\/\//i.test(origin)) return pathname;
  const authority = origin.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, '');
  // `circles:join` has no authority and no leading slash; the router reads it as `/join`.
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (authority === '') return path;
  return path === '/' ? `/${authority}` : `/${authority}${path}`;
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
