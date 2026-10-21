/**
 * claim() against a temp queue and ledger: the id lands in `published:`,
 * the ledger row says `by: hand` and carries the tag, a second claim of the
 * same platform is refused, the file moves to published/ only once every
 * scriptable platform has an id, and a TikTok claim is "posted", not the
 * publisher's "drafted". Nothing here touches the repository's own files or
 * the network.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseQueueFile } from '../lib/queue.ts';
import { readLedger } from '../publish/guards.ts';
import { claim, findItem } from './claim.ts';

const FM = (platforms: string, published = '') => `---
slug: only-moves
date: 2026-10-17
family: skit
hook: '"the only one who moves"'
status: approved
platforms: [${platforms}]
publish_at: 2026-10-17T18:00:00+11:00
publish_window_minutes: 90
media: slideshow
${published}---

## bluesky

> the caption
`;

function setup(frontmatter: string, ledgerRows: unknown[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'content-claim-'));
  mkdirSync(join(dir, 'queue'));
  mkdirSync(join(dir, 'publish'));
  const path = join(dir, 'queue', '2026-10-17-only-moves.md');
  writeFileSync(path, frontmatter);
  const ledgerPath = join(dir, 'publish', 'ledger.jsonl');
  writeFileSync(ledgerPath, ledgerRows.map((r) => JSON.stringify(r) + '\n').join(''));
  return { dir, path, ledgerPath, opts: { ledgerPath, publishedDir: join(dir, 'published') } };
}

const bskyRow = { date: '2026-10-17', platform: 'bluesky', slug: 'only-moves', id: 'at://did:plc:x/app.bsky.feed.post/abc', at: '2026-10-17T07:40:03.537Z', from: 'bs-only-moves', kind: 'posted' };

test('claim writes the id, a by-hand ledger row with the tag, and moves the file once every scriptable platform is done', () => {
  const { dir, path, ledgerPath, opts } = setup(FM('bluesky, youtube, reddit', 'published:\n  bluesky: "at://did:plc:x/app.bsky.feed.post/abc"\n'), [bskyRow]);
  const item = parseQueueFile(path);
  const r = claim(item, 'youtube', 'kHK05hfvqj4', '2026-10-17T09:15:00.000Z', opts);

  assert.equal(r.moved, true);
  assert.equal(r.from, 'yt-only-moves');
  assert.equal(r.path, join(dir, 'published', '2026-10-17-only-moves.md'));
  assert.ok(!existsSync(path), 'left queue/');
  assert.ok(existsSync(r.path), 'in published/');

  const moved = parseQueueFile(r.path);
  assert.equal(moved.fm.status, 'published');
  assert.deepEqual(moved.fm.published, { bluesky: 'at://did:plc:x/app.bsky.feed.post/abc', youtube: 'kHK05hfvqj4' });
  assert.match(readFileSync(r.path, 'utf8'), /^published:\n(  \w+: ".+"\n){2}---/m);

  const ledger = readLedger(ledgerPath);
  assert.equal(ledger.length, 2);
  assert.deepEqual(ledger[1], {
    date: '2026-10-17',
    platform: 'youtube',
    slug: 'only-moves',
    id: 'kHK05hfvqj4',
    at: '2026-10-17T09:15:00.000Z',
    from: 'yt-only-moves',
    kind: 'posted',
    by: 'hand',
  });

  // the item is kept current, so a second claim on it builds on this one
  assert.equal(item.path, r.path);
  assert.equal(item.fm.status, 'published');
  assert.equal(item.fm.published?.youtube, 'kHK05hfvqj4');
});

test('the file stays in queue/ while a scriptable platform has no id, and reddit never blocks the move', () => {
  const { path, opts } = setup(FM('bluesky, youtube, instagram, reddit'), []);
  const item = parseQueueFile(path);
  const r = claim(item, 'youtube', 'vid', '2026-10-17T09:15:00Z', opts);
  assert.equal(r.moved, false);
  assert.equal(r.path, path);
  const again = parseQueueFile(path);
  assert.equal(again.fm.status, 'approved');
  assert.deepEqual(again.fm.published, { youtube: 'vid' });
});

test('a second claim of the same platform is refused, by the file and by the ledger', () => {
  const { path, opts } = setup(FM('bluesky, youtube, instagram'), []);
  const item = parseQueueFile(path);
  claim(item, 'youtube', 'vid', '2026-10-17T09:15:00Z', opts);
  assert.throws(() => claim(item, 'youtube', 'vid2', '2026-10-17T10:00:00Z', opts), /already published on youtube \(vid\)/);
  // a fresh parse of the file also knows
  assert.throws(() => claim(parseQueueFile(path), 'youtube', 'vid2', '2026-10-17T10:00:00Z', opts), /already published on youtube/);

  // the ledger alone is enough: an item whose map lacks the platform but whose ledger has the row
  const second = setup(FM('bluesky, youtube, instagram'), [bskyRow]);
  assert.throws(() => claim(parseQueueFile(second.path), 'bluesky', 'other', '2026-10-17T10:00:00Z', second.opts), /already has a bluesky row/);
  assert.equal(readLedger(second.ledgerPath).length, 1, 'nothing appended');
});

test('a tiktok claim is kind "posted" (the founder pressed Post); a time that is not a time is refused', () => {
  const { path, ledgerPath, opts } = setup(FM('tiktok, bluesky'), []);
  const item = parseQueueFile(path);
  claim(item, 'tiktok', '7312345678901234567', '2026-10-17T20:00:00+11:00', opts);
  const [row] = readLedger(ledgerPath) as (ReturnType<typeof readLedger>[number] & { by?: string })[];
  assert.equal(row.kind, 'posted');
  assert.equal(row.by, 'hand');
  assert.equal(row.at, '2026-10-17T09:00:00.000Z', 'normalised to UTC');
  assert.equal(row.date, '2026-10-17');
  assert.throws(() => claim(item, 'bluesky', 'x', 'yesterday-ish', opts), /is not a time/);
});

test('findItem searches queue/ then published/, and copes with no published/ at all', () => {
  const { dir, path, opts } = setup(FM('bluesky'), []);
  const dirs = { queue: join(dir, 'queue'), published: opts.publishedDir };
  assert.equal(findItem('only-moves', dirs)?.path, path);
  assert.equal(findItem('nope', dirs), undefined);
  claim(parseQueueFile(path), 'bluesky', 'id', '2026-10-17T09:15:00Z', opts);
  assert.equal(findItem('only-moves', dirs)?.path, join(opts.publishedDir, '2026-10-17-only-moves.md'));
});
