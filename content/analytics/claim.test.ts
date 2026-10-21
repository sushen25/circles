/**
 * claim() against a temp queue and ledger: the id lands in `published:`,
 * the ledger row says `by: hand` and carries the tag, a second claim of the
 * same platform is refused, the file moves to published/ only once every
 * scriptable platform has an id, a TikTok claim is "posted", not the
 * publisher's "drafted", and the publisher's TikTok draft is the one id a
 * claim may replace. Nothing here touches the repository's own files or the
 * network.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseFrontmatter, parseQueueFile, setPublishedId } from '../lib/queue.ts';
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
/** What publish.ts writes for a TikTok draft: the publish_id, kind "drafted", no `by`. */
const DRAFT_ID = 'v_pub_url~v2.123456789';
const draftRow = { date: '2026-10-17', platform: 'tiktok', slug: 'only-moves', id: DRAFT_ID, at: '2026-10-17T07:41:10.002Z', from: 'tt-only-moves', kind: 'drafted' };
const VIDEO_ID = '7312345678901234567';

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

test('a TikTok draft is replaced by the founder\'s post: the id in the file, a posted row under the drafted one, and the move when it was the last platform', () => {
  const { dir, path, ledgerPath, opts } = setup(FM('tiktok, bluesky, reddit', `published:\n  tiktok: "${DRAFT_ID}"\n  bluesky: "at://did:plc:x/app.bsky.feed.post/abc"\n`), [bskyRow, draftRow]);
  const item = parseQueueFile(path);
  assert.equal(item.fm.published?.tiktok, DRAFT_ID);
  const r = claim(item, 'tiktok', VIDEO_ID, '2026-10-17T20:00:00+11:00', opts);

  assert.deepEqual(r, { moved: true, path: join(dir, 'published', '2026-10-17-only-moves.md'), from: 'tt-only-moves', replaced: DRAFT_ID });
  assert.ok(!existsSync(path), 'left queue/');
  const text = readFileSync(r.path, 'utf8');
  assert.match(text, /^published:\n  tiktok: "7312345678901234567"\n  bluesky: "at:\/\/did:plc:x\/app.bsky.feed.post\/abc"\n---/m, 'the line is rewritten in place');
  assert.doesNotMatch(text, /v_pub_url/, 'the publish_id is gone from the file');
  assert.match(text, /^status: published$/m);
  assert.deepEqual(parseQueueFile(r.path).fm.published, { tiktok: VIDEO_ID, bluesky: 'at://did:plc:x/app.bsky.feed.post/abc' });

  // the drafted row stays as history; the posted row goes under it
  const ledger = readLedger(ledgerPath);
  assert.equal(ledger.length, 3);
  assert.deepEqual(ledger[1], draftRow);
  assert.deepEqual(ledger[2], { date: '2026-10-17', platform: 'tiktok', slug: 'only-moves', id: VIDEO_ID, at: '2026-10-17T09:00:00.000Z', from: 'tt-only-moves', kind: 'posted', by: 'hand' });
  assert.equal(item.fm.published?.tiktok, VIDEO_ID);

  // and now that it is posted, a third id is refused like any other
  assert.throws(() => claim(item, 'tiktok', 'another', '2026-10-17T10:00:00Z', opts), /already published on tiktok \(7312345678901234567\)/);
  assert.throws(() => claim(parseQueueFile(r.path), 'tiktok', 'another', '2026-10-17T10:00:00Z', opts), /already published on tiktok/);
  assert.equal(readLedger(ledgerPath).length, 3, 'nothing appended');
});

test('a replaced draft leaves the file where it is when another platform is still open, and rewrites a file already in published/ in place', () => {
  const { path, opts } = setup(FM('tiktok, bluesky, youtube', `published:\n  tiktok: "${DRAFT_ID}"\n  bluesky: "at://did:plc:x/app.bsky.feed.post/abc"\n`), [bskyRow, draftRow]);
  const r = claim(parseQueueFile(path), 'tiktok', VIDEO_ID, '2026-10-17T09:00:00Z', opts);
  assert.equal(r.moved, false);
  assert.equal(r.path, path);
  assert.equal(r.replaced, DRAFT_ID);
  const again = parseQueueFile(path);
  assert.equal(again.fm.status, 'approved');
  assert.deepEqual(again.fm.published, { tiktok: VIDEO_ID, bluesky: 'at://did:plc:x/app.bsky.feed.post/abc' });

  // the usual case: the publisher drafted TikTok and posted the rest, so the file is in published/ already
  const done = setup(FM('tiktok, bluesky', `published:\n  tiktok: "${DRAFT_ID}"\n  bluesky: "at://did:plc:x/app.bsky.feed.post/abc"\n`).replace('status: approved', 'status: published'), [bskyRow, draftRow]);
  mkdirSync(done.opts.publishedDir);
  const publishedPath = join(done.opts.publishedDir, '2026-10-17-only-moves.md');
  writeFileSync(publishedPath, readFileSync(done.path, 'utf8'));
  const r2 = claim(parseQueueFile(publishedPath), 'tiktok', VIDEO_ID, '2026-10-17T09:00:00Z', done.opts);
  assert.deepEqual(r2, { moved: false, path: publishedPath, from: 'tt-only-moves', replaced: DRAFT_ID });
  assert.match(readFileSync(publishedPath, 'utf8'), /^  tiktok: "7312345678901234567"$/m);
  assert.equal(readLedger(done.ledgerPath).length, 3);
});

test('only the publisher\'s draft may be replaced: a posted row refuses, a draft on a platform that is not draft-only refuses', () => {
  // posted by hand already, id in the map: refused by the file
  const handRow = { ...draftRow, id: 'earlier', kind: 'posted', by: 'hand' };
  const posted = setup(FM('tiktok, bluesky', 'published:\n  tiktok: "earlier"\n'), [handRow]);
  assert.throws(() => claim(parseQueueFile(posted.path), 'tiktok', VIDEO_ID, '2026-10-17T09:00:00Z', posted.opts), /already published on tiktok \(earlier\)/);

  // drafted, then posted: the posted row wins, and the map's id is refused
  const both = setup(FM('tiktok, bluesky', `published:\n  tiktok: "${VIDEO_ID}"\n`), [draftRow, { ...handRow, id: VIDEO_ID }]);
  assert.throws(() => claim(parseQueueFile(both.path), 'tiktok', 'another', '2026-10-17T09:00:00Z', both.opts), /already published on tiktok/);

  // a row without a kind was posted (older ledgers)
  const { kind: _kind, ...untyped } = draftRow;
  const old = setup(FM('tiktok, bluesky', `published:\n  tiktok: "${DRAFT_ID}"\n`), [untyped]);
  assert.throws(() => claim(parseQueueFile(old.path), 'tiktok', VIDEO_ID, '2026-10-17T09:00:00Z', old.opts), /already published on tiktok/);

  // "drafted" on youtube cannot come from the publisher; the id in the map still refuses
  const yt = setup(FM('bluesky, youtube', 'published:\n  youtube: "vid"\n'), [{ ...draftRow, platform: 'youtube', id: 'vid', from: 'yt-only-moves' }]);
  assert.throws(() => claim(parseQueueFile(yt.path), 'youtube', 'vid2', '2026-10-17T09:00:00Z', yt.opts), /already published on youtube \(vid\)/);
  for (const [s, rows] of [[posted, 1], [both, 2], [old, 1], [yt, 1]] as const) assert.equal(readLedger(s.ledgerPath).length, rows, 'nothing appended');

  // a drafted row with no id in the map (the line was removed by hand) does not block the post: the line is added, nothing replaced
  const bare = setup(FM('tiktok, bluesky'), [draftRow]);
  const r = claim(parseQueueFile(bare.path), 'tiktok', VIDEO_ID, '2026-10-17T09:00:00Z', bare.opts);
  assert.deepEqual(r, { moved: false, path: bare.path, from: 'tt-only-moves' });
  assert.deepEqual(parseQueueFile(bare.path).fm.published, { tiktok: VIDEO_ID });
  assert.equal(readLedger(bare.ledgerPath).length, 2);
});

test('setPublishedId rewrites the one line inside the published: block, adds it when absent, and leaves the body alone', () => {
  const raw = FM('tiktok, bluesky', 'published:\n  tiktok: "old"\n  bluesky: "b"\n') + '\n  tiktok: "in the body, not the map"\n';
  const out = setPublishedId(raw, 'tiktok', 'new$1');
  assert.match(out, /^published:\n  tiktok: "new\$1"\n  bluesky: "b"\n---/m);
  assert.ok(out.endsWith('\n  tiktok: "in the body, not the map"\n'), 'the body line is untouched');
  assert.equal(setPublishedId(raw, 'bluesky', 'c'), raw.replace('bluesky: "b"', 'bluesky: "c"'));

  // absent line, present block: appended at the top of the block as addPublishedIds does
  assert.match(setPublishedId(raw, 'youtube', 'y'), /^published:\n  youtube: "y"\n  tiktok: "old"\n  bluesky: "b"\n---/m);
  // no block at all
  assert.match(setPublishedId(FM('tiktok'), 'tiktok', 'x'), /\npublished:\n  tiktok: "x"\n---\n/);
});

test('setPublishedId finds a line past a blank line inside the block, as parseFrontmatter reads past it, and keeps the blank lines', () => {
  const raw = FM('tiktok, bluesky', 'published:\n  tiktok: "old"\n\n  bluesky: "b"\n\n');
  assert.deepEqual(parseFrontmatter(raw).fm.published, { tiktok: 'old', bluesky: 'b' });
  const out = setPublishedId(raw, 'bluesky', 'c');
  assert.equal(out, raw.replace('bluesky: "b"', 'bluesky: "c"'), 'rewritten in place, nothing else moved');
  assert.deepEqual(parseFrontmatter(out).fm.published, { tiktok: 'old', bluesky: 'c' });
  assert.equal(out.split('bluesky:').length, 2, 'one bluesky line, not a second one above the old');
  // the blank line before the --- stays where it was, and an absent platform is still added at the top of the block
  assert.match(out, /  bluesky: "c"\n\n---\n/);
  assert.match(setPublishedId(raw, 'youtube', 'y'), /^published:\n  youtube: "y"\n  tiktok: "old"\n\n  bluesky: "b"\n\n---/m);
});

test('parseFrontmatter keeps a nested map value as text, so an Instagram id above 2^53 is not rounded', () => {
  const { fm } = parseFrontmatter(FM('instagram, bluesky', 'published:\n  instagram: 18395365036204751\n  bluesky: \'at://did:plc:x/app.bsky.feed.post/abc\'\n'));
  assert.deepEqual(fm.published, { instagram: '18395365036204751', bluesky: 'at://did:plc:x/app.bsky.feed.post/abc' });
  assert.equal(fm.publish_window_minutes, 90, 'a top-level number is still a number');
  assert.deepEqual(fm.platforms, ['instagram', 'bluesky']);
});

test('findItem searches queue/ then published/, and copes with no published/ at all', () => {
  const { dir, path, opts } = setup(FM('bluesky'), []);
  const dirs = { queue: join(dir, 'queue'), published: opts.publishedDir };
  assert.equal(findItem('only-moves', dirs)?.path, path);
  assert.equal(findItem('nope', dirs), undefined);
  claim(parseQueueFile(path), 'bluesky', 'id', '2026-10-17T09:15:00Z', opts);
  assert.equal(findItem('only-moves', dirs)?.path, join(opts.publishedDir, '2026-10-17-only-moves.md'));
});
