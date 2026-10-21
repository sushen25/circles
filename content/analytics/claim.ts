/**
 * Claim a post somebody made by hand: write the platform's id into the
 * queue file's `published:` map and a `by: hand` row into the ledger, so a
 * piece is "published on youtube" the same way it is "published on bluesky"
 * and the pull measures it from the next night (docs/analytics-plan.md,
 * "Hand posts and auto-claim"). The pull calls this when it matches a tag
 * on a recent upload; `npm run posted` calls it for a pasted URL.
 *
 * It refuses a second claim of the same (slug, platform) the way the
 * publisher's guards do, by the file's map and by the ledger, and it moves
 * the file to published/ once every scriptable platform has an id,
 * mirroring publish.ts. The item passed in is updated in place (raw, map,
 * status, path), so two claims on one item in one run build on each other
 * instead of the second overwriting the first.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { addPublishedIds, listQueue, setFrontmatterKey, type Platform, type QueueItem } from '../lib/queue.ts';
import { sourceRef } from '../lib/links.ts';
import { SCRIPTABLE, readLedger, type Ledger } from '../publish/guards.ts';
import { appendJsonl } from './metrics.ts';

/**
 * A ledger row written by a claim rather than by the publisher. guards.ts's
 * Ledger gains `by?: 'hand'`; the intersection carries it either way.
 */
export type HandLedgerRow = Ledger[number] & { by: 'hand' };

/** The queue file for a slug: queue/ first, then published/, which may not exist yet. */
export function findItem(slug: string, dirs = { queue: 'queue', published: 'published' }): QueueItem | undefined {
  for (const dir of [dirs.queue, dirs.published]) {
    if (!existsSync(dir)) continue;
    const hit = listQueue(dir).find((i) => i.fm.slug === slug);
    if (hit) return hit;
  }
  return undefined;
}

export function claim(
  item: QueueItem,
  platform: Platform,
  id: string,
  at: string,
  opts = { ledgerPath: 'publish/ledger.jsonl', publishedDir: 'published' },
): { moved: boolean; path: string; from: string } {
  const slug = item.fm.slug;
  const have = item.fm.published?.[platform];
  if (have) throw new Error(`${slug} is already published on ${platform} (${have})`);
  if (readLedger(opts.ledgerPath).some((r) => r.slug === slug && r.platform === platform)) {
    throw new Error(`${slug} already has a ${platform} row in ${opts.ledgerPath}`);
  }
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new Error(`"${at}" is not a time`);
  const atIso = when.toISOString();
  const from = sourceRef(platform, slug);

  const published = { ...(item.fm.published ?? {}), [platform]: id };
  const allDone = item.fm.platforms.filter((p) => SCRIPTABLE.has(p)).every((p) => published[p]);
  let raw = addPublishedIds(item.raw, { [platform]: id });
  if (allDone) raw = setFrontmatterKey(raw, 'status', 'published');
  writeFileSync(item.path, raw);

  const row: HandLedgerRow = {
    date: atIso.slice(0, 10),
    platform,
    slug,
    id,
    at: atIso,
    from,
    // A claim records a post somebody made, TikTok included; "drafted" is the publisher's, for a draft whose id is a publish_id.
    kind: 'posted',
    by: 'hand',
  };
  appendJsonl(opts.ledgerPath, row);

  let path = item.path;
  let moved = false;
  if (allDone && resolve(dirname(item.path)) !== resolve(opts.publishedDir)) {
    mkdirSync(opts.publishedDir, { recursive: true });
    path = join(opts.publishedDir, basename(item.path));
    renameSync(item.path, path);
    moved = true;
  }

  item.raw = raw;
  item.fm.published = published;
  if (allDone) item.fm.status = 'published';
  item.path = path;
  return { moved, path, from };
}
