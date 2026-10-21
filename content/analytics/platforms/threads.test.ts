/**
 * The Threads module against documented fixtures, with fetch stubbed:
 * nothing leaves the machine and nothing is written. Each test routes by
 * path so the order of calls inside a method is not what is asserted;
 * what is asserted is the request shape, the mapping, what is dropped
 * (authors, the account's own replies) and what never appears (the token,
 * the account id). Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { clock } from './http.ts';
import { threads } from './threads.ts';

const TOKEN = 'THAAtest-secret-token-value-9f8e7d';
const USER = '17841400000000000';

type Call = { url: URL; method: string };
let calls: Call[] = [];
let handler: (u: URL) => Response | unknown = () => new Response('{}', { status: 200 });

const realFetch = globalThis.fetch;
const realSleep = clock.sleep;
const savedEnv: Record<string, string | undefined> = {};
const KEYS = ['THREADS_ACCESS_TOKEN', 'THREADS_USER_ID', 'THREADS_TOKEN_EXPIRES'];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refused = (message: string, status = 403) => json({ error: { message, type: 'OAuthException', code: 190 } }, status);

beforeEach(() => {
  calls = [];
  for (const k of KEYS) savedEnv[k] = process.env[k];
  process.env.THREADS_ACCESS_TOKEN = TOKEN;
  process.env.THREADS_USER_ID = USER;
  delete process.env.THREADS_TOKEN_EXPIRES;
  clock.sleep = async () => {};
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ url, method: init.method ?? 'GET' });
    const out = handler(url);
    return out instanceof Response ? out : json(out);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  clock.sleep = realSleep;
  for (const k of KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** Every request carried the token as a query parameter, by GET, to the Graph host, and nowhere in the path. */
function assertRequestsClean() {
  assert.ok(calls.length > 0, 'at least one request');
  for (const c of calls) {
    assert.equal(c.method, 'GET');
    assert.equal(c.url.origin, 'https://graph.threads.net');
    assert.equal(c.url.searchParams.get('access_token'), TOKEN);
    assert.ok(!c.url.pathname.includes(TOKEN), 'token never in the path');
  }
}

const MEDIA = {
  id: '18000000000000001',
  media_type: 'VIDEO',
  timestamp: '2026-10-20T09:12:33+0000',
  permalink: 'https://www.threads.net/@wenna.app/post/DBabcDEf123',
  text: 'She waited three weeks. wenna.app',
};

/* ------------------------------------------------------------ configured */

test('configured: names every missing env var, and is ok with both set', () => {
  assert.deepEqual(threads.configured(), { ok: true });
  delete process.env.THREADS_ACCESS_TOKEN;
  assert.deepEqual(threads.configured(), { ok: false, reason: 'THREADS_ACCESS_TOKEN unset' });
  delete process.env.THREADS_USER_ID;
  assert.deepEqual(threads.configured(), { ok: false, reason: 'THREADS_ACCESS_TOKEN, THREADS_USER_ID unset' });
  assert.equal(calls.length, 0, 'configured() makes no request');
});

/* --------------------------------------------------------------- metrics */

test('metrics: media and insights, both documented value shapes, raw kept whole', async () => {
  const insights = {
    data: [
      { name: 'views', period: 'lifetime', values: [{ value: 1240 }], title: 'Views', id: 'x/insights/views/lifetime' },
      { name: 'likes', period: 'lifetime', total_value: { value: 31 }, title: 'Likes' },
      { name: 'replies', period: 'lifetime', values: [{ value: 4 }] },
      { name: 'reposts', period: 'lifetime', total_value: { value: 2 } },
      { name: 'quotes', period: 'lifetime', values: [{ value: 1 }] },
      { name: 'shares', period: 'lifetime', total_value: { value: 9 } },
      { name: 'something_new', period: 'lifetime', total_value: { value: 77 } },
    ],
  };
  handler = (u) => {
    if (u.pathname === `/v1.0/${MEDIA.id}`) {
      assert.equal(u.searchParams.get('fields'), 'id,media_type,timestamp,permalink,text');
      return MEDIA;
    }
    if (u.pathname === `/v1.0/${MEDIA.id}/insights`) {
      assert.equal(u.searchParams.get('metric'), 'views,likes,replies,reposts,quotes,shares');
      return insights;
    }
    throw new Error(`unexpected ${u.pathname}`);
  };
  const got = await threads.metrics(MEDIA.id);
  assert.deepEqual(got.metrics, { views: 1240, likes: 31, replies: 4, reposts: 2, quotes: 1, shares: 9 });
  assert.deepEqual(got.raw, { media: MEDIA, insights });
  assertRequestsClean();
});

test('metrics: a refused insights call rejects, and the message carries no token', async () => {
  handler = (u) => (u.pathname.endsWith('/insights') ? refused('(#10) Application does not have permission for this action') : MEDIA);
  await assert.rejects(threads.metrics(MEDIA.id), (e: Error) => {
    assert.match(e.message, /403/);
    assert.match(e.message, /does not have permission/);
    assert.ok(!e.message.includes(TOKEN), 'no token in the error');
    return true;
  });
});

/* --------------------------------------------------------------- replies */

test('replies: pages by cursor, drops the author and the account\'s own replies, keeps a handle in the text, honours since', async () => {
  const page1 = {
    data: [
      { id: '1', text: 'this is so real', timestamp: '2026-10-20T10:00:00+0000', username: 'someone_1', is_reply_owned_by_me: false },
      { id: '2', text: 'thank you, that means a lot', timestamp: '2026-10-20T10:05:00+0000', username: 'wenna.app', is_reply_owned_by_me: true },
      { id: '3', text: '@someone_1 same, every single time', timestamp: '2026-10-20T11:00:00+0000', username: 'someone_2', is_reply_owned_by_me: false },
    ],
    paging: { cursors: { before: 'b1', after: 'cursor-2' }, next: `https://graph.threads.net/v1.0/x/conversation?after=cursor-2&access_token=${TOKEN}` },
  };
  const page2 = {
    data: [{ id: '4', text: 'the one who never moves', timestamp: '2026-10-21T08:00:00+0000', username: 'someone_3' }],
    paging: { cursors: { before: 'b2' } },
  };
  handler = (u) => {
    assert.equal(u.pathname, `/v1.0/${MEDIA.id}/conversation`);
    assert.equal(u.searchParams.get('fields'), 'id,text,timestamp,username,is_reply_owned_by_me');
    assert.equal(u.searchParams.get('reverse'), 'false');
    assert.equal(u.searchParams.get('limit'), '50');
    return u.searchParams.get('after') === 'cursor-2' ? page2 : page1;
  };

  const all = await threads.replies(MEDIA.id);
  assert.deepEqual(all, [
    { id: '1', at: '2026-10-20T10:00:00.000Z', text: 'this is so real' },
    { id: '3', at: '2026-10-20T11:00:00.000Z', text: '@someone_1 same, every single time' },
    { id: '4', at: '2026-10-21T08:00:00.000Z', text: 'the one who never moves' },
  ]);
  for (const r of all) assert.deepEqual(Object.keys(r).sort(), ['at', 'id', 'text']);
  assert.ok(!JSON.stringify(all).includes('someone_2'), 'the author field never leaves the module');
  assert.ok(!JSON.stringify(all).includes('wenna.app'), 'the account\'s own reply is dropped');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('after'), null);
  assert.equal(calls[1].url.searchParams.get('after'), 'cursor-2');
  assertRequestsClean();

  calls = [];
  const recentOnly = await threads.replies(MEDIA.id, '2026-10-20T10:30:00Z');
  assert.deepEqual(recentOnly.map((r) => r.id), ['3', '4']);
});

test('replies: falls back to /replies when /conversation is refused', async () => {
  handler = (u) => {
    if (u.pathname.endsWith('/conversation')) return refused('Unsupported get request', 400);
    assert.equal(u.pathname, `/v1.0/${MEDIA.id}/replies`);
    assert.equal(u.searchParams.get('fields'), 'id,text,timestamp,username,is_reply_owned_by_me');
    return { data: [{ id: '9', text: 'top level only', timestamp: '2026-10-21T08:00:00+0000', username: 'someone' }] };
  };
  const got = await threads.replies(MEDIA.id);
  assert.deepEqual(got, [{ id: '9', at: '2026-10-21T08:00:00.000Z', text: 'top level only' }]);
  assert.deepEqual(calls.map((c) => c.url.pathname), [`/v1.0/${MEDIA.id}/conversation`, `/v1.0/${MEDIA.id}/replies`]);
});

test('replies: a refusal on /replies too is thrown, without the token', async () => {
  handler = () => refused('Invalid OAuth access token - Cannot parse access token', 400);
  await assert.rejects(threads.replies(MEDIA.id), (e: Error) => {
    assert.match(e.message, /Cannot parse access token/);
    assert.ok(!e.message.includes(TOKEN));
    return true;
  });
});

test('replies: stops at the page cap even when every page offers another cursor', async () => {
  let n = 0;
  handler = () => ({ data: [{ id: String(++n), text: 'again', timestamp: '2026-10-21T08:00:00+0000' }], paging: { cursors: { after: `c${n}` } } });
  const got = await threads.replies(MEDIA.id);
  assert.equal(calls.length, 20);
  assert.equal(got.length, 20);
});

/* --------------------------------------------------------------- account */

const DAY_INSIGHTS = {
  data: [
    {
      name: 'views',
      period: 'day',
      values: [
        { value: 120, end_time: '2026-10-20T07:00:00+0000' },
        { value: 80, end_time: '2026-10-21T07:00:00+0000' },
      ],
      title: 'views',
    },
    { name: 'likes', period: 'day', total_value: { value: 14 } },
    { name: 'replies', period: 'day', total_value: { value: 3 } },
    { name: 'reposts', period: 'day', total_value: { value: 2 } },
    { name: 'quotes', period: 'day', total_value: { value: 1 } },
    { name: 'clicks', period: 'day', total_value: { value: 6 } },
  ],
};
const FOLLOWERS = { data: [{ name: 'followers_count', period: 'day', total_value: { value: 212 } }] };
const demographics = (dim: string, results: { dimension_values: string[]; value: number }[]) => ({
  data: [{ name: 'follower_demographics', period: 'lifetime', total_value: { breakdowns: [{ dimension_keys: [dim], results }] } }],
});

test('account: one day, six calls, a refused breakdown lands in raw.errors and the rest is mapped', async () => {
  handler = (u) => {
    assert.equal(u.pathname, `/v1.0/${USER}/threads_insights`);
    const metric = u.searchParams.get('metric');
    if (metric === 'views,likes,replies,reposts,quotes,clicks') {
      assert.equal(u.searchParams.get('since'), String(Date.UTC(2026, 9, 20) / 1000));
      assert.equal(u.searchParams.get('until'), String(Date.UTC(2026, 9, 20) / 1000 + 86_399));
      return DAY_INSIGHTS;
    }
    if (metric === 'followers_count') {
      assert.equal(u.searchParams.get('since'), null, 'followers_count takes no since');
      return FOLLOWERS;
    }
    assert.equal(metric, 'follower_demographics');
    switch (u.searchParams.get('breakdown')) {
      case 'country':
        return demographics('country', [{ dimension_values: ['AU'], value: 150 }, { dimension_values: ['NZ'], value: 20 }]);
      case 'city':
        return refused('(#100) Not enough viewers for the media to show insights', 400);
      case 'age':
        return demographics('age', [{ dimension_values: ['25-34'], value: 90 }, { dimension_values: ['35-44'], value: 60 }]);
      case 'gender':
        return demographics('gender', []);
    }
    throw new Error(`unexpected ${u.search}`);
  };

  const got = await threads.account!('2026-10-20');
  assert.deepEqual(got.metrics, { views: 200, likes: 14, replies: 3, reposts: 2, quotes: 1, clicks: 6, link_taps: 6, followers: 212 });
  assert.deepEqual(got.breakdowns, {
    views_by_day: { '2026-10-20': 120, '2026-10-21': 80 },
    follower_country: { AU: 150, NZ: 20 },
    follower_age: { '25-34': 90, '35-44': 60 },
  });
  const raw = got.raw as Record<string, unknown>;
  assert.deepEqual(Object.keys(raw).sort(), ['demographics_age', 'demographics_country', 'demographics_gender', 'errors', 'followers', 'insights']);
  assert.deepEqual(raw.insights, DAY_INSIGHTS);
  assert.deepEqual(raw.followers, FOLLOWERS);
  const errors = raw.errors as Record<string, string>;
  assert.deepEqual(Object.keys(errors), ['demographics_city']);
  assert.match(errors.demographics_city, /Not enough viewers/);
  assert.ok(!errors.demographics_city.includes(TOKEN), 'no token in a stored error');
  assert.ok(!errors.demographics_city.includes(USER), 'no account id in a stored error');
  assert.equal(calls.length, 6);
  assertRequestsClean();
});

test('account: a placeholder token loses every call to raw.errors and still returns a row', async () => {
  handler = () => refused('Invalid OAuth access token - Cannot parse access token', 400);
  const got = await threads.account!('2026-10-20');
  assert.deepEqual(got.metrics, {});
  assert.deepEqual(got.breakdowns, {});
  const errors = (got.raw as { errors: Record<string, string> }).errors;
  assert.deepEqual(Object.keys(errors).sort(), ['demographics_age', 'demographics_city', 'demographics_country', 'demographics_gender', 'followers', 'insights']);
  for (const msg of Object.values(errors)) {
    assert.match(msg, /Cannot parse access token/);
    assert.ok(!msg.includes(TOKEN));
    assert.ok(!msg.includes(USER));
  }
});

test('account: refuses a day that is not YYYY-MM-DD before any request', async () => {
  await assert.rejects(threads.account!('20 October'), /not YYYY-MM-DD/);
  await assert.rejects(threads.account!('2026-10-20T00:00:00Z'), /not YYYY-MM-DD/);
  assert.equal(calls.length, 0);
});

/* ---------------------------------------------------------------- recent */

test('recent: the account\'s latest posts as { id, at, text }', async () => {
  handler = (u) => {
    assert.equal(u.pathname, `/v1.0/${USER}/threads`);
    assert.equal(u.searchParams.get('fields'), 'id,text,timestamp,permalink,media_type');
    assert.equal(u.searchParams.get('limit'), '25');
    return {
      data: [
        { ...MEDIA },
        { id: '18000000000000002', media_type: 'IMAGE', timestamp: '2026-10-19T09:00:00+0000', permalink: 'https://www.threads.net/@wenna.app/post/DBzzz' },
      ],
      paging: { cursors: { after: 'more' } },
    };
  };
  const got = await threads.recent!();
  assert.deepEqual(got, [
    { id: MEDIA.id, at: '2026-10-20T09:12:33.000Z', text: MEDIA.text },
    { id: '18000000000000002', at: '2026-10-19T09:00:00.000Z', text: '' },
  ]);
  assert.equal(calls.length, 1, 'recent() reads one page');
  assertRequestsClean();
});

/* -------------------------------------------------------------- postedAt */

test('postedAt: the media timestamp, as ISO', async () => {
  handler = () => MEDIA;
  assert.equal(await threads.postedAt!(MEDIA.id), '2026-10-20T09:12:33.000Z');
  handler = () => ({ id: MEDIA.id });
  assert.equal(await threads.postedAt!(MEDIA.id), undefined);
});

/* --------------------------------------------------------------- parseId */

test('parseId: digits pass through without a request', async () => {
  assert.equal(await threads.parseId!('18000000000000001'), '18000000000000001');
  assert.equal(await threads.parseId!('  18000000000000001 '), '18000000000000001');
  assert.equal(calls.length, 0);
});

test('parseId: every URL shape resolves through the permalink on a recent page', async () => {
  const page1 = { data: [{ id: '111', permalink: 'https://www.threads.net/@wenna.app/post/AAA111' }], paging: { cursors: { after: 'p2' } } };
  const page2 = { data: [{ id: '222', permalink: 'https://www.threads.net/@wenna.app/post/DBabcDEf123?xmt=1' }], paging: { cursors: {} } };
  handler = (u) => {
    assert.equal(u.pathname, `/v1.0/${USER}/threads`);
    return u.searchParams.get('after') === 'p2' ? page2 : page1;
  };
  for (const url of [
    'https://www.threads.net/@wenna.app/post/DBabcDEf123',
    'https://threads.net/@wenna.app/post/DBabcDEf123?xmt=AQF0',
    'https://www.threads.com/@wenna.app/post/DBabcDEf123/',
    'threads.net/@wenna.app/post/DBabcDEf123',
  ]) {
    calls = [];
    assert.equal(await threads.parseId!(url), '222', url);
    assert.equal(calls.length, 2, `${url}: found on the second page`);
    assertRequestsClean();
  }
  calls = [];
  assert.equal(await threads.parseId!('https://www.threads.net/@wenna.app/post/AAA111'), '111');
  assert.equal(calls.length, 1);
});

test('parseId: a post not in the last four pages throws by its code, never a handle', async () => {
  let n = 0;
  handler = () => ({ data: [{ id: String(++n), permalink: `https://www.threads.net/@wenna.app/post/OTHER${n}` }], paging: { cursors: { after: `c${n}` } } });
  await assert.rejects(threads.parseId!('https://www.threads.net/@someone.else/post/NOTHERE'), (e: Error) => {
    assert.match(e.message, /\/post\/NOTHERE/);
    assert.match(e.message, /last 100 Threads posts/);
    assert.ok(!e.message.includes('someone.else'));
    return true;
  });
  assert.equal(calls.length, 4);
});

test('parseId: garbage throws with a clear message and no request', async () => {
  for (const bad of ['', 'not a url', 'https://example.com/@wenna.app/post/ABC', 'https://www.threads.net/@wenna.app', 'DBabcDEf123']) {
    await assert.rejects(threads.parseId!(bad), /is not a Threads post id or a threads\.net/, bad);
  }
  assert.equal(calls.length, 0);
});

/* ----------------------------------------------------------------- token */

test('token: unconfigured says what is missing and makes no request', async () => {
  delete process.env.THREADS_ACCESS_TOKEN;
  assert.deepEqual(await threads.token!(), { platform: 'threads', configured: false, note: 'THREADS_ACCESS_TOKEN unset' });
  assert.equal(calls.length, 0);
});

test('token: accepted, with expiry from THREADS_TOKEN_EXPIRES', async () => {
  const expires = new Date(Date.now() + 45 * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
  process.env.THREADS_TOKEN_EXPIRES = expires;
  handler = (u) => {
    assert.equal(u.pathname, '/v1.0/me');
    assert.equal(u.searchParams.get('fields'), 'id');
    return { id: USER };
  };
  const got = await threads.token!();
  assert.equal(got.platform, 'threads');
  assert.equal(got.configured, true);
  assert.equal(got.note, 'accepted');
  assert.equal(got.expires, expires);
  assert.ok(got.daysLeft === 44 || got.daysLeft === 45, `daysLeft ${got.daysLeft}`);
  assert.ok(!JSON.stringify(got).includes(TOKEN));
  assertRequestsClean();
});

test('token: the placeholder case is reported as refused, without the token or the account id', async () => {
  handler = () => refused('Invalid OAuth access token - Cannot parse access token', 400);
  const got = await threads.token!();
  assert.equal(got.configured, true);
  assert.match(got.note!, /^refused: 400 .*Cannot parse access token/);
  assert.ok(!got.note!.includes(TOKEN));
  assert.ok(!got.note!.includes(USER));
  assert.equal(got.expires, undefined);
});

/* ------------------------------------------------------- no secret leaks */

test('an error whose body echoes the token back still carries no token', async () => {
  handler = (u) =>
    new Response(JSON.stringify({ error: { message: `bad request for ${u.toString()}`, access_token: TOKEN } }), { status: 400 });
  await assert.rejects(threads.metrics(MEDIA.id), (e: Error) => {
    assert.ok(!e.message.includes(TOKEN), e.message);
    assert.match(e.message, /access_token=…/);
    return true;
  });
});
