/**
 * Fixture-based tests for the YouTube module, with fetch stubbed: nothing
 * leaves the machine, no env file is read, nothing is written. Each way in
 * (an API key, an OAuth token with and without the read scopes) is walked
 * through every method, and the privacy rules are checked where they bite:
 * the author never leaves the module, the channel's own replies are
 * dropped, and no error or token state carries a key or a token.
 * Run with `npm test`, or alone:
 *   node --experimental-strip-types --test analytics/platforms/youtube.test.ts
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { HttpError, clock } from './http.ts';
import { reset, youtube } from './youtube.ts';

type Call = { url: URL; method: string; headers: Record<string, string> };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
const realSleep = clock.sleep;

const KEY = 'yt-key-SECRET';
const ACCESS = 'yt-access-SECRET';
const REFRESH = 'yt-refresh-SECRET';
const VIDEO_ID = 'dQw4w9WgXcQ';
const OWN = 'UC-own-channel';
const TODAY = new Date().toISOString().slice(0, 10);

const TOKEN = 'oauth2.googleapis.com/token';
const TOKENINFO = 'oauth2.googleapis.com/tokeninfo';
const VIDEOS = 'www.googleapis.com/youtube/v3/videos';
const THREADS = 'www.googleapis.com/youtube/v3/commentThreads';
const CHANNELS = 'www.googleapis.com/youtube/v3/channels';
const PLAYLIST = 'www.googleapis.com/youtube/v3/playlistItems';
const REPORTS = 'youtubeanalytics.googleapis.com/v2/reports';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Route = [endpoint: string, reply: (c: Call) => Response | object];

/** Route each fetch by host and path; anything unrouted is a test failure. */
function serve(...routes: Route[]) {
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const c: Call = { url, method: init.method ?? 'GET', headers: { ...((init.headers as Record<string, string>) ?? {}) } };
    calls.push(c);
    const hit = routes.find(([endpoint]) => url.host + url.pathname === endpoint);
    if (!hit) throw new Error(`unexpected fetch ${c.method} ${url.href}`);
    const r = hit[1](c);
    return r instanceof Response ? r : json(r);
  }) as typeof fetch;
}

const made = (endpoint: string) => calls.filter((c) => c.url.host + c.url.pathname === endpoint);
const q = (c: Call, k: string) => c.url.searchParams.get(k);

const scope = (s: string) => `https://www.googleapis.com/auth/${s}`;
const oauthRoutes = (...scopes: string[]): Route[] => [
  [TOKEN, () => ({ access_token: ACCESS, expires_in: 3599, token_type: 'Bearer' })],
  [TOKENINFO, () => ({ scope: scopes.map(scope).join(' '), expires_in: 3599 })],
];

function withKey() {
  process.env.YOUTUBE_API_KEY = KEY;
}
function withOAuth() {
  process.env.YOUTUBE_CLIENT_ID = 'yt-client';
  process.env.YOUTUBE_CLIENT_SECRET = 'yt-client-secret-SECRET';
  process.env.YOUTUBE_REFRESH_TOKEN = REFRESH;
}

/* -------------------------------------------------------------- fixtures */

const VIDEO = {
  kind: 'youtube#videoListResponse',
  items: [
    {
      kind: 'youtube#video',
      id: VIDEO_ID,
      snippet: { publishedAt: '2026-10-20T07:12:00Z', channelId: OWN, title: 'The Open Seat', description: 'A chair nobody claims.\n\nwenna.app' },
      contentDetails: { duration: 'PT42S' },
      status: { privacyStatus: 'public' },
      statistics: { viewCount: '1234', likeCount: '56', commentCount: '7' },
    },
  ],
};

const report = (names: string[], rows: (string | number)[][]) => ({
  kind: 'youtubeAnalytics#resultTable',
  columnHeaders: names.map((name) => ({ name, columnType: 'METRIC', dataType: 'INTEGER' })),
  rows,
});

/** Answers every per-video report with a small table keyed by what was asked. */
function reports(c: Call): object {
  const dims = q(c, 'dimensions');
  const metrics = q(c, 'metrics') ?? '';
  if (!dims) {
    return report(metrics.split(','), [[1200, 900, 10.5, 30.6, 72.8, 4, 2, 50, 7]]);
  }
  if (dims === 'elapsedVideoTimeRatio') {
    return report(['elapsedVideoTimeRatio', 'audienceWatchRatio', 'relativeRetentionPerformance'], [[0, 1, 0.5], [0.5, 0.6, 0.5], [1, 0.3, 0.4]]);
  }
  return report([dims, ...metrics.split(',')], [['A', 100, 5], ['B', 50, 2]]);
}

const comment = (id: string, author: string, at: string, text: string) => ({
  kind: 'youtube#comment',
  id,
  snippet: { authorDisplayName: 'Some Person', authorProfileImageUrl: 'https://example.invalid/p.jpg', authorChannelId: { value: author }, publishedAt: at, textOriginal: text, textDisplay: text },
});
const thread = (top: ReturnType<typeof comment>, replies: ReturnType<typeof comment>[] = []) => ({
  kind: 'youtube#commentThread',
  id: top.id,
  snippet: { videoId: VIDEO_ID, topLevelComment: top, totalReplyCount: replies.length },
  ...(replies.length ? { replies: { comments: replies } } : {}),
});
const page = (items: object[], nextPageToken?: string) => ({ kind: 'youtube#commentThreadListResponse', items, ...(nextPageToken ? { nextPageToken } : {}) });

const CHANNEL = {
  items: [
    {
      id: OWN,
      statistics: { viewCount: '9876', subscriberCount: '42', hiddenSubscriberCount: false, videoCount: '3' },
      contentDetails: { relatedPlaylists: { likes: '', uploads: 'UU-own-uploads' } },
    },
  ],
};

const UPLOADS = {
  items: [
    {
      snippet: { publishedAt: '2026-10-19T09:00:00Z', title: 'Older one', description: 'first' },
      contentDetails: { videoId: 'aaaaaaaaaaa', videoPublishedAt: '2026-10-19T09:30:00Z' },
    },
    {
      snippet: { publishedAt: '2026-10-20T07:12:00Z', title: 'The Open Seat', description: 'A chair nobody claims.\n\nwenna.app' },
      contentDetails: { videoId: VIDEO_ID },
    },
  ],
};

/* ----------------------------------------------------------------- setup */

beforeEach(() => {
  calls = [];
  for (const k of Object.keys(process.env)) if (k.startsWith('YOUTUBE_')) delete process.env[k];
  clock.sleep = async () => {};
  reset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  clock.sleep = realSleep;
});

/* ------------------------------------------------------------ configured */

describe('configured', () => {
  test('names both ways in when neither is set', () => {
    const c = youtube.configured();
    assert.equal(c.ok, false);
    if (!c.ok) {
      assert.match(c.reason, /YOUTUBE_API_KEY unset/);
      assert.match(c.reason, /YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN unset/);
    }
  });

  test('a key alone is enough', () => {
    withKey();
    assert.deepEqual(youtube.configured(), { ok: true });
  });

  test('the three OAuth vars alone are enough, and two of them are not', () => {
    withOAuth();
    assert.deepEqual(youtube.configured(), { ok: true });
    delete process.env.YOUTUBE_REFRESH_TOKEN;
    const c = youtube.configured();
    assert.equal(c.ok, false);
    if (!c.ok) assert.match(c.reason, /YOUTUBE_REFRESH_TOKEN unset/);
  });
});

/* --------------------------------------------------------------- metrics */

describe('metrics', () => {
  test('with a key: the public numbers, the key in the query, no bearer, no reports', async () => {
    withKey();
    serve([VIDEOS, () => VIDEO]);
    const { metrics, raw } = await youtube.metrics(VIDEO_ID);
    assert.deepEqual(metrics, { views: 1234, likes: 56, comments: 7 });
    assert.deepEqual((raw as { video: unknown }).video, VIDEO);
    assert.deepEqual(Object.keys(raw as object), ['video']);
    const [v] = made(VIDEOS);
    assert.equal(q(v, 'id'), VIDEO_ID);
    assert.equal(q(v, 'part'), 'statistics,snippet,contentDetails,status');
    assert.equal(q(v, 'key'), KEY);
    assert.equal(v.headers.Authorization, undefined);
    assert.equal(made(REPORTS).length, 0);
  });

  test('with readonly and analytics: a bearer on the Data API and nine reports, each kept whole', async () => {
    withOAuth();
    serve(...oauthRoutes('youtube.upload', 'youtube.readonly', 'yt-analytics.readonly'), [VIDEOS, () => VIDEO], [REPORTS, reports]);
    const { metrics, raw } = await youtube.metrics(VIDEO_ID);
    const [v] = made(VIDEOS);
    assert.equal(v.headers.Authorization, `Bearer ${ACCESS}`);
    assert.equal(q(v, 'key'), null);

    assert.deepEqual(metrics, {
      views: 1234,
      likes: 56,
      comments: 7,
      engaged_views: 900,
      watch_total_s: 10.5 * 60,
      watch_avg_s: 30.6,
      watch_pct: 72.8,
      shares: 4,
    });

    const r = raw as Record<string, unknown>;
    assert.deepEqual(Object.keys(r), ['video', 'analytics', 'retention', 'traffic', 'subscribed', 'playback', 'device', 'country', 'sharing', 'by_day']);
    assert.ok(Array.isArray((r.retention as { rows: unknown[] }).rows));
    assert.equal((r.retention as { rows: unknown[] }).rows.length, 3);
    assert.ok((r.analytics as { columnHeaders: unknown[] }).columnHeaders.length === 9);

    const rep = made(REPORTS);
    assert.equal(rep.length, 9);
    for (const c of rep) {
      assert.equal(c.headers.Authorization, `Bearer ${ACCESS}`);
      assert.equal(q(c, 'ids'), 'channel==MINE');
      assert.equal(q(c, 'filters'), `video==${VIDEO_ID}`);
      assert.equal(q(c, 'startDate'), '2026-10-20');
      assert.equal(q(c, 'endDate'), TODAY);
    }
    assert.equal(q(rep[0], 'metrics'), 'views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,shares,subscribersGained,likes,comments');
    assert.equal(q(rep[0], 'dimensions'), null);
    assert.equal(q(rep[1], 'dimensions'), 'elapsedVideoTimeRatio');
    assert.equal(q(rep[1], 'metrics'), 'audienceWatchRatio,relativeRetentionPerformance');
    assert.equal(q(rep[2], 'dimensions'), 'insightTrafficSourceType');
    assert.equal(q(rep[3], 'dimensions'), 'subscribedStatus');
    assert.equal(q(rep[4], 'dimensions'), 'insightPlaybackLocationType');
    assert.equal(q(rep[5], 'dimensions'), 'deviceType');
    assert.equal(q(rep[6], 'dimensions'), 'country');
    assert.equal(q(rep[6], 'sort'), '-views');
    assert.equal(q(rep[6], 'maxResults'), '10');
    assert.equal(q(rep[7], 'dimensions'), 'sharingService');
    assert.equal(q(rep[8], 'dimensions'), 'day');
    // Every report is a GET: nothing here writes.
    assert.ok(calls.filter((c) => c.url.host !== 'oauth2.googleapis.com').every((c) => c.method === 'GET'));
  });

  test('a refused report lands in raw.errors and the rest carries on', async () => {
    withOAuth();
    serve(
      ...oauthRoutes('youtube.upload', 'youtube.readonly', 'yt-analytics.readonly'),
      [VIDEOS, () => VIDEO],
      [REPORTS, (c) => (q(c, 'dimensions') === 'elapsedVideoTimeRatio' ? json({ error: { code: 403, message: 'audienceWatchRatio is not allowed for this user' } }, 403) : reports(c))],
    );
    const { metrics, raw } = await youtube.metrics(VIDEO_ID);
    const r = raw as { errors: Record<string, string>; retention?: unknown; traffic?: unknown; by_day?: unknown };
    assert.equal(r.retention, undefined);
    assert.match(r.errors.retention, /^403 /);
    assert.match(r.errors.retention, /audienceWatchRatio is not allowed/);
    assert.deepEqual(Object.keys(r.errors), ['retention']);
    assert.ok(r.traffic && r.by_day);
    assert.equal(metrics.views, 1234);
    assert.equal(metrics.engaged_views, 900);
    assert.equal(made(REPORTS).length, 9);
  });

  test('analytics scope without readonly: the key reads the Data API and the bearer reads the reports', async () => {
    withKey();
    withOAuth();
    serve(...oauthRoutes('youtube.upload', 'yt-analytics.readonly'), [VIDEOS, () => VIDEO], [REPORTS, reports]);
    const { metrics } = await youtube.metrics(VIDEO_ID);
    const [v] = made(VIDEOS);
    assert.equal(q(v, 'key'), KEY);
    assert.equal(v.headers.Authorization, undefined);
    assert.equal(made(REPORTS).length, 9);
    assert.equal(made(REPORTS)[0].headers.Authorization, `Bearer ${ACCESS}`);
    assert.equal(metrics.engaged_views, 900);
  });

  test('upload-only OAuth and no key: a clear error, and no Data API call', async () => {
    withOAuth();
    serve(...oauthRoutes('youtube.upload'));
    await assert.rejects(youtube.metrics(VIDEO_ID), (e: Error) => {
      assert.match(e.message, /youtube\.upload only/);
      assert.match(e.message, /not youtube\.readonly/);
      assert.match(e.message, /YOUTUBE_API_KEY is unset/);
      assert.ok(!e.message.includes('SECRET'));
      return true;
    });
    assert.equal(made(VIDEOS).length, 0);
  });

  test('upload-only OAuth with a key: the key reads, no reports', async () => {
    withOAuth();
    withKey();
    serve(...oauthRoutes('youtube.upload'), [VIDEOS, () => VIDEO]);
    const { metrics, raw } = await youtube.metrics(VIDEO_ID);
    assert.equal(metrics.views, 1234);
    assert.deepEqual(Object.keys(raw as object), ['video']);
    assert.equal(q(made(VIDEOS)[0], 'key'), KEY);
    assert.equal(made(REPORTS).length, 0);
  });

  test('an OAuth token that cannot be fetched counts as no OAuth, and the key carries on', async () => {
    withOAuth();
    withKey();
    serve([TOKEN, () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400)], [VIDEOS, () => VIDEO]);
    const { metrics } = await youtube.metrics(VIDEO_ID);
    assert.equal(metrics.views, 1234);
    assert.equal(q(made(VIDEOS)[0], 'key'), KEY);
    // The scopes are learned once per process: a second call does not ask again.
    await youtube.metrics(VIDEO_ID);
    assert.equal(made(TOKEN).length, 1);
  });

  test('a video the key cannot see is an error, not an empty row', async () => {
    withKey();
    serve([VIDEOS, () => ({ kind: 'youtube#videoListResponse', items: [] })]);
    await assert.rejects(youtube.metrics(VIDEO_ID), /not found; a private Short is readable only with youtube\.readonly/);
  });

  test('a Data API failure throws without the key in the message', async () => {
    withKey();
    serve([VIDEOS, () => json({ error: { code: 403, message: 'The request is missing a valid API key.' } }, 403)]);
    await assert.rejects(youtube.metrics(VIDEO_ID), (e: Error) => {
      assert.ok(e instanceof HttpError);
      assert.ok(!e.message.includes(KEY), e.message);
      assert.ok(!e.url.includes(KEY));
      assert.match(e.message, /key=…/);
      assert.match(e.message, /missing a valid API key/);
      return true;
    });
  });

  test('a report failure under a bearer carries no token', async () => {
    withOAuth();
    serve(
      ...oauthRoutes('youtube.readonly', 'yt-analytics.readonly'),
      [VIDEOS, () => VIDEO],
      [REPORTS, () => json({ error: { message: `Bearer ${ACCESS} is not authorized`, access_token: ACCESS } }, 401)],
    );
    const { raw } = await youtube.metrics(VIDEO_ID);
    const errors = (raw as { errors: Record<string, string> }).errors;
    assert.equal(Object.keys(errors).length, 9);
    for (const msg of Object.values(errors)) assert.ok(!msg.includes(ACCESS), msg);
    assert.ok(!JSON.stringify(raw).includes(ACCESS));
  });
});

/* --------------------------------------------------------------- replies */

describe('replies', () => {
  const fan1 = comment('c1', 'UC-fan-1', '2026-10-21T10:00:00Z', 'love this @sam, exactly our chat');
  const ownReply = comment('c1.r1', OWN, '2026-10-21T10:05:00Z', 'thanks, means a lot');
  const fan2 = comment('c1.r2', 'UC-fan-2', '2026-10-21T10:10:00Z', 'same here');
  const ownTop = comment('c2', OWN, '2026-10-21T09:00:00Z', 'pinned: wenna.app');
  const fan3 = comment('c2.r1', 'UC-fan-3', '2026-10-21T09:30:00Z', 'u/someone sent me');
  const old = comment('c3', 'UC-fan-4', '2026-10-01T09:00:00Z', 'from before');

  test('drops the author and the channel itself, keeps the text as written, flattens replies', async () => {
    withKey();
    serve([VIDEOS, () => VIDEO], [THREADS, () => page([thread(fan1, [ownReply, fan2]), thread(ownTop, [fan3])])]);
    const out = await youtube.replies(VIDEO_ID);
    assert.deepEqual(out, [
      { id: 'c1', at: '2026-10-21T10:00:00Z', text: 'love this @sam, exactly our chat' },
      { id: 'c1.r2', at: '2026-10-21T10:10:00Z', text: 'same here' },
      { id: 'c2.r1', at: '2026-10-21T09:30:00Z', text: 'u/someone sent me' },
    ]);
    for (const r of out) assert.deepEqual(Object.keys(r), ['id', 'at', 'text']);
    assert.ok(!JSON.stringify(out).includes('Some Person'));
    assert.ok(!JSON.stringify(out).includes('UC-'));
    const [t] = made(THREADS);
    assert.equal(q(t, 'videoId'), VIDEO_ID);
    assert.equal(q(t, 'part'), 'snippet,replies');
    assert.equal(q(t, 'textFormat'), 'plainText');
    assert.equal(q(t, 'maxResults'), '100');
    assert.equal(q(t, 'pageToken'), null);
    assert.equal(q(t, 'key'), KEY);
  });

  test('since: older replies are skipped and paging stops at the first old thread', async () => {
    withKey();
    serve([VIDEOS, () => VIDEO], [THREADS, () => page([thread(fan1, [fan2]), thread(old)], 'page-2')]);
    const out = await youtube.replies(VIDEO_ID, '2026-10-15T00:00:00Z');
    assert.deepEqual(out.map((r) => r.id), ['c1', 'c1.r2']);
    assert.equal(made(THREADS).length, 1);
  });

  test('pages with pageToken, caps at ten pages, and learns the channel from one videos call', async () => {
    withKey();
    let n = 0;
    serve([VIDEOS, () => VIDEO], [THREADS, () => page([thread(comment(`c${++n}`, 'UC-fan', '2026-10-21T10:00:00Z', `reply ${n}`))], `page-${n + 1}`)]);
    const out = await youtube.replies(VIDEO_ID);
    assert.equal(out.length, 10);
    const t = made(THREADS);
    assert.equal(t.length, 10);
    assert.equal(q(t[0], 'pageToken'), null);
    assert.equal(q(t[1], 'pageToken'), 'page-2');
    assert.equal(q(t[9], 'pageToken'), 'page-10');
    assert.equal(made(VIDEOS).length, 1);
  });

  test('comments disabled is an empty list, not an error', async () => {
    withKey();
    serve(
      [VIDEOS, () => VIDEO],
      [THREADS, () => json({ error: { code: 403, message: 'The video identified by the videoId parameter has disabled comments.', errors: [{ reason: 'commentsDisabled', domain: 'youtube.commentThread' }] } }, 403)],
    );
    assert.deepEqual(await youtube.replies(VIDEO_ID), []);
  });

  test('a private video with a key is an empty list and no commentThreads call', async () => {
    withKey();
    serve([VIDEOS, () => ({ items: [] })]);
    assert.deepEqual(await youtube.replies(VIDEO_ID), []);
    assert.equal(made(THREADS).length, 0);
  });

  test('any other failure throws, after the one retry http.ts gives a 5xx', async () => {
    withKey();
    serve([VIDEOS, () => VIDEO], [THREADS, () => json({ error: { code: 500, message: 'Backend Error' } }, 500)]);
    await assert.rejects(youtube.replies(VIDEO_ID), (e: Error) => e instanceof HttpError && e.status === 500 && !e.message.includes(KEY));
    assert.equal(made(THREADS).length, 2);
  });

  test('with readonly the bearer reads a private video and its comments', async () => {
    withOAuth();
    serve(...oauthRoutes('youtube.readonly'), [VIDEOS, () => VIDEO], [THREADS, () => page([thread(fan1)])]);
    const out = await youtube.replies(VIDEO_ID);
    assert.equal(out.length, 1);
    assert.equal(made(THREADS)[0].headers.Authorization, `Bearer ${ACCESS}`);
    assert.equal(q(made(THREADS)[0], 'key'), null);
  });
});

/* --------------------------------------------------------------- account */

describe('account', () => {
  test('with readonly and analytics: mine=true, the day report, both kept whole', async () => {
    withOAuth();
    serve(
      ...oauthRoutes('youtube.readonly', 'yt-analytics.readonly'),
      [CHANNELS, () => CHANNEL],
      [REPORTS, () => report(['views', 'subscribersGained', 'subscribersLost', 'estimatedMinutesWatched'], [[310, 3, 1, 22.5]])],
    );
    const { metrics, breakdowns, raw } = await youtube.account!('2026-10-20');
    assert.deepEqual(metrics, { subscribers: 42, views: 9876, videos: 3, views_day: 310, subscribers_gained: 3, subscribers_lost: 1, minutes_watched: 22.5 });
    assert.deepEqual(breakdowns, {});
    assert.deepEqual(Object.keys(raw as object), ['channel', 'analytics']);
    assert.deepEqual((raw as { channel: unknown }).channel, CHANNEL);
    const [ch] = made(CHANNELS);
    assert.equal(q(ch, 'mine'), 'true');
    assert.equal(q(ch, 'id'), null);
    assert.equal(q(ch, 'part'), 'statistics,contentDetails');
    assert.equal(ch.headers.Authorization, `Bearer ${ACCESS}`);
    const [r] = made(REPORTS);
    assert.equal(q(r, 'ids'), 'channel==MINE');
    assert.equal(q(r, 'startDate'), '2026-10-20');
    assert.equal(q(r, 'endDate'), '2026-10-20');
    assert.equal(q(r, 'metrics'), 'views,subscribersGained,subscribersLost,estimatedMinutesWatched');
    assert.equal(q(r, 'filters'), null);
  });

  test('with a key and YOUTUBE_CHANNEL_ID: id=, no report', async () => {
    withKey();
    process.env.YOUTUBE_CHANNEL_ID = OWN;
    serve([CHANNELS, () => CHANNEL]);
    const { metrics, raw } = await youtube.account!('2026-10-20');
    assert.deepEqual(metrics, { subscribers: 42, views: 9876, videos: 3 });
    assert.deepEqual(Object.keys(raw as object), ['channel']);
    const [ch] = made(CHANNELS);
    assert.equal(q(ch, 'id'), OWN);
    assert.equal(q(ch, 'mine'), null);
    assert.equal(q(ch, 'key'), KEY);
    assert.equal(made(REPORTS).length, 0);
  });

  test('with a key and no channel id: a clear error before any call', async () => {
    withKey();
    serve();
    await assert.rejects(youtube.account!('2026-10-20'), /YOUTUBE_CHANNEL_ID unset and no readonly scope/);
    assert.equal(calls.length, 0);
  });

  test('a refused report keeps the channel numbers; a refused channel keeps the report', async () => {
    withOAuth();
    serve(...oauthRoutes('youtube.readonly', 'yt-analytics.readonly'), [CHANNELS, () => CHANNEL], [REPORTS, () => json({ error: { message: 'quota' } }, 403)]);
    const a = await youtube.account!('2026-10-20');
    assert.deepEqual(a.metrics, { subscribers: 42, views: 9876, videos: 3 });
    assert.match((a.raw as { errors: Record<string, string> }).errors.analytics, /quota/);

    reset();
    calls = [];
    serve(
      ...oauthRoutes('youtube.readonly', 'yt-analytics.readonly'),
      [CHANNELS, () => json({ error: { message: 'channel refused' } }, 403)],
      [REPORTS, () => report(['views', 'subscribersGained', 'subscribersLost', 'estimatedMinutesWatched'], [[310, 3, 1, 22.5]])],
    );
    const b = await youtube.account!('2026-10-20');
    assert.deepEqual(b.metrics, { views_day: 310, subscribers_gained: 3, subscribers_lost: 1, minutes_watched: 22.5 });
    assert.match((b.raw as { errors: Record<string, string> }).errors.channel, /channel refused/);
  });

  test('when every call fails the account call throws', async () => {
    withKey();
    process.env.YOUTUBE_CHANNEL_ID = OWN;
    serve([CHANNELS, () => json({ error: { message: 'nope' } }, 403)]);
    await assert.rejects(youtube.account!('2026-10-20'), (e: Error) => /nope/.test(e.message) && !e.message.includes(KEY));
  });
});

/* ---------------------------------------------------------------- recent */

describe('recent', () => {
  test('the uploads playlist, newest first, title and description as the text', async () => {
    withOAuth();
    serve(...oauthRoutes('youtube.readonly'), [CHANNELS, () => CHANNEL], [PLAYLIST, () => UPLOADS]);
    const out = await youtube.recent!();
    assert.deepEqual(out, [
      { id: VIDEO_ID, at: '2026-10-20T07:12:00Z', text: 'The Open Seat\nA chair nobody claims.\n\nwenna.app' },
      { id: 'aaaaaaaaaaa', at: '2026-10-19T09:30:00Z', text: 'Older one\nfirst' },
    ]);
    const [ch] = made(CHANNELS);
    assert.equal(q(ch, 'mine'), 'true');
    assert.equal(q(ch, 'part'), 'contentDetails');
    const [pl] = made(PLAYLIST);
    assert.equal(q(pl, 'playlistId'), 'UU-own-uploads');
    assert.equal(q(pl, 'part'), 'snippet,contentDetails');
    assert.equal(q(pl, 'maxResults'), '50');
    assert.equal(pl.headers.Authorization, `Bearer ${ACCESS}`);
  });

  test('with a key: the channel by id', async () => {
    withKey();
    process.env.YOUTUBE_CHANNEL_ID = OWN;
    serve([CHANNELS, () => CHANNEL], [PLAYLIST, () => UPLOADS]);
    const out = await youtube.recent!();
    assert.equal(out.length, 2);
    assert.equal(q(made(CHANNELS)[0], 'id'), OWN);
    assert.equal(q(made(PLAYLIST)[0], 'key'), KEY);
  });

  test('neither a readonly token nor a channel id: a clear error', async () => {
    withKey();
    serve();
    await assert.rejects(youtube.recent!(), /YOUTUBE_CHANNEL_ID/);
    assert.equal(calls.length, 0);
  });
});

/* -------------------------------------------------------------- postedAt */

describe('postedAt', () => {
  test('the platform publish time, undefined when the video is not listed', async () => {
    withKey();
    serve([VIDEOS, (c) => (q(c, 'id') === VIDEO_ID ? VIDEO : { items: [] })]);
    assert.equal(await youtube.postedAt!(VIDEO_ID), '2026-10-20T07:12:00Z');
    assert.equal(await youtube.postedAt!('bbbbbbbbbbb'), undefined);
    // The record is cached per id: asking again makes no call.
    await youtube.postedAt!(VIDEO_ID);
    assert.equal(made(VIDEOS).length, 2);
  });
});

/* --------------------------------------------------------------- parseId */

describe('parseId', () => {
  const accepted = [
    VIDEO_ID,
    `  ${VIDEO_ID}  `,
    `https://youtu.be/${VIDEO_ID}`,
    `youtu.be/${VIDEO_ID}?si=abc123`,
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://www.youtube.com/watch?feature=share&v=${VIDEO_ID}&t=12`,
    `youtube.com/watch?v=${VIDEO_ID}`,
    `https://m.youtube.com/watch?v=${VIDEO_ID}`,
    `https://www.youtube.com/shorts/${VIDEO_ID}`,
    `youtube.com/shorts/${VIDEO_ID}?feature=share`,
    `https://www.youtube.com/live/${VIDEO_ID}?si=xyz`,
    `http://youtube.com/live/${VIDEO_ID}`,
  ];
  for (const s of accepted) {
    test(`accepts ${JSON.stringify(s)}`, async () => {
      assert.equal(await youtube.parseId!(s), VIDEO_ID);
    });
  }

  const refused = [
    '',
    'garbage',
    'dQw4w9WgXc',
    'dQw4w9WgXcQQ',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/shorts/',
    'https://www.youtube.com/channel/UC-own-channel',
    'https://www.youtube.com/shorts/tooshort',
    'https://vimeo.com/12345',
  ];
  for (const s of refused) {
    test(`refuses ${JSON.stringify(s)}`, async () => {
      await assert.rejects(youtube.parseId!(s), /not a YouTube video URL or id/);
    });
  }
});

/* ----------------------------------------------------------------- token */

describe('token', () => {
  test('nothing set: not configured, and the note says what is missing', async () => {
    serve();
    const t = await youtube.token!();
    assert.equal(t.platform, 'youtube');
    assert.equal(t.configured, false);
    assert.match(t.note!, /YOUTUBE_API_KEY is unset/);
    assert.match(t.note!, /no OAuth/);
    assert.equal(t.scopes, undefined);
    assert.equal(calls.length, 0);
  });

  test('a key alone: configured, no scopes, no call', async () => {
    withKey();
    serve();
    const t = await youtube.token!();
    assert.equal(t.configured, true);
    assert.match(t.note!, /YOUTUBE_API_KEY is set/);
    assert.equal(t.scopes, undefined);
    assert.ok(!JSON.stringify(t).includes(KEY));
    assert.equal(calls.length, 0);
  });

  test('upload-only OAuth: the scopes, and a note saying what it lacks', async () => {
    withOAuth();
    serve(...oauthRoutes('youtube.upload'));
    const t = await youtube.token!();
    assert.equal(t.configured, true);
    assert.deepEqual(t.scopes, [scope('youtube.upload')]);
    assert.equal(t.note, 'refresh token has upload, no readonly, no analytics; YOUTUBE_API_KEY is unset');
    assert.equal(t.expires, undefined);
    assert.ok(!JSON.stringify(t).includes('SECRET'));
  });

  test('re-consented OAuth with a key beside it', async () => {
    withOAuth();
    withKey();
    serve(...oauthRoutes('youtube.upload', 'youtube.readonly', 'yt-analytics.readonly'));
    const t = await youtube.token!();
    assert.equal(t.note, 'refresh token has upload, readonly, analytics; YOUTUBE_API_KEY is set');
    assert.equal(t.scopes!.length, 3);
    assert.ok(!JSON.stringify(t).includes('SECRET'));
  });

  test('a token that cannot be fetched: the redacted reason in the note, no secret', async () => {
    withOAuth();
    serve([TOKEN, () => json({ error: 'invalid_grant', error_description: 'Bad Request', refresh_token: REFRESH }, 400)]);
    const t = await youtube.token!();
    assert.equal(t.configured, true);
    assert.match(t.note!, /could not be fetched/);
    assert.match(t.note!, /400/);
    assert.match(t.note!, /invalid_grant/);
    assert.ok(!JSON.stringify(t).includes('SECRET'), t.note);
  });

  test('tokeninfo failing is the same as no token', async () => {
    withOAuth();
    serve([TOKEN, () => ({ access_token: ACCESS })], [TOKENINFO, () => json({ error: 'invalid_token' }, 400)]);
    const t = await youtube.token!();
    assert.match(t.note!, /could not be fetched/);
    assert.ok(!JSON.stringify(t).includes(ACCESS));
  });
});
