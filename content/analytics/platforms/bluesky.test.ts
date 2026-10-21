/**
 * The Bluesky module against fixtures, with fetch stubbed: nothing leaves
 * the machine and nothing is written. Every method is covered, and the
 * rules that nothing downstream can check are pinned here: the author never
 * leaves `replies()`, the account's own replies are dropped, a handle in
 * reply text survives (stripping is the pull's job), and no error carries a
 * secret. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { bluesky } from './bluesky.ts';
import { clock } from './http.ts';

type Call = { url: string; method: string };
let calls: Call[] = [];
let replies: ((c: Call) => Response)[] = [];
const realFetch = globalThis.fetch;
const realSleep = clock.sleep;
const savedEnv = { BSKY_HANDLE: process.env.BSKY_HANDLE, BSKY_APP_PASSWORD: process.env.BSKY_APP_PASSWORD };

const OWN_DID = 'did:plc:ownaccount000000000000000';
const OWN_URI = `at://${OWN_DID}/app.bsky.feed.post/3abcdefghij2k`;
const APP_PASSWORD = 'app-password-never-read';

beforeEach(() => {
  calls = [];
  replies = [];
  clock.sleep = async () => {};
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const c: Call = { url: String(input), method: init.method ?? 'GET' };
    calls.push(c);
    const next = replies.shift();
    if (!next) throw new Error(`unexpected fetch ${c.method} ${c.url}`);
    return next(c);
  }) as typeof fetch;
  process.env.BSKY_HANDLE = 'account.test';
  process.env.BSKY_APP_PASSWORD = APP_PASSWORD;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

after(() => {
  clock.sleep = realSleep;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number, body: unknown) => () => new Response(JSON.stringify(body), { status: code });
const query = (url: string) => Object.fromEntries(new URL(url).searchParams);
const path = (url: string) => new URL(url).origin + new URL(url).pathname;

/** A post view as the AppView returns one: the author block is the account's own profile. */
const postView = (over: Record<string, unknown> = {}) => ({
  uri: OWN_URI,
  cid: 'bafyreiabc',
  author: { did: OWN_DID, handle: 'account.test', displayName: 'Account', avatar: 'https://cdn.example/a.jpg' },
  record: { $type: 'app.bsky.feed.post', text: 'She waited three weeks. wenna.app/?from=bs-only-moves', createdAt: '2026-10-21T06:40:03.537Z', langs: ['en-AU'] },
  indexedAt: '2026-10-21T06:40:04.000Z',
  likeCount: 12,
  repostCount: 3,
  replyCount: 4,
  quoteCount: 1,
  ...over,
});

const reply = (rkey: string, did: string, text: string, createdAt: string | undefined, over: Record<string, unknown> = {}) => ({
  post: {
    uri: `at://${did}/app.bsky.feed.post/${rkey}`,
    author: { did, handle: `${rkey}.test`, displayName: 'Someone' },
    record: { text, ...(createdAt ? { createdAt } : {}) },
    indexedAt: '2026-10-22T00:00:00.000Z',
    likeCount: 0,
    ...over,
  },
});

test('platform and configured: always ok, with or without BSKY_HANDLE', () => {
  assert.equal(bluesky.platform, 'bluesky');
  assert.deepEqual(bluesky.configured(), { ok: true });
  delete process.env.BSKY_HANDLE;
  assert.deepEqual(bluesky.configured(), { ok: true });
  assert.equal(calls.length, 0);
});

test('metrics: one getPosts call, four counts mapped, the whole response as raw', async () => {
  const body = { posts: [postView()] };
  replies.push(ok(body));
  const got = await bluesky.metrics(OWN_URI);
  assert.deepEqual(got.metrics, { likes: 12, reposts: 3, replies: 4, quotes: 1 });
  assert.deepEqual(got.raw, body);
  assert.equal(calls.length, 1);
  assert.equal(path(calls[0].url), 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts');
  assert.deepEqual(query(calls[0].url), { uris: OWN_URI });
});

test('metrics: a count the platform leaves out is left out, the rest kept, raw untouched', async () => {
  const { quoteCount: _dropped, ...withoutQuotes } = postView();
  const body = { posts: [withoutQuotes] };
  replies.push(ok(body));
  const got = await bluesky.metrics(OWN_URI);
  assert.deepEqual(got.metrics, { likes: 12, reposts: 3, replies: 4 });
  assert.deepEqual(got.raw, body);
});

test('metrics: a deleted post throws by uri', async () => {
  replies.push(ok({ posts: [] }));
  await assert.rejects(bluesky.metrics(OWN_URI), (e: Error) => e.message.includes(OWN_URI) && /no post/.test(e.message));
});

test('metrics: one retry on a 5xx, through http.ts, without waiting', async () => {
  replies.push(status(503, { error: 'InternalServerError' }), ok({ posts: [postView()] }));
  const got = await bluesky.metrics(OWN_URI);
  assert.equal(got.metrics.likes, 12);
  assert.equal(calls.length, 2);
});

test('metrics: a refused call throws a message that carries no secret', async () => {
  replies.push(status(400, { error: 'InvalidRequest', message: 'nope', token: 'leaked-value', access_token: 'leaked-too' }));
  await assert.rejects(bluesky.metrics(OWN_URI), (e: Error) => {
    assert.match(e.message, /^400 /);
    assert.doesNotMatch(e.message, /leaked/);
    assert.doesNotMatch(e.message, new RegExp(APP_PASSWORD));
    assert.doesNotMatch(e.message, /token=/);
    return true;
  });
  assert.doesNotMatch(calls[0].url, /token|password/i);
});

test('replies: every depth flattened, the account dropped, placeholders skipped, author never returned', async () => {
  const thread = {
    thread: {
      $type: 'app.bsky.feed.defs#threadViewPost',
      post: postView(),
      replies: [
        {
          ...reply('r1', 'did:plc:alice', 'this is so real', '2026-10-21T07:00:00.000Z'),
          replies: [
            // the account answering alice: dropped, but alice's answer under it is kept
            {
              ...reply('r2', OWN_DID, 'thank you, it was a long three weeks', '2026-10-21T07:10:00.000Z'),
              replies: [reply('r3', 'did:plc:alice', 'still waiting on @bob.test to reply tbh', '2026-10-21T07:20:00.000Z')],
            },
          ],
        },
        { $type: 'app.bsky.feed.defs#blockedPost', uri: 'at://did:plc:blocked/app.bsky.feed.post/r4', blocked: true, author: { did: 'did:plc:blocked' } },
        { $type: 'app.bsky.feed.defs#notFoundPost', uri: 'at://did:plc:gone/app.bsky.feed.post/r5', notFound: true },
        reply('r6', 'did:plc:carol', 'no createdAt on this one', undefined),
      ],
    },
  };
  replies.push(ok(thread));
  const got = await bluesky.replies(OWN_URI);
  assert.deepEqual(got, [
    { id: 'at://did:plc:alice/app.bsky.feed.post/r1', at: '2026-10-21T07:00:00.000Z', text: 'this is so real' },
    { id: 'at://did:plc:alice/app.bsky.feed.post/r3', at: '2026-10-21T07:20:00.000Z', text: 'still waiting on @bob.test to reply tbh' },
    { id: 'at://did:plc:carol/app.bsky.feed.post/r6', at: '2026-10-22T00:00:00.000Z', text: 'no createdAt on this one' },
  ]);
  for (const r of got) assert.deepEqual(Object.keys(r).sort(), ['at', 'id', 'text']);
  // the handle inside the text is left as written: stripping is the pull's job (metrics.ts stripHandles)
  assert.match(got[1].text, /@bob\.test/);
  assert.equal(calls.length, 1);
  assert.equal(path(calls[0].url), 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread');
  assert.deepEqual(query(calls[0].url), { uri: OWN_URI, depth: '10' });
});

test('replies: since skips what came before it and keeps what came at or after', async () => {
  const thread = {
    thread: {
      post: postView(),
      replies: [
        reply('r1', 'did:plc:alice', 'old', '2026-10-21T07:00:00.000Z'),
        reply('r2', 'did:plc:bob', 'on the line', '2026-10-22T00:00:00.000Z'),
        reply('r3', 'did:plc:carol', 'new', '2026-10-23T09:00:00.000Z'),
      ],
    },
  };
  replies.push(ok(thread));
  const got = await bluesky.replies(OWN_URI, '2026-10-22T00:00:00.000Z');
  assert.deepEqual(got.map((r) => r.text), ['on the line', 'new']);
});

test('replies: an unreadable thread throws by uri', async () => {
  replies.push(ok({ thread: { $type: 'app.bsky.feed.defs#notFoundPost', uri: OWN_URI, notFound: true } }));
  await assert.rejects(bluesky.replies(OWN_URI), (e: Error) => e.message.includes(OWN_URI) && /not readable/.test(e.message));
});

test('account: getProfile by BSKY_HANDLE, three counts, no breakdowns, the response whole under raw.profile', async () => {
  const profile = { did: OWN_DID, handle: 'account.test', displayName: 'Account', followersCount: 41, followsCount: 12, postsCount: 7, indexedAt: '2026-10-21T00:00:00.000Z' };
  replies.push(ok(profile));
  const got = await bluesky.account!('2026-10-21');
  assert.deepEqual(got.metrics, { followers: 41, follows: 12, posts: 7 });
  assert.deepEqual(got.breakdowns, {});
  assert.deepEqual(got.raw, { profile });
  assert.equal(path(calls[0].url), 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile');
  assert.deepEqual(query(calls[0].url), { actor: 'account.test' });
});

test('account: a count the platform refuses is left out and the rest is kept', async () => {
  const profile = { did: OWN_DID, handle: 'account.test', followersCount: 41, followsCount: 12 };
  replies.push(ok(profile));
  const got = await bluesky.account!('2026-10-21');
  assert.deepEqual(got.metrics, { followers: 41, follows: 12 });
  assert.deepEqual(got.raw, { profile });
});

test('account: BSKY_HANDLE unset throws before any call', async () => {
  delete process.env.BSKY_HANDLE;
  await assert.rejects(bluesky.account!('2026-10-21'), /BSKY_HANDLE unset/);
  assert.equal(calls.length, 0);
});

test('account: a refused profile throws, and the message carries no secret', async () => {
  replies.push(status(403, { error: 'Forbidden', token: 'leaked-value' }));
  await assert.rejects(bluesky.account!('2026-10-21'), (e: Error) => {
    assert.match(e.message, /^403 /);
    assert.doesNotMatch(e.message, /leaked/);
    assert.doesNotMatch(e.message, new RegExp(APP_PASSWORD));
    return true;
  });
});

test('recent: the author feed without replies, reposts dropped, newest first, id, time and text only', async () => {
  const feed = {
    feed: [
      { post: postView({ uri: `at://${OWN_DID}/app.bsky.feed.post/p2`, record: { text: 'second. wenna.app/?from=bs-second', createdAt: '2026-10-22T06:00:00.000Z' } }) },
      {
        post: postView({ uri: 'at://did:plc:someoneelse/app.bsky.feed.post/x1', author: { did: 'did:plc:someoneelse', handle: 'else.test' }, record: { text: 'their post', createdAt: '2026-10-21T20:00:00.000Z' } }),
        reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: { did: OWN_DID, handle: 'account.test' }, indexedAt: '2026-10-21T21:00:00.000Z' },
      },
      { post: postView({ uri: `at://${OWN_DID}/app.bsky.feed.post/p1`, record: { text: 'first. wenna.app/?from=bs-first', createdAt: '2026-10-21T06:40:03.537Z' } }) },
    ],
    cursor: 'abc',
  };
  replies.push(ok(feed));
  const got = await bluesky.recent!();
  assert.deepEqual(got, [
    { id: `at://${OWN_DID}/app.bsky.feed.post/p2`, at: '2026-10-22T06:00:00.000Z', text: 'second. wenna.app/?from=bs-second' },
    { id: `at://${OWN_DID}/app.bsky.feed.post/p1`, at: '2026-10-21T06:40:03.537Z', text: 'first. wenna.app/?from=bs-first' },
  ]);
  assert.equal(path(calls[0].url), 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed');
  assert.deepEqual(query(calls[0].url), { actor: 'account.test', limit: '50', filter: 'posts_no_replies' });
});

test('recent: BSKY_HANDLE unset throws before any call', async () => {
  delete process.env.BSKY_HANDLE;
  await assert.rejects(bluesky.recent!(), /BSKY_HANDLE unset/);
  assert.equal(calls.length, 0);
});

test('postedAt: the record time, indexedAt when the record has none, undefined when the post is gone', async () => {
  replies.push(ok({ posts: [postView()] }));
  assert.equal(await bluesky.postedAt!(OWN_URI), '2026-10-21T06:40:03.537Z');
  replies.push(ok({ posts: [postView({ record: { text: 'no time' } })] }));
  assert.equal(await bluesky.postedAt!(OWN_URI), '2026-10-21T06:40:04.000Z');
  replies.push(ok({ posts: [] }));
  assert.equal(await bluesky.postedAt!(OWN_URI), undefined);
  assert.equal(calls.length, 3);
  assert.deepEqual(query(calls[0].url), { uris: OWN_URI });
});

test('parseId: an at:// post uri passes through untouched, with no call', async () => {
  assert.equal(await bluesky.parseId!(OWN_URI), OWN_URI);
  assert.equal(await bluesky.parseId!(`  ${OWN_URI}\n`), OWN_URI);
  assert.equal(calls.length, 0);
});

test('parseId: a bsky.app link with a did builds the uri, with no call', async () => {
  const want = `at://${OWN_DID}/app.bsky.feed.post/3abcdefghij2k`;
  assert.equal(await bluesky.parseId!(`https://bsky.app/profile/${OWN_DID}/post/3abcdefghij2k`), want);
  assert.equal(await bluesky.parseId!(`bsky.app/profile/${OWN_DID}/post/3abcdefghij2k`), want);
  assert.equal(await bluesky.parseId!(`https://www.bsky.app/profile/${OWN_DID}/post/3abcdefghij2k?ref=share#x`), want);
  assert.equal(calls.length, 0);
});

test('parseId: a bsky.app link with a handle resolves it once and builds the uri', async () => {
  replies.push(ok({ did: OWN_DID }));
  const got = await bluesky.parseId!('https://bsky.app/profile/account.test/post/3abcdefghij2k');
  assert.equal(got, `at://${OWN_DID}/app.bsky.feed.post/3abcdefghij2k`);
  assert.equal(calls.length, 1);
  assert.equal(path(calls[0].url), 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle');
  assert.deepEqual(query(calls[0].url), { handle: 'account.test' });
});

test('parseId: a handle that does not resolve throws with the status and without the handle', async () => {
  replies.push(status(400, { error: 'InvalidRequest', message: 'Unable to resolve handle' }));
  await assert.rejects(bluesky.parseId!('https://bsky.app/profile/nobody.test/post/3abcdefghij2k'), (e: Error) => {
    assert.match(e.message, /could not resolve the handle/);
    assert.match(e.message, /\(400\)/);
    assert.doesNotMatch(e.message, /nobody\.test/);
    return true;
  });
  replies.push(ok({}));
  await assert.rejects(bluesky.parseId!('https://bsky.app/profile/nobody.test/post/3abcdefghij2k'), /resolved to no did/);
});

test('parseId: garbage, a profile link without a post, and a non-post at:// uri are refused by name', async () => {
  await assert.rejects(bluesky.parseId!('not a link'), /cannot read a post id from "not a link"/);
  await assert.rejects(bluesky.parseId!(''), /cannot read a post id/);
  await assert.rejects(bluesky.parseId!('https://bsky.app/profile/account.test'), /cannot read a post id/);
  await assert.rejects(bluesky.parseId!('https://example.com/profile/account.test/post/abc'), /cannot read a post id/);
  await assert.rejects(bluesky.parseId!('https://www.threads.net/@account/post/abc'), /cannot read a post id/);
  await assert.rejects(bluesky.parseId!('at://did:plc:x'), /not a post uri/);
  await assert.rejects(bluesky.parseId!(`at://${OWN_DID}/app.bsky.feed.like/abc`), /not a post uri/);
  assert.equal(calls.length, 0);
});

test('token: configured, no expiry, the note says whether BSKY_HANDLE is set and never what it is', async () => {
  const withHandle = await bluesky.token!();
  assert.equal(withHandle.platform, 'bluesky');
  assert.equal(withHandle.configured, true);
  assert.equal(withHandle.expires, undefined);
  assert.match(withHandle.note ?? '', /public reads need no token/);
  assert.match(withHandle.note ?? '', /BSKY_HANDLE is set/);
  assert.doesNotMatch(JSON.stringify(withHandle), /account\.test/);
  assert.doesNotMatch(JSON.stringify(withHandle), new RegExp(APP_PASSWORD));

  delete process.env.BSKY_HANDLE;
  const without = await bluesky.token!();
  assert.equal(without.configured, true);
  assert.match(without.note ?? '', /BSKY_HANDLE is unset/);
  assert.equal(calls.length, 0);
});
