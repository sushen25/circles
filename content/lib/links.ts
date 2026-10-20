/**
 * Every link that leaves this repo carries a source tag, so an arrival at
 * wenna.app can be read back to the post it came from:
 *
 *   wenna.app/?from=bs-only-moves      (bluesky, the "only-moves" piece)
 *   wenna.app/?from=tt-bio             (the TikTok profile link, by hand)
 *
 * The tag names the post, never the person. Wenna stores it on the circle's
 * founder-only cohort row (circles SUS-240) and reads the funnel by it.
 * Drafts write `wenna.app` plain; the publisher tags on the way out, so a
 * `?from=` typed into a queue file is a check failure (lib/check.ts).
 */
import type { Platform } from './queue.ts';

export const HOST = 'wenna.app';

/** Short, stable prefixes: the tag is read by eye in a dashboard column. */
export const PLATFORM_PREFIX: Record<Platform, string> = {
  tiktok: 'tt',
  instagram: 'ig',
  threads: 'th',
  bluesky: 'bs',
  linkedin: 'li',
  youtube: 'yt',
  reddit: 'rd',
};

/** What Wenna accepts: lowercase slug, 1–40 chars. Anything else is dropped on arrival. */
export const SOURCE_REF = /^[a-z0-9-]{1,40}$/;

export function sourceRef(platform: Platform, slug: string): string {
  const base = `${PLATFORM_PREFIX[platform]}-${slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  if (!SOURCE_REF.test(base)) throw new Error(`source tag "${base}" is not a slug`);
  return base;
}

export function taggedUrl(platform: Platform, slug: string): string {
  return `${HOST}/?from=${sourceRef(platform, slug)}`;
}

/**
 * A bare `wenna.app` (optionally with scheme or a trailing slash) becomes the
 * tagged URL. A path such as `wenna.app/j/abcd` is a plan link inside a
 * fictional chat and is left alone; so is a mention already tagged.
 */
const BARE = /(^|[\s(>"'])((?:https?:\/\/)?wenna\.app\/?)(?!\?(?:from|s)=)(?=$|[\s).,;:!?"'])/g;

export function tagLinks(text: string, platform: Platform, slug: string): string {
  const url = taggedUrl(platform, slug);
  return text.replace(BARE, (_m, lead: string, found: string) => `${lead}${found.startsWith('http') ? 'https://' : ''}${url}`);
}

/** True when a draft already carries a hand-written tag; the publisher owns tags. */
export function hasHandTag(text: string): boolean {
  return /wenna\.app\/?\?(from|s)=/i.test(text);
}
