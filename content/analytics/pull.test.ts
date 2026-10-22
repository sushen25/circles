/**
 * runPull() against a temp queue, ledger and analytics folder, with fake
 * platform modules built here: rows land with age_days from the ledger,
 * --series takes only the young post, an unconfigured platform is skipped
 * with its reason, a failing platform makes the exit code 1 while the other
 * platform's row still lands, auto-claim writes the id and the ledger row
 * from a recent() post carrying the tag, a module that declines a call
 * (Unreadable, NotConfigured) is a skip and never a failure, an expiring
 * token fails the run after the rows are written (the token's expiry only
 * beside its token, by the boundary metrics.ts owns), and --dry writes
 * nothing. fetch is stubbed to throw, so nothing here can reach the
 * network, and the env the pull reads is handed in, never process.env.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Platform } from '../lib/queue.ts';
import { readLedger } from '../publish/guards.ts';
import { seenKey } from './inbox.ts';
import { readJsonl, type AccountRow, type PostRow, type SeriesRow } from './metrics.ts';
import { clock } from './platforms/http.ts';
import { NotConfigured, Unreadable, type Configured, type PlatformModule } from './platforms/module.ts';
import { DEFAULT_DIRS, carriesTag, parseFlags, runPull, type Dirs, type Flags } from './pull.ts';

const realFetch = globalThis.fetch;
const realSleep = clock.sleep;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error('no network in tests');
  }) as typeof fetch;
  clock.sleep = async () => {};
});
after(() => {
  globalThis.fetch = realFetch;
  clock.sleep = realSleep;
});

const NOW = new Date('2026-10-21T02:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const SLUG = 'never-lead-anywhere';
const BSKY_ID = 'at://did:plc:x/app.bsky.feed.post/abc';
const IG_ID = '18395365036204751';

function queueFile(slug: string, platforms: string[], published: Record<string, string>, status = 'approved'): string {
  const map = Object.keys(published).length ? `published:\n${Object.entries(published).map(([k, v]) => `  ${k}: "${v}"`).join('\n')}\n` : '';
  return `---
slug: ${slug}
date: 2026-10-20
family: skit
hook: '"Group chats never lead anywhere"'
status: ${status}
platforms: [${platforms.join(', ')}]
publish_at: 2026-10-20T18:00:00+11:00
publish_window_minutes: 90
media: slideshow
${map}---

## bluesky

> the caption
`;
}

type LedgerSeed = { platform: string; id: string; at: string; slug?: string };

function setup(o: { platforms?: string[]; published?: Record<string, string>; ledger?: LedgerSeed[]; more?: { file: string; text: string }[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'content-pull-'));
  const dirs: Dirs = {
    queue: join(dir, 'queue'),
    published: join(dir, 'published'),
    ledger: join(dir, 'publish', 'ledger.jsonl'),
    analytics: join(dir, 'analytics'),
    inbox: join(dir, 'inbox'),
  };
  mkdirSync(dirs.queue);
  mkdirSync(join(dir, 'publish'));
  const queuePath = join(dirs.queue, `2026-10-20-${SLUG}.md`);
  writeFileSync(queuePath, queueFile(SLUG, o.platforms ?? ['bluesky', 'instagram', 'youtube', 'linkedin'], o.published ?? { bluesky: BSKY_ID, instagram: IG_ID }));
  for (const m of o.more ?? []) writeFileSync(join(dirs.queue, m.file), m.text);
  const ledger = o.ledger ?? [
    { platform: 'bluesky', id: BSKY_ID, at: hoursAgo(36) },
    { platform: 'instagram', id: IG_ID, at: hoursAgo(72) },
  ];
  writeFileSync(
    dirs.ledger,
    ledger.map((r) => JSON.stringify({ date: r.at.slice(0, 10), platform: r.platform, slug: r.slug ?? SLUG, id: r.id, at: r.at, from: `${r.platform.slice(0, 2)}-${SLUG}`, kind: 'posted' }) + '\n').join(''),
  );
  const log: string[] = [];
  // `env` is what the pull sees of the environment: nothing unless a test says so, whatever process.env holds.
  const run = (modules: Partial<Record<Platform, PlatformModule>>, flags: Partial<Flags> = {}, env: Record<string, string> = {}) =>
    runPull({ now: NOW, flags: { ...parseFlags([]), ...flags }, dirs, modules, log: (l) => log.push(l), env: (k) => env[k] });
  const paths = {
    posts: join(dirs.analytics, 'posts.jsonl'),
    series: join(dirs.analytics, 'series.jsonl'),
    account: join(dirs.analytics, 'account.jsonl'),
    seen: join(dirs.analytics, 'replies-seen.json'),
    inbox: join(dirs.inbox, '2026-10-21-replies.md'),
  };
  return { dir, dirs, queuePath, log, run, paths };
}

type Fake = Partial<Pick<PlatformModule, 'metrics' | 'replies' | 'account' | 'recent'>> & { configured?: Configured };
function fake(platform: Platform, f: Fake = {}): PlatformModule {
  return {
    platform,
    configured: () => f.configured ?? { ok: true },
    metrics: f.metrics ?? (async (id) => ({ metrics: { likes: 4, reposts: 1, replies: 2, quotes: 0 }, raw: { posts: [{ uri: id, likeCount: 4, repostCount: 1, replyCount: 2, quoteCount: 0 }] } })),
    replies: f.replies ?? (async () => []),
    ...(f.account ? { account: f.account } : {}),
    ...(f.recent ? { recent: f.recent } : {}),
  };
}

const igFake = (extra: Fake = {}) =>
  fake('instagram', {
    metrics: async (id) => ({ metrics: { views: 100, reach: 80, saves: 3, shares: 2 }, raw: { data: [{ name: 'views', values: [{ value: 100 }] }], id } }),
    account: async (day) => ({
      metrics: { followers: 42, reach: 40 },
      breakdowns: { reach_by_follow_type: { follower: 10, non_follower: 30 } },
      raw: { day, data: [] },
    }),
    ...extra,
  });

test('a nightly run: rows with age_days from the ledger, the account row for yesterday, replies to the inbox, one skip line per platform', async () => {
  const t = setup();
  const bsky = fake('bluesky', { replies: async () => [{ id: 'r1', at: hoursAgo(5), text: 'this is my group chat @someone.bsky.social exactly' }] });
  const askedFor: string[] = [];
  const ig = igFake({
    account: async (day) => {
      askedFor.push(day);
      return { metrics: { followers: 42, reach: 40 }, breakdowns: { reach_by_follow_type: { follower: 10, non_follower: 30 } }, raw: { day, data: [] } };
    },
  });
  const s = await t.run({ bluesky: bsky, instagram: ig });

  assert.deepEqual(s, { rows: 2, seriesRows: 0, accountRows: 1, repliesWritten: 1, claims: 0, failures: 0, exitCode: 0 });

  const rows = readJsonl<PostRow>(t.paths.posts);
  assert.equal(rows.length, 2);
  const [b, i] = rows;
  assert.deepEqual(b, {
    date: '2026-10-21',
    at: NOW.toISOString(),
    slug: SLUG,
    family: 'skit',
    platform: 'bluesky',
    id: BSKY_ID,
    from: 'bs-never-lead-anywhere',
    posted_at: hoursAgo(36),
    age_days: 1.5,
    metrics: { likes: 4, reposts: 1, replies: 2, quotes: 0 },
    raw: { posts: [{ uri: BSKY_ID, likeCount: 4, repostCount: 1, replyCount: 2, quoteCount: 0 }] },
  });
  assert.equal(i.platform, 'instagram');
  assert.equal(i.age_days, 3);
  assert.equal(i.from, 'ig-never-lead-anywhere');
  assert.deepEqual(i.raw, { data: [{ name: 'views', values: [{ value: 100 }] }], id: IG_ID });

  // the account row describes yesterday (UTC): the module is asked for that day, and the row is stamped with it; `at` is the pull time
  assert.deepEqual(askedFor, ['2026-10-20']);
  const [acct] = readJsonl<AccountRow>(t.paths.account);
  assert.deepEqual(acct, {
    date: '2026-10-20',
    at: NOW.toISOString(),
    platform: 'instagram',
    metrics: { followers: 42, reach: 40 },
    breakdowns: { reach_by_follow_type: { follower: 10, non_follower: 30 } },
    raw: { day: '2026-10-20', data: [] },
  });

  assert.equal(readFileSync(t.paths.inbox, 'utf8'), `# Replies, 2026-10-21\n\n## ${SLUG} · bluesky\n\n> this is my group chat @… exactly\n`);
  assert.deepEqual(JSON.parse(readFileSync(t.paths.seen, 'utf8')), [seenKey('bluesky', 'r1')], 'a hash, not the id');

  assert.ok(t.log.includes(`row   ${SLUG} bluesky age 1.5d likes 4 reposts 1 replies 2 quotes 0`), t.log.join('\n'));
  assert.ok(t.log.includes(`row   ${SLUG} instagram age 3d views 100 reach 80 saves 3 shares 2`));
  assert.equal(t.log.filter((l) => l === 'skip  linkedin: no module yet').length, 1);
  assert.equal(t.log.filter((l) => l === 'skip  youtube: no module yet').length, 1);
  assert.ok(t.log.includes('acct  instagram: 2 metrics, 1 breakdowns'));
  assert.ok(t.log.includes(`inbox 1 new reply → ${t.paths.inbox}`));
  assert.ok(t.log.at(-1)?.startsWith('done  rows 2, series 0, account 1, replies 1, claims 0, failures 0'));

  // the same night again: the account row is not repeated, the reply is not rewritten, the post rows are (a snapshot each run)
  t.log.length = 0;
  const again = await t.run({ bluesky: bsky, instagram: ig });
  assert.deepEqual(again, { rows: 2, seriesRows: 0, accountRows: 0, repliesWritten: 0, claims: 0, failures: 0, exitCode: 0 });
  assert.ok(t.log.includes('acct  instagram: already have 2026-10-20'));
  assert.deepEqual(askedFor, ['2026-10-20'], 'not asked again');
  assert.ok(t.log.includes('inbox nothing new'));
  assert.equal(readJsonl(t.paths.posts).length, 4);
  assert.equal(readJsonl(t.paths.account).length, 1);
});

test('--series writes only the post under 48 hours, as a series row, and nothing else', async () => {
  const t = setup({ ledger: [{ platform: 'bluesky', id: BSKY_ID, at: hoursAgo(10) }, { platform: 'instagram', id: IG_ID, at: hoursAgo(72) }] });
  let accountCalls = 0;
  const s = await t.run({ bluesky: fake('bluesky'), instagram: igFake({ account: async () => { accountCalls++; throw new Error('not in series mode'); } }) }, { series: true });
  assert.deepEqual(s, { rows: 0, seriesRows: 1, accountRows: 0, repliesWritten: 0, claims: 0, failures: 0, exitCode: 0 });
  const rows = readJsonl<SeriesRow>(t.paths.series);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'bluesky');
  assert.equal(rows[0].age_hours, 10);
  assert.equal(rows[0].age_days, 0.42);
  assert.equal(rows[0].posted_at, hoursAgo(10));
  assert.ok(!existsSync(t.paths.posts));
  assert.ok(!existsSync(t.paths.account));
  assert.ok(!existsSync(t.paths.inbox));
  assert.equal(accountCalls, 0);
  assert.ok(t.log.includes(`row   ${SLUG} bluesky age 10h likes 4 reposts 1 replies 2 quotes 0`));

  // nothing young: say so and stop before any module is asked anything
  const old = setup({ ledger: [{ platform: 'bluesky', id: BSKY_ID, at: hoursAgo(48) }, { platform: 'instagram', id: IG_ID, at: hoursAgo(72) }] });
  const none = await old.run({ bluesky: fake('bluesky', { metrics: async () => { throw new Error('should not be called'); } }) }, { series: true });
  assert.deepEqual(none, { rows: 0, seriesRows: 0, accountRows: 0, repliesWritten: 0, claims: 0, failures: 0, exitCode: 0 });
  assert.deepEqual(old.log, ['nothing under 48 hours']);
  assert.ok(!existsSync(old.paths.series));
});

test('a platform that is not configured is skipped once, with the reason, and never called', async () => {
  const t = setup();
  let igCalls = 0;
  const ig = igFake({
    configured: { ok: false, reason: 'IG_ACCESS_TOKEN unset' },
    metrics: async () => { igCalls++; throw new Error('must not be called'); },
    account: async () => { igCalls++; throw new Error('must not be called'); },
  });
  const s = await t.run({ bluesky: fake('bluesky'), instagram: ig });
  assert.equal(s.exitCode, 0);
  assert.equal(s.rows, 1);
  assert.equal(s.accountRows, 0);
  assert.equal(igCalls, 0);
  assert.equal(t.log.filter((l) => l === 'skip  instagram: not configured (IG_ACCESS_TOKEN unset)').length, 1);
  assert.deepEqual(readJsonl<PostRow>(t.paths.posts).map((r) => r.platform), ['bluesky']);
});

test('an account answer with no number in it is a failure, not a row', async () => {
  const t = setup();
  const s = await t.run({
    bluesky: fake('bluesky', { account: async () => ({ metrics: { followers: 3 }, breakdowns: {}, raw: { profile: { followersCount: 3 } } }) }),
    instagram: igFake({
      account: async () => ({ metrics: {}, breakdowns: {}, raw: { errors: { reach_views_follow: '400 https://graph.instagram.com/v21.0/1/insights?access_token=…: Cannot parse access token' } } }),
    }),
  });
  assert.equal(s.exitCode, 0, 'the posts were read; only the account row is missing');
  assert.equal(s.accountRows, 1, "bluesky's row still lands");
  assert.equal(s.failures, 1);
  assert.ok(t.log.includes('FAIL  account instagram: nothing readable (400 https://graph.instagram.com/v21.0/1/insights?access_token=…: Cannot parse access token)'), t.log.join('\n'));
  assert.deepEqual(readJsonl<AccountRow>(t.paths.account).map((r) => r.platform), ['bluesky']);
});

test('a platform that fails on every post makes the exit code 1; the other platform still lands; a partial failure does not', async () => {
  const t = setup();
  const s = await t.run({
    bluesky: fake('bluesky'),
    instagram: igFake({ metrics: async () => { throw new Error('500 https://graph.facebook.com/v21.0/x/insights?access_token=…: boom'); } }),
  });
  assert.equal(s.exitCode, 1);
  assert.equal(s.failures, 1);
  assert.equal(s.rows, 1);
  assert.equal(s.accountRows, 1, 'the account call is separate from the post calls');
  assert.ok(t.log.includes(`FAIL  ${SLUG} instagram: 500 https://graph.facebook.com/v21.0/x/insights?access_token=…: boom`));
  assert.ok(t.log.includes('FAIL  instagram: failed on every post it had'));
  assert.ok(t.log.at(-1)?.endsWith('; exit 1'));
  assert.deepEqual(readJsonl<PostRow>(t.paths.posts).map((r) => r.platform), ['bluesky']);

  // two bluesky posts, one of them bad: printed, counted, exit 0
  const u = setup({
    more: [{ file: '2026-10-17-only-moves.md', text: queueFile('only-moves', ['bluesky'], { bluesky: 'at://did:plc:x/app.bsky.feed.post/bad' }) }],
    ledger: [{ platform: 'bluesky', id: BSKY_ID, at: hoursAgo(36) }, { platform: 'bluesky', id: 'at://did:plc:x/app.bsky.feed.post/bad', at: hoursAgo(90), slug: 'only-moves' }],
  });
  const partial = await u.run({
    bluesky: fake('bluesky', { metrics: async (id) => { if (id.endsWith('/bad')) throw new Error('404 not found'); return { metrics: { likes: 1 }, raw: {} }; } }),
  });
  assert.equal(partial.exitCode, 0);
  assert.equal(partial.failures, 1);
  assert.equal(partial.rows, 1);
  assert.ok(u.log.includes('FAIL  only-moves bluesky: 404 not found'));
});

test('auto-claim writes the id and a by-hand ledger row from the recent() post carrying the tag, then pulls its row', async () => {
  const t = setup({ platforms: ['bluesky', 'instagram', 'youtube'] });
  let recentCalls = 0;
  const yt = fake('youtube', {
    metrics: async (id) => ({ metrics: { views: 12, likes: 1, comments: 0 }, raw: { items: [{ id, statistics: { viewCount: '12' } }] } }),
    recent: async () => {
      recentCalls++;
      return [
        { id: 'decoy', at: hoursAgo(1), text: 'another piece wenna.app/?from=yt-never-lead-anywhere-again' },
        { id: 'kHK05hfvqj4', at: '2026-10-20T07:44:45.414Z', text: 'Group chats never lead anywhere. wenna.app/?from=yt-never-lead-anywhere #shorts' },
        { id: 'older', at: hoursAgo(200), text: 'wenna.app/?from=yt-never-lead-anywhere' },
      ];
    },
  });
  const s = await t.run({ bluesky: fake('bluesky'), instagram: igFake(), youtube: yt });
  assert.equal(s.claims, 1);
  assert.equal(s.rows, 3);
  assert.equal(s.exitCode, 0);
  assert.equal(recentCalls, 1);
  assert.ok(t.log.includes(`claim ${SLUG} → youtube: kHK05hfvqj4 (moved to ${t.dirs.published}/)`), t.log.join('\n'));

  // every scriptable platform on the item now has an id, so the file moved
  assert.ok(!existsSync(t.queuePath));
  const moved = readFileSync(join(t.dirs.published, `2026-10-20-${SLUG}.md`), 'utf8');
  assert.match(moved, /^status: published$/m);
  assert.match(moved, /^  youtube: "kHK05hfvqj4"$/m);
  assert.match(moved, /^  bluesky: "at:\/\//m);

  const ledger = readLedger(t.dirs.ledger) as (ReturnType<typeof readLedger>[number] & { by?: string })[];
  assert.equal(ledger.length, 3);
  assert.deepEqual(ledger[2], { date: '2026-10-20', platform: 'youtube', slug: SLUG, id: 'kHK05hfvqj4', at: '2026-10-20T07:44:45.414Z', from: 'yt-never-lead-anywhere', kind: 'posted', by: 'hand' });

  const rows = readJsonl<PostRow>(t.paths.posts);
  const ytRow = rows.find((r) => r.platform === 'youtube');
  assert.ok(ytRow);
  assert.equal(ytRow.posted_at, '2026-10-20T07:44:45.414Z', 'the platform time from the new ledger row');
  assert.equal(ytRow.age_days, 0.76);
  assert.equal(ytRow.from, 'yt-never-lead-anywhere');

  // a second night: nothing left to claim, recent() is not asked, and the file is read from published/
  t.log.length = 0;
  const night2 = await t.run({ bluesky: fake('bluesky'), instagram: igFake(), youtube: yt });
  assert.equal(night2.claims, 0);
  assert.equal(night2.rows, 3);
  assert.equal(recentCalls, 1);
});

test('a TikTok draft the founder then posted has two ledger rows; the post is aged from the posted one', async () => {
  const draftAt = hoursAgo(50);
  const postedAt = hoursAgo(10);
  const t = setup({
    platforms: ['tiktok', 'bluesky'],
    published: { tiktok: '7312345678901234567', bluesky: BSKY_ID },
    ledger: [{ platform: 'bluesky', id: BSKY_ID, at: hoursAgo(36) }, { platform: 'tiktok', id: 'v_pub_url~v2.1', at: draftAt }, { platform: 'tiktok', id: '7312345678901234567', at: postedAt }],
  });
  // the seed writes every row as posted; make the draft's row what publish.ts writes
  const rows = readFileSync(t.dirs.ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  rows[1].kind = 'drafted';
  rows[2].by = 'hand';
  writeFileSync(t.dirs.ledger, rows.map((r) => JSON.stringify(r) + '\n').join(''));

  const tiktok = fake('tiktok', { metrics: async (id) => ({ metrics: { views: 9 }, raw: { id } }) });
  const s = await t.run({ bluesky: fake('bluesky'), tiktok });
  assert.equal(s.rows, 2);
  const tt = readJsonl<PostRow>(t.paths.posts).find((r) => r.platform === 'tiktok');
  assert.ok(tt);
  assert.equal(tt.id, '7312345678901234567');
  assert.equal(tt.posted_at, postedAt);
  assert.equal(tt.age_days, 0.42);
});

test('--no-claim leaves a claimable post alone, and a failing recent() is printed without stopping the run', async () => {
  const t = setup({ platforms: ['bluesky', 'instagram', 'youtube'] });
  const good = fake('youtube', { recent: async () => [{ id: 'kHK05hfvqj4', at: hoursAgo(3), text: 'wenna.app/?from=yt-never-lead-anywhere' }] });
  const s = await t.run({ bluesky: fake('bluesky'), instagram: igFake(), youtube: good }, { claim: false });
  assert.equal(s.claims, 0);
  assert.equal(s.rows, 2);
  assert.ok(existsSync(t.queuePath));
  assert.equal(readLedger(t.dirs.ledger).length, 2);

  const broken = fake('youtube', { recent: async () => { throw new Error('403 quota'); } });
  const s2 = await t.run({ bluesky: fake('bluesky'), instagram: igFake(), youtube: broken });
  assert.equal(s2.claims, 0);
  assert.equal(s2.rows, 2);
  assert.equal(s2.exitCode, 0);
  assert.equal(s2.failures, 1);
  assert.ok(t.log.includes('FAIL  recent youtube: 403 quota'));
});

test('an Instagram token inside seven days of expiry makes the exit code 1 after the rows are written', async () => {
  const t = setup();
  const ig = { IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: '2026-10-22' };
  const s = await t.run({ bluesky: fake('bluesky'), instagram: igFake() }, {}, ig);
  assert.equal(s.exitCode, 1);
  assert.equal(s.rows, 2);
  assert.equal(s.failures, 0);
  assert.equal(readJsonl(t.paths.posts).length, 2);
  assert.equal(readJsonl(t.paths.account).length, 1);
  const expiring = t.log.indexOf('EXPIRING Instagram token: 0 days (2026-10-22); run npm run tokens');
  assert.ok(expiring > -1, t.log.join('\n'));
  assert.ok(expiring > t.log.findIndex((l) => l.startsWith('acct  ')), 'after everything else');
  assert.equal(t.log.length - 1, expiring + 1, 'only the summary line follows it');
  assert.ok(!t.log.some((l) => l.includes('IGAAx')), 'the token is never printed');

  // the two-hourly run does not nag about it
  const series = setup({ ledger: [{ platform: 'bluesky', id: BSKY_ID, at: hoursAgo(10) }] });
  const s2 = await series.run({ bluesky: fake('bluesky') }, { series: true }, ig);
  assert.equal(s2.exitCode, 0);
  assert.ok(!series.log.some((l) => l.startsWith('EXPIRING')));

  // the boundary is the one metrics.ts owns: seven days fails, eight does not (NOW is 02:00 UTC, so the times match it)
  const seven = setup();
  const s7 = await seven.run({ bluesky: fake('bluesky') }, {}, { THREADS_ACCESS_TOKEN: 'THx', THREADS_TOKEN_EXPIRES: '2026-10-28T02:00:00Z' });
  assert.equal(s7.exitCode, 1);
  assert.ok(seven.log.includes('EXPIRING Threads token: 7 days (2026-10-28T02:00:00Z); run npm run tokens'), seven.log.join('\n'));
  const eight = setup();
  const s8 = await eight.run({ bluesky: fake('bluesky') }, {}, { THREADS_ACCESS_TOKEN: 'THx', THREADS_TOKEN_EXPIRES: '2026-10-29T02:00:00Z' });
  assert.equal(s8.exitCode, 0);
  assert.ok(!eight.log.some((l) => l.startsWith('EXPIRING')));

  // a value that is not a date fails too, naming the variable
  const bad = setup();
  const s9 = await bad.run({ bluesky: fake('bluesky') }, {}, { IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: 'soon' });
  assert.equal(s9.exitCode, 1);
  assert.ok(bad.log.includes('EXPIRING Instagram token: IG_TOKEN_EXPIRES is not a date (soon); run npm run tokens'));
});

test('the expiry is checked only beside its token: an expiry alone is ignored, a token alone is one note, and --only checks one platform', async () => {
  // the expiry variable without the token: the platform is off, so there is nothing to warn about
  const off = setup();
  const s1 = await off.run({ bluesky: fake('bluesky') }, {}, { IG_TOKEN_EXPIRES: '2026-10-22', THREADS_TOKEN_EXPIRES: '2026-10-22' });
  assert.equal(s1.exitCode, 0);
  assert.ok(!off.log.some((l) => l.startsWith('EXPIRING') || l.startsWith('note  ')), off.log.join('\n'));

  // the token without its expiry: one note, the exit code untouched
  const unset = setup();
  const s2 = await unset.run({ bluesky: fake('bluesky') }, {}, { IG_ACCESS_TOKEN: 'IGAAx', THREADS_ACCESS_TOKEN: 'THx', THREADS_TOKEN_EXPIRES: '2026-12-20' });
  assert.equal(s2.exitCode, 0);
  assert.equal(unset.log.filter((l) => l === 'note  Instagram token: IG_TOKEN_EXPIRES unset; run npm run tokens -- --github').length, 1);
  assert.ok(!unset.log.some((l) => l.startsWith('note  Threads')));

  // --only bluesky leaves the Meta tokens alone; --only instagram checks that one
  const both = { IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: '2026-10-22', THREADS_ACCESS_TOKEN: 'THx', THREADS_TOKEN_EXPIRES: '2026-10-22' };
  const only = setup();
  const s3 = await only.run({ bluesky: fake('bluesky'), instagram: igFake() }, { only: 'bluesky' }, both);
  assert.equal(s3.exitCode, 0);
  assert.ok(!only.log.some((l) => l.startsWith('EXPIRING')));
  const onlyIg = setup();
  const s4 = await onlyIg.run({ bluesky: fake('bluesky'), instagram: igFake() }, { only: 'instagram' }, both);
  assert.equal(s4.exitCode, 1);
  assert.ok(onlyIg.log.some((l) => l.startsWith('EXPIRING Instagram')));
  assert.ok(!onlyIg.log.some((l) => l.startsWith('EXPIRING Threads')));
});

test('a module that says Unreadable or NotConfigured is a skip line, not a failure: exit 0, the tally untouched, the other platform lands', async () => {
  const t = setup({
    platforms: ['bluesky', 'youtube', 'instagram'],
    published: { bluesky: BSKY_ID, youtube: 'kHK05hfvqj4' },
    ledger: [{ platform: 'bluesky', id: BSKY_ID, at: hoursAgo(36) }, { platform: 'youtube', id: 'kHK05hfvqj4', at: hoursAgo(20) }],
  });
  const bsky = fake('bluesky', {
    replies: async () => { throw new NotConfigured("BSKY_HANDLE unset; the account's own replies cannot be told apart"); },
    account: async () => { throw new NotConfigured('BSKY_HANDLE unset'); },
  });
  const yt = fake('youtube', { metrics: async () => { throw new Unreadable('private video; an API key reads public videos only'); } });
  const ig = igFake({ recent: async () => { throw new NotConfigured('IG_USER_ID unset'); } });
  const s = await t.run({ bluesky: bsky, youtube: yt, instagram: ig });
  assert.deepEqual(s, { rows: 1, seriesRows: 0, accountRows: 1, repliesWritten: 0, claims: 0, failures: 0, exitCode: 0 });
  assert.ok(!t.log.some((l) => l.startsWith('FAIL')), t.log.join('\n'));
  assert.ok(t.log.includes(`skip  ${SLUG} youtube: private video; an API key reads public videos only`));
  assert.ok(t.log.includes(`skip  ${SLUG} bluesky: BSKY_HANDLE unset; the account's own replies cannot be told apart`));
  assert.equal(t.log.filter((l) => l === 'skip  bluesky: BSKY_HANDLE unset').length, 1);
  assert.equal(t.log.filter((l) => l === 'skip  instagram: IG_USER_ID unset').length, 1);
  assert.deepEqual(readJsonl<PostRow>(t.paths.posts).map((r) => r.platform), ['bluesky']);
  assert.deepEqual(readJsonl<AccountRow>(t.paths.account).map((r) => r.platform), ['instagram']);
  assert.ok(t.log.at(-1)?.startsWith('done  rows 1, series 0, account 1, replies 0, claims 0, failures 0'));
  assert.ok(!t.log.at(-1)?.endsWith('exit 1'));

  // the two-hourly run skips the same way
  const u = setup({ platforms: ['youtube'], published: { youtube: 'kHK05hfvqj4' }, ledger: [{ platform: 'youtube', id: 'kHK05hfvqj4', at: hoursAgo(20) }] });
  const s2 = await u.run({ youtube: yt }, { series: true });
  assert.deepEqual(s2, { rows: 0, seriesRows: 0, accountRows: 0, repliesWritten: 0, claims: 0, failures: 0, exitCode: 0 });
  assert.ok(u.log.includes(`skip  ${SLUG} youtube: private video; an API key reads public videos only`));
  assert.ok(!existsSync(u.paths.series));

  // an ordinary error on the same calls is still a failure
  const v = setup({ platforms: ['bluesky', 'youtube'], published: { youtube: 'kHK05hfvqj4' }, ledger: [{ platform: 'youtube', id: 'kHK05hfvqj4', at: hoursAgo(20) }] });
  const s3 = await v.run({ youtube: fake('youtube', { metrics: async () => { throw new Error('403 quota'); } }) });
  assert.equal(s3.exitCode, 1);
  assert.equal(s3.failures, 1);
});

test('an account answer that names its own day is stamped with it, and the check for a row already there runs against that day', async () => {
  const t = setup();
  let calls = 0;
  const bsky = fake('bluesky', {
    account: async () => {
      calls++;
      return { metrics: { followers: 12 }, breakdowns: {}, raw: { followersCount: 12 }, day: '2026-10-21' };
    },
  });
  const s = await t.run({ bluesky: bsky });
  assert.equal(s.accountRows, 1);
  const [row] = readJsonl<AccountRow>(t.paths.account);
  assert.equal(row.date, '2026-10-21', 'today, as the module said, not yesterday');
  assert.equal(row.at, NOW.toISOString());
  assert.deepEqual(row.metrics, { followers: 12 });
  assert.ok(t.log.includes('acct  bluesky: 1 metrics, 0 breakdowns for 2026-10-21'), t.log.join('\n'));

  // the same night again: the module is asked again (cheap for one that reads the account as it stands), then its day is recognised
  t.log.length = 0;
  const again = await t.run({ bluesky: bsky });
  assert.equal(again.accountRows, 0);
  assert.equal(calls, 2);
  assert.ok(t.log.includes('acct  bluesky: already have 2026-10-21'));
  assert.equal(readJsonl(t.paths.account).length, 1);
});

test('--dry makes the calls and writes nothing', async () => {
  const t = setup({ platforms: ['bluesky', 'instagram', 'youtube'] });
  const before = { queue: readFileSync(t.queuePath, 'utf8'), ledger: readFileSync(t.dirs.ledger, 'utf8') };
  const bsky = fake('bluesky', { replies: async () => [{ id: 'r1', at: hoursAgo(5), text: 'a reply' }] });
  const yt = fake('youtube', { recent: async () => [{ id: 'kHK05hfvqj4', at: hoursAgo(3), text: 'wenna.app/?from=yt-never-lead-anywhere' }] });
  const s = await t.run({ bluesky: bsky, instagram: igFake(), youtube: yt }, { dry: true });
  assert.deepEqual(s, { rows: 2, seriesRows: 0, accountRows: 1, repliesWritten: 0, claims: 1, failures: 0, exitCode: 0 });
  assert.ok(!existsSync(t.dirs.analytics));
  assert.ok(!existsSync(t.dirs.inbox));
  assert.ok(!existsSync(t.dirs.published));
  assert.equal(readFileSync(t.queuePath, 'utf8'), before.queue);
  assert.equal(readFileSync(t.dirs.ledger, 'utf8'), before.ledger);
  assert.ok(t.log.includes(`dry   would claim ${SLUG} → youtube: kHK05hfvqj4 (posted ${hoursAgo(3)})`));
  assert.ok(t.log.includes(`dry   would append row ${SLUG} bluesky to ${t.paths.posts}`));
  assert.ok(t.log.includes(`dry   would append account row instagram to ${t.paths.account}`));
  assert.ok(t.log.includes(`dry   1 replies fetched; the unseen ones would go to ${t.paths.inbox}`));
  assert.ok(t.log.at(-1)?.endsWith('(dry run, nothing written)'));
});

test('--only limits every step to one platform, silently', async () => {
  const t = setup({ platforms: ['bluesky', 'instagram', 'youtube'] });
  let ytRecent = 0;
  const yt = fake('youtube', { recent: async () => { ytRecent++; return []; } });
  const s = await t.run({ bluesky: fake('bluesky'), instagram: igFake(), youtube: yt }, { only: 'bluesky' });
  assert.deepEqual(s, { rows: 1, seriesRows: 0, accountRows: 0, repliesWritten: 0, claims: 0, failures: 0, exitCode: 0 });
  assert.equal(ytRecent, 0);
  assert.ok(!t.log.some((l) => l.startsWith('skip  ')), t.log.join('\n'));
});

test('parseFlags and carriesTag', () => {
  assert.deepEqual(parseFlags([]), { series: false, dry: false, replies: true, account: true, claim: true });
  assert.deepEqual(parseFlags(['--series', '--dry', '--no-replies', '--no-account', '--no-claim', '--only', 'youtube']), {
    series: true,
    dry: true,
    replies: false,
    account: false,
    claim: false,
    only: 'youtube',
  });
  assert.throws(() => parseFlags(['--only']), /--only needs a platform/);
  assert.throws(() => parseFlags(['--only', 'myspace']), /--only needs a platform/);
  assert.throws(() => parseFlags(['--dry-run']), /unknown flag --dry-run/);
  assert.deepEqual(DEFAULT_DIRS, { queue: 'queue', published: 'published', ledger: 'publish/ledger.jsonl', analytics: 'analytics', inbox: 'inbox' });

  assert.equal(carriesTag('see wenna.app/?from=yt-only-moves #shorts', 'yt-only-moves'), true);
  assert.equal(carriesTag('see wenna.app/?from=yt-only-moves', 'yt-only-moves'), true);
  assert.equal(carriesTag('see wenna.app/?from=yt-only-moves-again', 'yt-only-moves'), false);
  assert.equal(carriesTag('see wenna.app', 'yt-only-moves'), false);
});

test('the nightly run writes a features row for a published piece, once; --series and --only do not', async () => {
  const t = setup();
  const skit = '\n```json\n{ "hook": "h", "slides": [ { "type": "cover", "line1": "a" }, { "type": "end", "line": "b", "url": "wenna.app" } ] }\n```\n';
  writeFileSync(t.queuePath, readFileSync(t.queuePath, 'utf8') + skit);
  const features = join(t.dirs.analytics, 'features.jsonl');

  await t.run({ bluesky: fake('bluesky') }, { series: true });
  await t.run({ bluesky: fake('bluesky') }, { only: 'bluesky' });
  assert.equal(existsSync(features), false);

  await t.run({ bluesky: fake('bluesky') });
  await t.run({ bluesky: fake('bluesky') });
  const rows = readJsonl<{ slug: string; posted: Record<string, unknown> }>(features);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slug, SLUG);
  assert.deepEqual(Object.keys(rows[0].posted).sort(), ['bluesky', 'instagram']);
  assert.ok(t.log.includes(`feat  ${SLUG} (no timing yet)`));
});

// ---- the Wenna funnel (platforms/wenna.ts, ADR 0087) ----

const FUNNEL_ENV = { WENNA_FUNNEL_URL: 'https://wenna.test/functions/v1/content-funnel', CONTENT_FUNNEL_SECRET: 'the-secret' };
const EXPORT = {
  since: '2026-10-19',
  by_source_ref: {
    'bs-never-lead-anywhere': { counters: { circles_created: 2, answers: 3 }, events: { plan_shared: 1 } },
  },
  stalled: [{ week: '2026-10-19', cohort: 'external', source: 'content', state: 'not_shared', circles: 1, oldest_hours: 30, median_hours: 30 }],
};

test('the funnel: not configured is a skip line and writes nothing', async () => {
  const t = setup();
  const s = await t.run({ bluesky: fake('bluesky') });
  assert.equal(s.exitCode, 0);
  assert.ok(t.log.includes('skip  wenna: not configured (WENNA_FUNNEL_URL, CONTENT_FUNNEL_SECRET unset)'), t.log.join('\n'));
  assert.equal(existsSync(join(t.dirs.analytics, 'funnel.jsonl')), false);
});

test('the funnel: one row per tag and one stalled row, asked from the first post, once a night', async () => {
  const t = setup();
  const asked: { url: string; body: unknown; auth: string }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    asked.push({ url: String(url), body: JSON.parse(String(init!.body)), auth: (init!.headers as Record<string, string>).authorization });
    return new Response(JSON.stringify(EXPORT));
  };
  const run = () => runPull({ now: NOW, flags: parseFlags([]), dirs: t.dirs, modules: { bluesky: fake('bluesky') }, log: (l) => t.log.push(l), env: (k) => (FUNNEL_ENV as Record<string, string>)[k], fetch: fetcher });

  const s = await run();
  assert.equal(s.exitCode, 0);
  assert.deepEqual(asked, [{ url: FUNNEL_ENV.WENNA_FUNNEL_URL, body: { since: '2026-10-18' }, auth: 'Bearer the-secret' }]);
  const rows = readJsonl<Record<string, unknown>>(join(t.dirs.analytics, 'funnel.jsonl'));
  assert.deepEqual(rows, [
    { date: '2026-10-21', at: NOW.toISOString(), from: 'bs-never-lead-anywhere', circles: 2, plans_shared: 1, answered: 3, confirmed: 0, raw: EXPORT.by_source_ref['bs-never-lead-anywhere'] },
    { date: '2026-10-21', at: NOW.toISOString(), stalled: EXPORT.stalled },
  ]);
  assert.ok(t.log.includes('funnel bs-never-lead-anywhere: circles 2, plans shared 1, answered 3, confirmed 0'), t.log.join('\n'));
  assert.equal(JSON.stringify(t.log).includes('the-secret'), false, 'the secret is in no log line');

  await run();
  assert.equal(asked.length, 1, 'not asked again the same day');
  assert.equal(readJsonl(join(t.dirs.analytics, 'funnel.jsonl')).length, 2);
});

test('the funnel: --only wenna reads it and nothing else, and --dry writes nothing', async () => {
  const t = setup();
  const fetcher: typeof fetch = async () => new Response(JSON.stringify(EXPORT));
  const log: string[] = [];
  const modules = { bluesky: fake('bluesky', { metrics: async () => { throw new Error('a platform was asked'); } }) };
  const s = await runPull({ now: NOW, flags: parseFlags(['--only', 'wenna', '--dry']), dirs: t.dirs, modules, log: (l) => log.push(l), env: (k) => (FUNNEL_ENV as Record<string, string>)[k], fetch: fetcher });
  assert.equal(s.failures, 0);
  assert.equal(s.rows, 0);
  assert.ok(log.includes('funnel bs-never-lead-anywhere: circles 2, plans shared 1, answered 3, confirmed 0'), log.join('\n'));
  assert.ok(log.includes('dry   would append funnel row bs-never-lead-anywhere to ' + join(t.dirs.analytics, 'funnel.jsonl')));
  assert.equal(existsSync(join(t.dirs.analytics, 'funnel.jsonl')), false);
  assert.deepEqual(log.filter((l) => /^(row|acct|inbox|skip)/.test(l)), [], log.join('\n'));
});

test('the funnel: a refusal is a failure with exit 1, after the other rows are written', async () => {
  const t = setup();
  const fetcher: typeof fetch = async () => new Response('{"message":"Not something you can call."}', { status: 401 });
  const s = await runPull({ now: NOW, flags: parseFlags([]), dirs: t.dirs, modules: { bluesky: fake('bluesky') }, log: (l) => t.log.push(l), env: (k) => (FUNNEL_ENV as Record<string, string>)[k], fetch: fetcher });
  assert.equal(s.exitCode, 1);
  assert.equal(s.rows, 1);
  assert.ok(t.log.some((l) => l.startsWith('FAIL  funnel: wenna: 401')));
  assert.equal(existsSync(join(t.dirs.analytics, 'funnel.jsonl')), false);
});
