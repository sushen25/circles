/**
 * Claim a post somebody made by hand: write the platform's id into the
 * queue file's `published:` map and a `by: hand` row into the ledger, so a
 * piece is "published on youtube" the same way it is "published on bluesky"
 * and the pull measures it from the next night (docs/analytics-plan.md,
 * "Hand posts and auto-claim"). The pull calls this when it matches a tag
 * on a recent upload; `npm run posted` calls it for a pasted URL.
 *
 * It refuses a second claim of the same (slug, platform) the way the
 * publisher's guards do, by the file's map and by the ledger, with one
 * exception: a TikTok draft. The publisher sends the draft to the founder's
 * inbox, writes its publish_id into the map and a "drafted" ledger row
 * (publish/publish.ts); when the founder posts it in the app, the claim
 * replaces the publish_id with the video id and appends a "posted" row, the
 * "drafted" row staying as history. A "posted" row, or any other platform's
 * id, still refuses. The file moves to published/ once every scriptable
 * platform has an id, mirroring publish.ts. The item passed in is updated
 * in place (raw, map, status, path), so two claims on one item in one run
 * build on each other instead of the second overwriting the first.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { listQueue, setFrontmatterKey, setPublishedId, type Platform, type QueueItem } from '../lib/queue.ts';
import { sourceRef } from '../lib/links.ts';
import { DRAFT_ONLY, SCRIPTABLE, readLedger, type Ledger } from '../publish/guards.ts';
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

/** What a claim did: whether the file moved to published/, where it is now, the tag, and the draft id it replaced, if any. */
export type ClaimResult = { moved: boolean; path: string; from: string; replaced?: string };

export function claim(
  item: QueueItem,
  platform: Platform,
  id: string,
  at: string,
  opts = { ledgerPath: 'publish/ledger.jsonl', publishedDir: 'published' },
): ClaimResult {
  const slug = item.fm.slug;
  const have = item.fm.published?.[platform];
  const rows = readLedger(opts.ledgerPath).filter((r) => r.slug === slug && r.platform === platform);
  // The publisher's draft, not yet posted: every row for the pair is "drafted" (a row without a kind was posted).
  const draftOnly = DRAFT_ONLY.has(platform) && rows.length > 0 && rows.every((r) => r.kind === 'drafted');
  if (have && !draftOnly) throw new Error(`${slug} is already published on ${platform} (${have})`);
  if (rows.length && !draftOnly) throw new Error(`${slug} already has a ${platform} row in ${opts.ledgerPath}`);
  const replaced = draftOnly && have ? have : undefined;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new Error(`"${at}" is not a time`);
  const atIso = when.toISOString();
  const from = sourceRef(platform, slug);

  const published = { ...(item.fm.published ?? {}), [platform]: id };
  const allDone = item.fm.platforms.filter((p) => SCRIPTABLE.has(p)).every((p) => published[p]);
  // setPublishedId rewrites the draft's line when there is one, and adds the line when there is not.
  let raw = setPublishedId(item.raw, platform, id);
  if (allDone) raw = setFrontmatterKey(raw, 'status', 'published');
  writeFileSync(item.path, raw);

  const row: HandLedgerRow = {
    date: atIso.slice(0, 10),
    platform,
    slug,
    id,
    at: atIso,
    from,
    // A claim records a post somebody made, TikTok included; "drafted" is the publisher's, for a draft whose id is a publish_id,
    // and that row stays above this one as history when a draft is being claimed.
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
  return { moved, path, from, ...(replaced ? { replaced } : {}) };
}
