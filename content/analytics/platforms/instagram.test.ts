/**
 * The Instagram module against fixtures, with fetch stubbed: nothing leaves
 * the machine and nothing on disk is touched. Each test says which URLs it
 * expects and what they answer; an unexpected URL fails the test, so a call
 * that should not happen (a POST, a stray host) cannot slip by.
 */
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { clock } from './http.ts';
import { instagram } from './instagram.ts';

const TOKEN = 'IGAAsecretsecretsecret';
const USER = '17841400000000001';

type Call = { url: URL; method: string };
let calls: Call[] = [];
/** Route by path: the first route whose test matches answers. */
let routes: { test: (u: URL, n: number) => boolean; reply: (u: URL) => Response }[] = [];
const realFetch = globalThis.fetch;
const realSleep = clock.sleep;
/** Snapshotted before the first test and restored after the last, so nothing here leaks past the file. */
const savedEnv = { ...process.env };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const graphError = (message: string, status = 400) => json({ error: { message, type: 'OAuthException', code: 100, fbtrace_id: 'x' } }, status);

type Answer = ((u: URL) => Response) | Record<string, unknown>;

function on(path: string | RegExp, reply: Answer, when?: (u: URL, n: number) => boolean) {
  const matches = (u: URL) => (typeof path === 'string' ? u.pathname === path : path.test(u.pathname));
  routes.push({
    test: (u, n) => matches(u) && (!when || when(u, n)),
    reply: typeof reply === 'function' ? reply : () => json(reply),
  });
}

beforeEach(() => {
  calls = [];
  routes = [];
  clock.sleep = async () => {};
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    calls.push({ url, method });
    assert.equal(method, 'GET', 'the module only ever reads');
    const seen = calls.filter((c) => c.url.pathname === url.pathname).length;
    const route = routes.find((r) => r.test(url, seen));
    if (!route) throw new Error(`unexpected fetch ${method} ${url.pathname}?${url.searchParams}`);
    return route.reply(url);
  }) as typeof fetch;
  Object.assign(process.env, { IG_ACCESS_TOKEN: TOKEN, IG_USER_ID: USER });
  delete process.env.IG_GRAPH_HOST;
  delete process.env.IG_API_VERSION;
  delete process.env.IG_TOKEN_EXPIRES;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

after(() => {
  clock.sleep = realSleep;
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

const urlsOf = (path: string | RegExp) =>
  calls.filter((c) => (typeof path === 'string' ? c.url.pathname === path : path.test(c.url.pathname))).map((c) => c.url);

const MEDIA_ID = '18395365036204751';
const reel = {
  id: MEDIA_ID,
  media_type: 'VIDEO',
  media_product_type: 'REELS',
  timestamp: '2026-10-21T06:37:08+0000',
  permalink: 'https://www.instagram.com/reel/DQabc12xYz/',
  like_count: 3,
  comments_count: 2,
};
const insight = (name: string, value: number, shape: 'values' | 'total' = 'values') => ({
  name,
  period: 'lifetime',
  title: name,
  description: name,
  id: `${MEDIA_ID}/insights/${name}/lifetime`,
  ...(shape === 'values' ? { values: [{ value }] } : { total_value: { value } }),
});
const reelInsights = {
  data: [
    insight('views', 33, 'total'),
    insight('reach', 14),
    insight('saved', 2),
    insight('shares', 1),
    insight('likes', 3),
    insight('comments', 2),
    insight('total_interactions', 8),
    insight('ig_reels_avg_watch_time', 11300),
    insight('ig_reels_video_view_total_time', 372900),
    insight('reels_skip_rate', 22.6),
  ],
};

/* ------------------------------------------------------------- configured */

test('configured names what is missing and token() carries the same answer', async () => {
  assert.deepEqual(instagram.configured(), { ok: true });
  delete process.env.IG_USER_ID;
  assert.deepEqual(instagram.configured(), { ok: false, reason: 'IG_USER_ID unset' });
  const state = await instagram.token!();
  assert.equal(state.configured, false);
  assert.equal(state.note, 'IG_USER_ID unset');
  assert.equal(calls.length, 0, 'no call while unconfigured');
});

/* ------------------------------------------------------------------- host */

test('host follows the token the way the publisher does, and IG_GRAPH_HOST and IG_API_VERSION override', async () => {
  on(new RegExp(`/${MEDIA_ID}$`), reel);
  on(new RegExp(`/${MEDIA_ID}/insights$`), reelInsights);
  await instagram.metrics(MEDIA_ID);
  assert.equal(calls[0].url.host, 'graph.instagram.com');
  assert.equal(calls[0].url.pathname, `/v21.0/${MEDIA_ID}`);

  calls = [];
  process.env.IG_ACCESS_TOKEN = 'EAABfacebooklogin';
  await instagram.metrics(MEDIA_ID);
  assert.equal(calls[0].url.host, 'graph.facebook.com');

  calls = [];
  process.env.IG_GRAPH_HOST = 'graph.example.test';
  process.env.IG_API_VERSION = 'v24.0';
  await instagram.metrics(MEDIA_ID);
  assert.equal(calls[0].url.host, 'graph.example.test');
  assert.equal(calls[0].url.pathname, `/v24.0/${MEDIA_ID}`);
});

/* ---------------------------------------------------------------- metrics */

test('metrics: a Reel asks for the Reel set, maps both value shapes, scales ms to s, keeps raw whole', async () => {
  on(new RegExp(`/${MEDIA_ID}$`), reel);
  on(new RegExp(`/${MEDIA_ID}/insights$`), reelInsights);
  const { metrics, raw } = await instagram.metrics(MEDIA_ID);

  const [mediaUrl] = urlsOf(new RegExp(`/${MEDIA_ID}$`));
  assert.equal(mediaUrl.searchParams.get('fields'), 'id,media_type,media_product_type,timestamp,permalink,like_count,comments_count');
  assert.equal(mediaUrl.searchParams.get('access_token'), TOKEN, 'the token travels as a query parameter');
  const [insightsUrl] = urlsOf(new RegExp(`/${MEDIA_ID}/insights$`));
  assert.equal(
    insightsUrl.searchParams.get('metric'),
    'views,reach,saved,shares,likes,comments,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate',
  );

  assert.deepEqual(metrics, {
    views: 33,
    reach: 14,
    saves: 2,
    shares: 1,
    likes: 3,
    comments: 2,
    watch_avg_s: 11.3,
    watch_total_s: 372.9,
    skip_pct: 22.6,
  });
  assert.deepEqual(raw, { media: reel, insights: reelInsights });
});

test('metrics: a feed post asks for the feed set and fills likes and comments from the media when the insight is absent', async () => {
  const feed = { ...reel, media_type: 'IMAGE', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/DQfeed1234/' };
  const feedInsights = { data: [insight('views', 10), insight('reach', 9), insight('saved', 1), insight('shares', 0), insight('follows', 1), insight('profile_visits', 2)] };
  on(new RegExp(`/${MEDIA_ID}$`), feed);
  on(new RegExp(`/${MEDIA_ID}/insights$`), feedInsights);
  const { metrics, raw } = await instagram.metrics(MEDIA_ID);
  const [insightsUrl] = urlsOf(new RegExp(`/${MEDIA_ID}/insights$`));
  assert.equal(insightsUrl.searchParams.get('metric'), 'views,reach,saved,shares,likes,comments,follows,profile_visits');
  assert.deepEqual(metrics, { views: 10, reach: 9, saves: 1, shares: 0, likes: 3, comments: 2 });
  assert.equal((raw as { dropped?: string[] }).dropped, undefined);
});

test('metrics: a refused metric is dropped by name, the call repeated without it, and the drop recorded', async () => {
  on(new RegExp(`/${MEDIA_ID}$`), reel);
  on(
    new RegExp(`/${MEDIA_ID}/insights$`),
    () => graphError('(#100) The following metrics (reels_skip_rate) are not supported for this media product type'),
    (u) => (u.searchParams.get('metric') ?? '').includes('reels_skip_rate'),
  );
  on(new RegExp(`/${MEDIA_ID}/insights$`), { data: reelInsights.data.filter((d) => d.name !== 'reels_skip_rate') });
  const { metrics, raw } = await instagram.metrics(MEDIA_ID);

  const tries = urlsOf(new RegExp(`/${MEDIA_ID}/insights$`));
  assert.equal(tries.length, 2);
  assert.equal(tries[1].searchParams.get('metric'), 'views,reach,saved,shares,likes,comments,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time');
  assert.equal(metrics.skip_pct, undefined);
  assert.equal(metrics.views, 33);
  assert.deepEqual((raw as { dropped: string[] }).dropped, ['reels_skip_rate']);
});

test('metrics: a 400 that names no metric is thrown at once, without a token in it', async () => {
  on(new RegExp(`/${MEDIA_ID}$`), reel);
  on(new RegExp(`/${MEDIA_ID}/insights$`), () => graphError('(#10) Application does not have permission for this action'));
  await assert.rejects(instagram.metrics(MEDIA_ID), (e: Error) => {
    assert.match(e.message, /does not have permission/);
    assert.ok(!e.message.includes(TOKEN), 'no token in the error');
    assert.match(e.message, /access_token=…/);
    return true;
  });
  assert.equal(urlsOf(new RegExp(`/${MEDIA_ID}/insights$`)).length, 1);
});

test('metrics: refusals stop after three drops', async () => {
  on(new RegExp(`/${MEDIA_ID}$`), reel);
  const order = ['reels_skip_rate', 'ig_reels_video_view_total_time', 'ig_reels_avg_watch_time', 'total_interactions'];
  on(new RegExp(`/${MEDIA_ID}/insights$`), (u) => {
    const asked = (u.searchParams.get('metric') ?? '').split(',');
    const name = order.find((m) => asked.includes(m))!;
    return graphError(`(#100) ${name} metric is not supported on this version`);
  });
  await assert.rejects(instagram.metrics(MEDIA_ID), /total_interactions/);
  assert.equal(urlsOf(new RegExp(`/${MEDIA_ID}/insights$`)).length, 4, 'one call and three retries');
});

/* ---------------------------------------------------------------- replies */

const comments = (user: string) => ({
  data: [
    { id: 'c1', text: 'this is literally my group chat', timestamp: '2026-10-21T08:00:00+0000', username: 'someone_else' },
    {
      id: 'c2',
      text: 'thank you for watching',
      timestamp: '2026-10-21T08:05:00+0000',
      username: user,
      replies: {
        data: [
          { id: 'c2r1', text: 'no thank you @wenna.app honestly', timestamp: '2026-10-21T08:06:00+0000', username: 'someone_else' },
          { id: 'c2r2', text: 'glad it landed', timestamp: '2026-10-21T08:07:00+0000', username: user },
        ],
      },
    },
    { id: 'c0', text: 'from before the window', timestamp: '2026-10-20T08:00:00+0000', username: 'early_bird' },
  ],
});

test('replies: author dropped, own comments and own nested replies dropped, nested flattened, since honoured, handles in text untouched', async () => {
  process.env.IG_USER_ID = `${USER}1`;
  on(/\/me$/, { username: 'wennaapp' });
  on(new RegExp(`/${MEDIA_ID}/comments$`), comments('wennaapp'));
  const out = await instagram.replies(MEDIA_ID, '2026-10-21T00:00:00Z');

  const [url] = urlsOf(new RegExp(`/${MEDIA_ID}/comments$`));
  assert.equal(url.searchParams.get('fields'), 'id,text,timestamp,username,replies{id,text,timestamp,username}');
  assert.equal(url.searchParams.get('limit'), '50');
  const [me] = urlsOf(/\/me$/);
  assert.equal(me.searchParams.get('fields'), 'username');

  assert.deepEqual(out, [
    { id: 'c1', at: '2026-10-21T08:00:00.000Z', text: 'this is literally my group chat' },
    { id: 'c2r1', at: '2026-10-21T08:06:00.000Z', text: 'no thank you @wenna.app honestly' },
  ]);
  for (const r of out) assert.deepEqual(Object.keys(r).sort(), ['at', 'id', 'text'], 'nothing but id, at, text leaves the module');
  assert.equal(JSON.stringify(out).includes('username'), false);
});

test('replies: the account username is learned once per process and paging.next is followed on our host only', async () => {
  process.env.IG_USER_ID = `${USER}2`;
  on(/\/me$/, { username: 'wennaapp' });
  const page2 = { data: [{ id: 'c9', text: 'page two', timestamp: '2026-10-21T09:00:00+0000', username: 'another' }] };
  on(
    new RegExp(`/${MEDIA_ID}/comments$`),
    {
      ...comments('wennaapp'),
      paging: { cursors: { after: 'AAA' }, next: `https://graph.instagram.com/v21.0/${MEDIA_ID}/comments?after=AAA&limit=50&fields=id` },
    },
    (u) => !u.searchParams.has('after'),
  );
  on(new RegExp(`/${MEDIA_ID}/comments$`), { ...page2, paging: { next: 'https://evil.example/steal?x=1' } }, (u) => u.searchParams.get('after') === 'AAA');

  const first = await instagram.replies(MEDIA_ID);
  assert.deepEqual(
    first.map((r) => r.id),
    ['c1', 'c2r1', 'c0', 'c9'],
  );
  const second = urlsOf(new RegExp(`/${MEDIA_ID}/comments$`))[1];
  assert.equal(second.searchParams.get('after'), 'AAA');
  assert.equal(second.searchParams.get('access_token'), TOKEN, 'the next link is re-signed through withQuery');
  assert.equal(calls.some((c) => c.url.host === 'evil.example'), false, 'a next link off our host is not followed');

  await instagram.replies(MEDIA_ID);
  assert.equal(urlsOf(/\/me$/).length, 1, '/me is asked once');
});

test('replies: without the account username nothing is returned, so an own reply can never slip through', async () => {
  process.env.IG_USER_ID = `${USER}3`;
  on(/\/me$/, () => graphError('(#190) Invalid OAuth access token', 401));
  await assert.rejects(instagram.replies(MEDIA_ID), (e: Error) => {
    assert.ok(!e.message.includes(TOKEN));
    return true;
  });
  assert.equal(urlsOf(new RegExp(`/${MEDIA_ID}/comments$`)).length, 0);
});

/* ---------------------------------------------------------------- account */

const total = (name: string, value: number, dimension?: string, results?: Record<string, number>) => ({
  name,
  period: 'day',
  title: name,
  description: name,
  id: `${USER}/insights/${name}/day`,
  total_value: {
    value,
    ...(dimension
      ? { breakdowns: [{ dimension_keys: [dimension], results: Object.entries(results ?? {}).map(([k, v]) => ({ dimension_values: [k], value: v })) }] }
      : {}),
  },
});

test('account: thirteen insight reads and the profile for the day, mapped into metrics and breakdowns, a refusal recorded and the rest kept', async () => {
  const day = '2026-10-21';
  const since = Date.UTC(2026, 9, 21) / 1000;
  const until = since + 86_400;
  const q = (u: URL, k: string) => u.searchParams.get(k);
  const insights = new RegExp(`/${USER}/insights$`);

  // The user node carries the follower total; the day's follower_count insight is the followers gained that day.
  on(new RegExp(`/${USER}$`), { id: USER, followers_count: 57 });
  on(insights, { data: [total('reach', 14, 'follow_type', { FOLLOWER: 4, NON_FOLLOWER: 10 }), total('views', 33, 'follow_type', { FOLLOWER: 9, NON_FOLLOWER: 24 })] }, (u) => q(u, 'breakdown') === 'follow_type' && q(u, 'metric') === 'reach,views');
  on(insights, { data: [total('reach', 14, 'media_product_type', { REEL: 14 }), total('views', 33, 'media_product_type', { REEL: 33 })] }, (u) => q(u, 'breakdown') === 'media_product_type' && q(u, 'metric') === 'reach,views');
  on(
    insights,
    { data: [total('likes', 3, 'media_product_type', { REEL: 3 }), total('comments', 2, 'media_product_type', { REEL: 2 }), total('shares', 1, 'media_product_type', { REEL: 1 }), total('saves', 2, 'media_product_type', { REEL: 2 }), total('total_interactions', 8, 'media_product_type', { REEL: 8 })] },
    (u) => q(u, 'metric') === 'likes,comments,shares,saves,total_interactions',
  );
  on(insights, { data: [total('replies', 0), total('reposts', 1), total('accounts_engaged', 5)] }, (u) => q(u, 'metric') === 'replies,reposts,accounts_engaged');
  on(insights, { data: [total('profile_links_taps', 2, 'contact_button_type', { WEBSITE: 2 })] }, (u) => q(u, 'metric') === 'profile_links_taps');
  on(insights, { data: [{ name: 'follower_count', period: 'day', values: [{ value: 42, end_time: '2026-10-22T07:00:00+0000' }] }] }, (u) => q(u, 'metric') === 'follower_count');
  on(insights, () => graphError('(#100) follows_and_unfollows is not available for accounts under 100 followers'), (u) => q(u, 'metric') === 'follows_and_unfollows');
  on(insights, { data: [{ name: 'online_followers', period: 'lifetime', values: [{ value: { '0': 1, '9': 4, '21': 7 }, end_time: '2026-10-22T07:00:00+0000' }] }] }, (u) => q(u, 'metric') === 'online_followers');
  on(insights, { data: [total('follower_demographics', 0, 'age', { '25-34': 12, '35-44': 3 })] }, (u) => q(u, 'metric') === 'follower_demographics' && q(u, 'breakdown') === 'age');
  on(insights, { data: [] }, (u) => q(u, 'metric') === 'follower_demographics' && q(u, 'breakdown') === 'city');
  on(insights, { data: [total('follower_demographics', 0, 'country', { AU: 15 })] }, (u) => q(u, 'metric') === 'follower_demographics' && q(u, 'breakdown') === 'country');
  on(insights, { data: [total('follower_demographics', 0, 'gender')] }, (u) => q(u, 'metric') === 'follower_demographics' && q(u, 'breakdown') === 'gender');
  on(
    insights,
    {
      data: [{ name: 'reach', period: 'day', values: [{ value: 3, end_time: '2026-10-20T07:00:00+0000' }, { value: 14, end_time: '2026-10-21T07:00:00+0000' }] }],
      // Meta's paging links carry the token; raw must hold the shape and not the secret.
      paging: {
        previous: `https://graph.instagram.com/v21.0/${USER}/insights?access_token=${TOKEN}&metric=reach&period=day&since=${since - 56 * 86_400}&until=${since - 28 * 86_400}`,
        next: `https://graph.instagram.com/v21.0/${USER}/insights?access_token=${TOKEN}&metric=reach&period=day&since=${until}&until=${until + 28 * 86_400}`,
      },
    },
    (u) => q(u, 'metric') === 'reach' && !q(u, 'metric_type'),
  );

  const { metrics, breakdowns, raw } = await instagram.account!(day);
  const urls = urlsOf(insights);
  assert.equal(urls.length, 13);
  for (const u of urls.slice(0, 8)) {
    assert.equal(u.searchParams.get('since'), String(since), `since on ${u.searchParams.get('metric')}`);
    assert.equal(u.searchParams.get('until'), String(until));
    assert.equal(u.searchParams.get('access_token'), TOKEN);
  }
  for (const u of urls.slice(8, 12)) {
    assert.equal(u.searchParams.get('period'), 'lifetime');
    assert.equal(u.searchParams.get('metric_type'), 'total_value');
    assert.equal(u.searchParams.get('timeframe'), 'this_month');
    assert.equal(u.searchParams.has('since'), false, 'demographics are a snapshot');
  }
  assert.equal(urls[12].searchParams.get('since'), String(since - 28 * 86_400));
  assert.equal(urls[12].searchParams.get('until'), String(until));
  const [profile] = urlsOf(new RegExp(`/${USER}$`));
  assert.equal(profile.searchParams.get('fields'), 'followers_count');
  assert.equal(profile.searchParams.get('access_token'), TOKEN);

  assert.deepEqual(metrics, {
    reach: 14,
    views: 33,
    likes: 3,
    comments: 2,
    shares: 1,
    saves: 2,
    total_interactions: 8,
    replies: 0,
    reposts: 1,
    accounts_engaged: 5,
    link_taps: 2,
    new_followers: 42,
    followers: 57,
  });
  assert.equal(breakdowns.follows_by_type, undefined, 'a refused breakdown is absent, not empty');
  assert.deepEqual(breakdowns, {
    reach_by_follow_type: { FOLLOWER: 4, NON_FOLLOWER: 10 },
    views_by_follow_type: { FOLLOWER: 9, NON_FOLLOWER: 24 },
    reach_by_surface: { REEL: 14 },
    views_by_surface: { REEL: 33 },
    likes_by_surface: { REEL: 3 },
    comments_by_surface: { REEL: 2 },
    shares_by_surface: { REEL: 1 },
    saves_by_surface: { REEL: 2 },
    total_interactions_by_surface: { REEL: 8 },
    link_taps_by_button: { WEBSITE: 2 },
    online_followers_by_hour: { '0': 1, '9': 4, '21': 7 },
    follower_age: { '25-34': 12, '35-44': 3 },
    follower_city: {},
    follower_country: { AU: 15 },
    follower_gender: {},
    // each point is labelled with the Pacific midnight that ends its day; the key is the day the bucket covers
    reach_by_day: { '2026-10-19': 3, '2026-10-20': 14 },
  });

  const r = raw as Record<string, unknown> & { errors: Record<string, string> };
  assert.deepEqual(Object.keys(r).sort(), [
    'demographics_age',
    'demographics_city',
    'demographics_country',
    'demographics_gender',
    'engaged',
    'errors',
    'followers',
    'interactions_surface',
    'link_taps',
    'online',
    'profile',
    'reach_series',
    'reach_views_follow',
    'reach_views_surface',
  ]);
  assert.deepEqual(r.profile, { id: USER, followers_count: 57 });
  assert.deepEqual(Object.keys(r.errors), ['follows']);
  assert.match(r.errors.follows, /^400 .*under 100 followers/);
  assert.ok(!JSON.stringify(r).includes(TOKEN), 'no token anywhere in raw');
  const series = r.reach_series as { paging: { next: string; previous: string } };
  assert.match(series.paging.next, /^https:\/\/graph\.instagram\.com\/v21\.0\/\d+\/insights\?access_token=…&metric=reach/, 'the paging link is kept, its token blanked');
  assert.match(series.paging.previous, /access_token=…&/);
});

test('account: demographics ask for this month from the first request, once per bucket', async () => {
  const insights = new RegExp(`/${USER}/insights$`);
  // A request without the timeframe would be refused; none is made.
  on(insights, () => graphError('(#100) timeframe parameter is required for follower_demographics'), (u) => u.searchParams.get('metric') === 'follower_demographics' && !u.searchParams.has('timeframe'));
  on(insights, { data: [total('follower_demographics', 0, 'age', { '18-24': 2 })] }, (u) => u.searchParams.get('metric') === 'follower_demographics' && u.searchParams.get('breakdown') === 'age');
  on(insights, { data: [] });
  on(new RegExp(`/${USER}$`), { id: USER, followers_count: 3 });
  const { breakdowns, raw } = await instagram.account!('2026-10-21');
  const demo = urlsOf(insights).filter((u) => u.searchParams.get('metric') === 'follower_demographics');
  assert.equal(demo.length, 4, 'each bucket asked once');
  for (const u of demo) assert.equal(u.searchParams.get('timeframe'), 'this_month');
  assert.deepEqual(breakdowns.follower_age, { '18-24': 2 });
  assert.deepEqual(breakdowns.follower_city, {});
  assert.deepEqual((raw as { errors: Record<string, string> }).errors, {});
});

test('account: a refused profile read lands in raw.errors.profile and the day\'s new followers stay', async () => {
  const insights = new RegExp(`/${USER}/insights$`);
  on(insights, { data: [{ name: 'follower_count', period: 'day', values: [{ value: 2, end_time: '2026-10-22T07:00:00+0000' }] }] }, (u) => u.searchParams.get('metric') === 'follower_count');
  on(insights, { data: [] });
  on(new RegExp(`/${USER}$`), () => graphError('(#10) Application does not have permission for this action', 403));
  const { metrics, raw } = await instagram.account!('2026-10-21');
  assert.deepEqual(metrics, { new_followers: 2 });
  const r = raw as { errors: Record<string, string>; profile?: unknown };
  assert.equal(r.profile, undefined);
  assert.match(r.errors.profile, /^403 .*permission/);
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

test('account: a day that is not a day is refused before any call', async () => {
  await assert.rejects(instagram.account!('yesterday'), /YYYY-MM-DD/);
  assert.equal(calls.length, 0);
});

/* ---------------------------------------------- recent, postedAt, parseId */

const mediaList = (data: unknown[], nextUrl?: string) => ({ data, paging: { cursors: { after: 'B' }, ...(nextUrl ? { next: nextUrl } : {}) } });
const post = (id: string, code: string, caption?: string) => ({
  id,
  caption,
  timestamp: '2026-10-21T06:37:08+0000',
  permalink: `https://www.instagram.com/reel/${code}/`,
  media_product_type: 'REELS',
});

test('recent: the account media, newest first as returned, caption as text, blank when there is none', async () => {
  on(new RegExp(`/${USER}/media$`), mediaList([post('1', 'AAA', 'never lead anywhere wenna.app/?from=ig-never-lead-anywhere'), post('2', 'BBB')]));
  const out = await instagram.recent!();
  const [url] = urlsOf(new RegExp(`/${USER}/media$`));
  assert.equal(url.searchParams.get('fields'), 'id,caption,timestamp,permalink,media_product_type');
  assert.equal(url.searchParams.get('limit'), '25');
  assert.deepEqual(out, [
    { id: '1', at: '2026-10-21T06:37:08.000Z', text: 'never lead anywhere wenna.app/?from=ig-never-lead-anywhere' },
    { id: '2', at: '2026-10-21T06:37:08.000Z', text: '' },
  ]);
});

test('postedAt: the media timestamp as ISO', async () => {
  on(new RegExp(`/${MEDIA_ID}$`), { id: MEDIA_ID, timestamp: '2026-10-21T06:37:08+0000' });
  assert.equal(await instagram.postedAt!(MEDIA_ID), '2026-10-21T06:37:08.000Z');
  const [url] = urlsOf(new RegExp(`/${MEDIA_ID}$`));
  assert.equal(url.searchParams.get('fields'), 'id,timestamp');
});

test('parseId: digits pass through without a call', async () => {
  assert.equal(await instagram.parseId!(MEDIA_ID), MEDIA_ID);
  assert.equal(await instagram.parseId!(`  ${MEDIA_ID} `), MEDIA_ID);
  assert.equal(calls.length, 0);
});

test('parseId: every URL shape is matched against the account media by shortcode', async () => {
  on(new RegExp(`/${USER}/media$`), mediaList([post('11', 'DQabc12xYz'), post('12', 'DQp-ost_1'), post('13', 'DQreels99')]));
  assert.equal(await instagram.parseId!('https://www.instagram.com/reel/DQabc12xYz/'), '11');
  assert.equal(await instagram.parseId!('https://www.instagram.com/reel/DQabc12xYz/?igsh=abc123&utm_source=ig_web_copy_link'), '11');
  assert.equal(await instagram.parseId!('instagram.com/p/DQp-ost_1/'), '12');
  assert.equal(await instagram.parseId!('https://instagram.com/reels/DQreels99'), '13');
  assert.equal(await instagram.parseId!('https://www.instagram.com/wennaapp/reel/DQabc12xYz/'), '11');
});

test('parseId: follows paging up to four pages, then names the shortcode it could not find', async () => {
  const media = new RegExp(`/${USER}/media$`);
  const link = (n: number) => `https://graph.instagram.com/v21.0/${USER}/media?after=p${n}`;
  on(media, mediaList([post('1', 'AAA')], link(2)), (u) => !u.searchParams.has('after'));
  on(media, mediaList([post('2', 'BBB')], link(3)), (u) => u.searchParams.get('after') === 'p2');
  on(media, mediaList([post('3', 'CCC')], link(4)), (u) => u.searchParams.get('after') === 'p3');
  on(media, mediaList([post('4', 'DDD')], link(5)), (u) => u.searchParams.get('after') === 'p4');
  on(media, mediaList([post('5', 'EEE')]), (u) => u.searchParams.get('after') === 'p5');

  assert.equal(await instagram.parseId!('https://www.instagram.com/p/DDD/'), '4');
  assert.equal(urlsOf(media).length, 4);

  calls = [];
  await assert.rejects(instagram.parseId!('https://www.instagram.com/p/EEE/'), /shortcode "EEE".*100 posts/);
  assert.equal(urlsOf(media).length, 4, 'the fifth page is never asked for');
});

test('parseId: garbage is refused with a clear message and no call', async () => {
  await assert.rejects(instagram.parseId!('https://www.tiktok.com/@someone/video/7310000000000000000'), /neither a media id nor an instagram\.com/);
  await assert.rejects(instagram.parseId!('not a link'), /"not a link"/);
  await assert.rejects(instagram.parseId!(''), /neither/);
  assert.equal(calls.length, 0);
});

/* ------------------------------------------------------------------ token */

test('token: expiry from IG_TOKEN_EXPIRES, acceptance from /me?fields=id, never a username', async () => {
  process.env.IG_TOKEN_EXPIRES = new Date(Date.now() + 10.5 * 86_400_000).toISOString().slice(0, 10);
  on(/\/me$/, { id: USER });
  const state = await instagram.token!();
  const [me] = urlsOf(/\/me$/);
  assert.equal(me.searchParams.get('fields'), 'id');
  assert.equal(state.platform, 'instagram');
  assert.equal(state.configured, true);
  assert.equal(state.note, 'accepted');
  assert.equal(state.expires, process.env.IG_TOKEN_EXPIRES);
  assert.ok(state.daysLeft === 9 || state.daysLeft === 10, `daysLeft ${state.daysLeft}`);
  assert.equal(JSON.stringify(state).includes(TOKEN), false);
});

test('token: a refusal is reported in the note, redacted, with no expiry when none is set', async () => {
  on(/\/me$/, () => graphError('(#190) Error validating access token: Session has expired', 401));
  const state = await instagram.token!();
  assert.equal(state.configured, true);
  assert.equal(state.note, 'refused: 401 (#190) Error validating access token: Session has expired');
  assert.equal(state.expires, undefined);
  assert.equal(state.daysLeft, undefined);
  assert.equal(JSON.stringify(state).includes(TOKEN), false);
});

/* ---------------------------------------------------------------- secrets */

test('no error from any method carries the token, even when the platform echoes it back', async () => {
  on(new RegExp(`/${MEDIA_ID}$`), () => new Response(`{"error":{"message":"bad token ${TOKEN}","access_token":"${TOKEN}"}}`, { status: 400 }));
  for (const run of [() => instagram.metrics(MEDIA_ID), () => instagram.postedAt!(MEDIA_ID)]) {
    await assert.rejects(run, (e: Error) => {
      assert.ok(!e.message.includes(TOKEN), `token in: ${e.message}`);
      assert.ok(!String(e.stack).includes(TOKEN));
      return true;
    });
  }
});
