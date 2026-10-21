/**
 * writeReplies() against a temp inbox: seen replies are skipped, handles and
 * links are stripped from what is written, the headings are what /mine
 * reads, nothing is written when nothing is new, and the seen file holds
 * sorted hashes and never an id. Nothing here touches the repository's own
 * files.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { seenKey, writeReplies } from './inbox.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'content-inbox-'));
  return { dir, opts: { seenPath: join(dir, 'analytics', 'replies-seen.json'), inboxDir: join(dir, 'inbox') } };
}

const seen = (path: string): string[] => JSON.parse(readFileSync(path, 'utf8'));

test('seenKey is the first 32 hex characters of sha256("<platform>:<id>"), so the file can be read by nobody', () => {
  assert.equal(seenKey('bluesky', 'b1'), '438484d7fce1819724ce6fb0739869a8');
  assert.equal(seenKey('bluesky', 'old'), '92b9905dab51295b139cedb6c25a42eb');
  assert.notEqual(seenKey('bluesky', 'b1'), seenKey('instagram', 'b1'), 'the platform is part of the key');
});

test('writes a dated file with one section per piece and platform, handles stripped, newest last', () => {
  const { opts } = setup();
  const r = writeReplies(
    '2026-10-21',
    [
      {
        slug: 'never-lead-anywhere',
        platform: 'bluesky',
        replies: [
          { id: 'b2', at: '2026-10-21T10:00:00Z', text: 'this is my group chat exactly\nsecond line' },
          { id: 'b1', at: '2026-10-21T08:00:00Z', text: 'so true @someone.bsky.social see https://example.com/x' },
        ],
      },
      { slug: 'never-lead-anywhere', platform: 'instagram', replies: [{ id: 'i1', at: '2026-10-21T09:00:00Z', text: 'u/throwaway said it first' }] },
    ],
    opts,
  );
  assert.equal(r.written, 3);
  assert.equal(r.file, join(opts.inboxDir, '2026-10-21-replies.md'));
  assert.equal(
    readFileSync(r.file, 'utf8'),
    `# Replies, 2026-10-21

## never-lead-anywhere · bluesky

> so true @… see [link]

> this is my group chat exactly
> second line

## never-lead-anywhere · instagram

> u/… said it first
`,
  );
  assert.deepEqual(seen(opts.seenPath), [seenKey('bluesky', 'b1'), seenKey('bluesky', 'b2'), seenKey('instagram', 'i1')].sort());
  assert.ok(readFileSync(opts.seenPath, 'utf8').includes('\n  "438484d7fce1819724ce6fb0739869a8",\n'), 'pretty-printed with two spaces');
});

test('the seen file holds hashes and never an id: a Bluesky id carries the replier DID', () => {
  const { opts } = setup();
  const id = 'at://did:plc:abcdefg/app.bsky.feed.post/3kxyz';
  writeReplies('2026-10-21', [{ slug: 'x', platform: 'bluesky', replies: [{ id, at: '2026-10-21T08:00:00Z', text: 'one' }] }], opts);
  const text = readFileSync(opts.seenPath, 'utf8');
  assert.doesNotMatch(text, /did:plc|bsky|bluesky|3kxyz/);
  assert.deepEqual(seen(opts.seenPath), [seenKey('bluesky', id)]);
  assert.match(seen(opts.seenPath)[0], /^[0-9a-f]{32}$/);
  // and the same reply is still recognised next time
  const again = writeReplies('2026-10-22', [{ slug: 'x', platform: 'bluesky', replies: [{ id, at: '2026-10-21T08:00:00Z', text: 'one' }] }], opts);
  assert.equal(again.written, 0);
});

test('seen ids are skipped, a later run appends without a second header, and the seen file stays sorted', () => {
  const { opts } = setup();
  const first = writeReplies('2026-10-21', [{ slug: 'x', platform: 'threads', replies: [{ id: 't9', at: '2026-10-21T08:00:00Z', text: 'one' }] }], opts);
  assert.equal(first.written, 1);
  const second = writeReplies(
    '2026-10-21',
    [
      {
        slug: 'x',
        platform: 'threads',
        replies: [
          { id: 't9', at: '2026-10-21T08:00:00Z', text: 'one' },
          { id: 't1', at: '2026-10-21T11:00:00Z', text: 'two' },
        ],
      },
      { slug: 'y', platform: 'bluesky', replies: [{ id: 'a', at: '2026-10-21T12:00:00Z', text: 'three' }] },
    ],
    opts,
  );
  assert.equal(second.written, 2);
  const text = readFileSync(second.file, 'utf8');
  assert.equal(text.split('# Replies, 2026-10-21').length, 2, 'one header');
  assert.equal(text, '# Replies, 2026-10-21\n\n## x · threads\n\n> one\n\n## x · threads\n\n> two\n\n## y · bluesky\n\n> three\n');
  assert.deepEqual(seen(opts.seenPath), [seenKey('bluesky', 'a'), seenKey('threads', 't1'), seenKey('threads', 't9')].sort());
});

test('nothing is written when nothing is new: no file, and the seen set is left alone', () => {
  const { opts } = setup();
  const none = writeReplies('2026-10-21', [{ slug: 'x', platform: 'bluesky', replies: [] }], opts);
  assert.equal(none.written, 0);
  assert.ok(!existsSync(none.file));
  assert.ok(!existsSync(opts.seenPath));

  mkdirSync(dirname(opts.seenPath), { recursive: true });
  // sha256("bluesky:old"), as a run before this one would have written it
  writeFileSync(opts.seenPath, JSON.stringify(['92b9905dab51295b139cedb6c25a42eb'], null, 2) + '\n');
  const stale = writeReplies('2026-10-22', [{ slug: 'x', platform: 'bluesky', replies: [{ id: 'old', at: '2026-10-20T00:00:00Z', text: 'seen before' }] }], opts);
  assert.equal(stale.written, 0);
  assert.ok(!existsSync(stale.file));
  assert.equal(readFileSync(opts.seenPath, 'utf8'), '[\n  "92b9905dab51295b139cedb6c25a42eb"\n]\n', 'untouched');
});

test('a reply that repeats inside one run is written once', () => {
  const { opts } = setup();
  const r = writeReplies(
    '2026-10-21',
    [
      { slug: 'x', platform: 'bluesky', replies: [{ id: 'dup', at: '2026-10-21T08:00:00Z', text: 'once' }] },
      { slug: 'x', platform: 'bluesky', replies: [{ id: 'dup', at: '2026-10-21T08:00:00Z', text: 'once' }] },
    ],
    opts,
  );
  assert.equal(r.written, 1);
  assert.equal(readFileSync(r.file, 'utf8').split('> once').length, 2);
});
