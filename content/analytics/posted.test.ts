/**
 * `npm run posted` against fakes: no registry, no queue file, nothing
 * written. The fakes stand in for claim.ts and platforms/index.ts by the
 * contract posted.ts imports them under.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueueItem } from '../lib/queue.ts';
import type { PlatformModule } from './platforms/module.ts';
import { parseArgs, run, wouldMove, type ClaimResult, type Deps } from './posted.ts';

const NOW = new Date('2026-10-22T10:00:00.000Z');

function item(published: Record<string, string> = {}): QueueItem {
  return {
    path: 'queue/2026-10-20-never-lead-anywhere.md',
    raw: '',
    fm: {
      slug: 'never-lead-anywhere',
      date: '2026-10-20',
      family: 'skit',
      hook: 'x',
      status: 'approved',
      platforms: ['tiktok', 'instagram', 'bluesky', 'youtube', 'reddit'],
      publish_at: '2026-10-20T18:00:00+11:00',
      publish_window_minutes: 90,
      media: 'slideshow',
      published,
    },
    skit: null,
    captions: {},
  };
}

type Harness = { deps: Partial<Deps>; out: string[]; err: string[]; claims: unknown[][] };

function harness(
  opts: { modules?: Partial<Record<string, Partial<PlatformModule>>>; item?: QueueItem | undefined; claim?: Deps['claim']; env?: Deps['env'] } = {},
): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const claims: unknown[][] = [];
  const result: ClaimResult = { moved: false, path: 'queue/2026-10-20-never-lead-anywhere.md', from: 'tt-never-lead-anywhere' };
  const deps: Partial<Deps> = {
    moduleFor: (p) => opts.modules?.[p] as PlatformModule | undefined,
    findItem: (slug) => ('item' in opts ? opts.item : slug === 'never-lead-anywhere' ? item() : undefined),
    claim:
      opts.claim ??
      ((...args) => {
        claims.push(args);
        return result;
      }),
    now: () => NOW,
    log: (l) => out.push(l),
    error: (l) => err.push(l),
    // what npm left behind: nothing, unless a test says so, whatever process.env holds
    env: opts.env ?? {},
  };
  return { deps, out, err, claims };
}

test('parseArgs: positional, --at, --dry; a wrong call is a reason', () => {
  assert.deepEqual(parseArgs(['tiktok', 'slug', '7312', '--at', '2026-10-21T08:00:00Z', '--dry']), {
    platform: 'tiktok',
    slug: 'slug',
    urlOrId: '7312',
    at: '2026-10-21T08:00:00Z',
    dry: true,
  });
  assert.match(parseArgs([]) as string, /expected/);
  assert.match(parseArgs(['tiktok', 'slug']) as string, /expected/);
  assert.match(parseArgs(['myspace', 'slug', 'id']) as string, /not a platform/);
  assert.match(parseArgs(['tiktok', 'slug', 'id', '--at']) as string, /--at needs/);
  assert.match(parseArgs(['tiktok', 'slug', 'id', '--at', 'yesterday']) as string, /not a date/);
  assert.match(parseArgs(['tiktok', 'slug', 'id', '--force']) as string, /unknown flag/);
  // a time left behind as a fourth argument is what `npm run posted … --at <iso>` does without the --
  const stray = parseArgs(['tiktok', 'slug', 'id', '2026-10-21T08:00:00Z']) as string;
  assert.match(stray, /npm swallowed --at/);
  assert.match(stray, /put -- after the script name/);
  assert.match(parseArgs(['tiktok', 'slug', 'id', '2026-10-21T08:00:00Z', '--at']) as string, /npm swallowed --at/, 'before the bare --at is judged');
  assert.match(parseArgs(['tiktok', 'slug', 'id', 'extra']) as string, /expected <platform>/);
});

test('a flag npm swallowed is read back from its environment, with one note', async () => {
  // `npm run posted tiktok slug 7312 --dry`: npm (today) rewrites --dry to its own --dry-run, so npm_config_dry_run=true
  const dry = harness({ item: item({ instagram: '1', bluesky: '2', youtube: '3' }), env: { npm_config_dry_run: 'true' } });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', '7312'], dry.deps), 0);
  assert.equal(dry.claims.length, 0, 'a dry run');
  assert.equal(dry.out.filter((l) => l === 'note  put -- after the script name; read --dry from npm').length, 1);
  assert.match(dry.out.join('\n'), /nothing written/);
  // and an npm that keeps --dry as itself, as it says it will one day
  const dry2 = harness({ item: item({ instagram: '1', bluesky: '2', youtube: '3' }), env: { npm_config_dry: 'true' } });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', '7312'], dry2.deps), 0);
  assert.equal(dry2.claims.length, 0);
  assert.equal(dry2.out.filter((l) => l === 'note  put -- after the script name; read --dry from npm').length, 1);

  // `--at=<iso>` arrives with its value
  const at = harness({ env: { npm_config_at: '2026-10-21T18:30:00+11:00', npm_config_dry: 'true' } });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', '7312'], at.deps), 0);
  assert.ok(at.out.includes('note  put -- after the script name; read --dry, --at from npm'), at.out.join('\n'));
  assert.match(at.out.join('\n'), /"at":"2026-10-21T07:30:00.000Z"/);

  // `--at <iso>` arrives as npm_config_at=true with the time pushed into the arguments: refused with the hint, exit 2
  const stray = harness({ env: { npm_config_at: 'true' } });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', '7312', '2026-10-21T08:00:00Z'], stray.deps), 2);
  assert.equal(stray.claims.length, 0);
  assert.match(stray.err.join('\n'), /npm swallowed --at; put -- after the script name/);
  assert.ok(stray.out.includes('note  put -- after the script name; read --at from npm'));

  // npm's own 'false' for a boolean, and an empty value, are nothing
  const none = harness({ env: { npm_config_dry: 'false', npm_config_at: '' } });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', '7312'], none.deps), 0);
  assert.equal(none.claims.length, 1);
  assert.ok(!none.out.some((l) => l.startsWith('note  put --')));
});

test('a TikTok post with no module: the id is the digits after /video/ in the share link, or the bare number; anything else is refused', async () => {
  const url = harness();
  assert.equal(await run(['tiktok', 'never-lead-anywhere', 'https://www.tiktok.com/@wenna/video/7312345678901234567?is_from_webapp=1'], url.deps), 0);
  assert.equal((url.claims[0] as string[])[2], '7312345678901234567');
  assert.match(url.out.join('\n'), /^claim tiktok never-lead-anywhere → 7312345678901234567/m);
  assert.ok(!url.out.some((l) => l.includes('has no module to read a URL')));

  const bare = harness();
  assert.equal(await run(['tiktok', 'never-lead-anywhere', '7312345678901234567'], bare.deps), 0);
  assert.equal((bare.claims[0] as string[])[2], '7312345678901234567');

  const profile = harness();
  assert.equal(await run(['tiktok', 'never-lead-anywhere', 'https://www.tiktok.com/@wenna'], profile.deps), 1);
  assert.equal(profile.claims.length, 0);
  assert.match(profile.err.join('\n'), /tiktok: cannot read a video id from "https:\/\/www.tiktok.com\/@wenna"; paste the video's link \(…\/video\/<digits>\) or its numeric id/);
});

test('a wrong call prints the usage and exits 2 without touching the deps', async () => {
  const h = harness();
  assert.equal(await run(['tiktok'], h.deps), 2);
  assert.match(h.err.join('\n'), /usage: npm run posted/);
  assert.equal(h.claims.length, 0);
});

test('an unknown slug is named and exits 1', async () => {
  const h = harness();
  assert.equal(await run(['tiktok', 'nope', '7312'], h.deps), 1);
  assert.match(h.err.join('\n'), /slug "nope"/);
  assert.equal(h.claims.length, 0);
});

test('the module parses the id and gives the posted time; the claim is written by: hand', async () => {
  const seen: string[] = [];
  const h = harness({
    modules: {
      youtube: {
        platform: 'youtube',
        parseId: async (u) => {
          seen.push(u);
          return 'kHK05hfvqj4';
        },
        postedAt: async (id) => (id === 'kHK05hfvqj4' ? '2026-10-21T06:44:45.000Z' : undefined),
      },
    },
  });
  assert.equal(await run(['youtube', 'never-lead-anywhere', 'https://youtube.com/shorts/kHK05hfvqj4'], h.deps), 0);
  assert.deepEqual(seen, ['https://youtube.com/shorts/kHK05hfvqj4']);
  assert.equal(h.claims.length, 1);
  const [it, platform, id, at] = h.claims[0] as [QueueItem, string, string, string];
  assert.equal(it.fm.slug, 'never-lead-anywhere');
  assert.equal(platform, 'youtube');
  assert.equal(id, 'kHK05hfvqj4');
  assert.equal(at, '2026-10-21T06:44:45.000Z');
  const text = h.out.join('\n');
  assert.match(text, /"by":"hand"/);
  assert.match(text, /"kind":"posted"/);
  assert.match(text, /"date":"2026-10-21"/);
  assert.match(text, /tag: {4}tt-never-lead-anywhere/);
  assert.doesNotMatch(text, /recording now/);
});

test('--at wins over the module, and is normalised to ISO', async () => {
  const h = harness({ modules: { youtube: { platform: 'youtube', postedAt: async () => '2026-01-01T00:00:00.000Z' } } });
  assert.equal(await run(['youtube', 'never-lead-anywhere', 'abc', '--at', '2026-10-21T18:30:00+11:00'], h.deps), 0);
  assert.equal((h.claims[0] as string[])[3], '2026-10-21T07:30:00.000Z');
});

test('no --at and no module: the id is the argument, the time is now, and it says so', async () => {
  const h = harness();
  assert.equal(await run(['reddit', 'never-lead-anywhere', 'https://reddit.com/r/x/comments/abc/'], h.deps), 0);
  const [, platform, id, at] = h.claims[0] as [QueueItem, string, string, string];
  assert.equal(platform, 'reddit');
  assert.equal(id, 'https://reddit.com/r/x/comments/abc/');
  assert.equal(at, NOW.toISOString());
  assert.ok(h.out.includes('note  reddit has no module to read a URL; recording "https://reddit.com/r/x/comments/abc/" as the id'), h.out.join('\n'));
  assert.match(h.out.join('\n'), /no --at and reddit cannot say when it was posted; recording now/);
  assert.ok(h.out.indexOf('note  reddit has no module to read a URL; recording "https://reddit.com/r/x/comments/abc/" as the id') < h.out.findIndex((l) => l.startsWith('claim ')), 'before the claim');
});

test('a module whose postedAt comes back empty falls through to now', async () => {
  const h = harness({ modules: { tiktok: { platform: 'tiktok', postedAt: async () => undefined } } });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', '7312'], h.deps), 0);
  assert.equal((h.claims[0] as string[])[3], NOW.toISOString());
  assert.match(h.out.join('\n'), /recording now/);
});

test('a URL the module cannot read exits 1 before any claim', async () => {
  const h = harness({
    modules: {
      youtube: {
        platform: 'youtube',
        parseId: async () => {
          throw new Error('no video id in that');
        },
      },
    },
  });
  assert.equal(await run(['youtube', 'never-lead-anywhere', 'https://example.com'], h.deps), 1);
  assert.match(h.err.join('\n'), /cannot read an id from "https:\/\/example.com": no video id/);
  assert.equal(h.claims.length, 0);
});

test('--dry prints the row, the tag and the move, and never calls claim', async () => {
  const h = harness({ item: item({ instagram: '1', bluesky: '2', youtube: '3' }) });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', '7312', '--at', '2026-10-21T08:00:00Z', '--dry'], h.deps), 0);
  assert.equal(h.claims.length, 0);
  const text = h.out.join('\n');
  assert.match(text, /^dry {3}tiktok never-lead-anywhere → 7312/m);
  assert.match(text, /"id":"7312"/);
  assert.match(text, /"kind":"posted"/); // a hand claim is a post, TikTok included; claim.ts writes the same
  assert.match(text, /"from":"tt-never-lead-anywhere"/);
  assert.match(text, /would move to published\//);
  assert.match(text, /nothing written/);
});

test('--dry says the file stays when another scriptable platform is still open', async () => {
  const h = harness({ item: item({ instagram: '1' }) });
  await run(['tiktok', 'never-lead-anywhere', '7312', '--dry'], h.deps);
  assert.match(h.out.join('\n'), /would stay where it is/);
});

test('an existing id on the platform is noted, and the claim result is what is printed', async () => {
  const h = harness({
    item: item({ youtube: 'old' }),
    claim: () => ({ moved: true, path: 'published/2026-10-20-never-lead-anywhere.md', from: 'yt-never-lead-anywhere' }),
  });
  assert.equal(await run(['youtube', 'never-lead-anywhere', 'abc'], h.deps), 0);
  const text = h.out.join('\n');
  assert.match(text, /already has youtube: "old"; a claim refuses a second id/);
  assert.match(text, /published\/2026-10-20-never-lead-anywhere.md \(moved to published\/\)/);
  assert.doesNotMatch(text, /is replaced/);
});

test('a TikTok draft the founder posted: the note says a draft is replaced, and the claim line says which one was', async () => {
  const h = harness({
    item: item({ tiktok: 'v_pub_url~v2.123', instagram: '1', bluesky: '2', youtube: '3' }),
    claim: () => ({ moved: false, path: 'published/2026-10-20-never-lead-anywhere.md', from: 'tt-never-lead-anywhere', replaced: 'v_pub_url~v2.123' }),
  });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', '7312', '--at', '2026-10-21T08:00:00Z'], h.deps), 0);
  const text = h.out.join('\n');
  assert.match(text, /note {2}queue\/2026-10-20-never-lead-anywhere.md already has tiktok: "v_pub_url~v2.123"; the publisher's draft is replaced, anything else refuses a second id/);
  assert.match(text, /^claim tiktok never-lead-anywhere → 7312 \(the draft v_pub_url~v2.123 is replaced; its row stays in the ledger\)$/m);
  assert.match(text, /"kind":"posted"/);
  assert.match(text, /stays until every platform is done/);
});

test('a claim that throws is a FAIL line and exit 1', async () => {
  const h = harness({
    claim: () => {
      throw new Error('already in ledger');
    },
  });
  assert.equal(await run(['tiktok', 'never-lead-anywhere', '7312'], h.deps), 1);
  assert.match(h.err.join('\n'), /FAIL {2}tiktok never-lead-anywhere: already in ledger/);
});

test('wouldMove: reddit never counts, tiktok does, and the platform being claimed counts as done', () => {
  assert.equal(wouldMove(item({ instagram: '1', bluesky: '2', youtube: '3' }), 'tiktok'), true);
  assert.equal(wouldMove(item({ instagram: '1', bluesky: '2' }), 'tiktok'), false);
  assert.equal(wouldMove(item({ instagram: '1', bluesky: '2', youtube: '3', tiktok: '4' }), 'reddit'), true);
});
