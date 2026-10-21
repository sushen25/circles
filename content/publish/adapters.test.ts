/**
 * Request shapes for the YouTube and TikTok adapters, with fetch stubbed:
 * nothing leaves the machine. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { bskyVideoBlob, clock, threads, tiktok, tiktokChunks, youtube, youtubePrivacy } from './adapters.ts';
import { challengeHex, listen } from './loopback.ts';
import { setEnvLine } from './envfile.ts';
import { existsSync, readFileSync } from 'node:fs';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let replies: ((c: Call) => Response)[] = [];
const realFetch = globalThis.fetch;

function bodyOf(b: unknown): unknown {
  if (b instanceof URLSearchParams) return Object.fromEntries(b);
  if (typeof b === 'string') return JSON.parse(b);
  if (b instanceof Uint8Array) return b.byteLength;
  return b;
}

beforeEach(() => {
  calls = [];
  replies = [];
  clock.sleep = async () => {};
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const c: Call = { url: String(input), method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: bodyOf(init.body) };
    calls.push(c);
    const next = replies.shift();
    if (!next) throw new Error(`unexpected fetch ${c.method} ${c.url}`);
    return next(c);
  }) as typeof fetch;
  Object.assign(process.env, {
    YOUTUBE_CLIENT_ID: 'yt-id',
    YOUTUBE_CLIENT_SECRET: 'yt-secret',
    YOUTUBE_REFRESH_TOKEN: 'yt-refresh',
    TIKTOK_CLIENT_KEY: 'tt-key',
    TIKTOK_CLIENT_SECRET: 'tt-secret',
    TIKTOK_REFRESH_TOKEN: 'tt-refresh',
    THREADS_ACCESS_TOKEN: 'th-token',
    THREADS_USER_ID: 'th-user',
  });
  delete process.env.YOUTUBE_PRIVACY;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const ok = (body: unknown, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status: 200, headers });
const tt = (data: unknown) => ok({ data, error: { code: 'ok', message: '' } });
const ttToken = ok({ access_token: 'tt-access', refresh_token: 'tt-refresh', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'o', scope: 'video.upload' });

function mp4(bytes = 1234): string {
  const p = join(mkdtempSync(join(tmpdir(), 'content-test-')), 'x.mp4');
  writeFileSync(p, Buffer.alloc(bytes));
  return p;
}

const caption = { text: 'She waited three weeks. wenna.app/?from=yt-x', hashtags: ['#friends'], title: 'What happens when the organiser stops' };

test('youtube: refresh, resumable session with title and tagged description, one PUT', async () => {
  replies.push(
    ok({ access_token: 'yt-access' }),
    () => new Response('', { status: 200, headers: { location: 'https://upload.example/session?id=1' } }),
    ok({ id: 'vid123' }),
  );
  const id = await youtube(caption, { localPaths: [], publicUrls: [], videoPath: mp4(1234) });
  assert.equal(id, 'vid123');

  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.deepEqual(calls[0].body, { client_id: 'yt-id', client_secret: 'yt-secret', refresh_token: 'yt-refresh', grant_type: 'refresh_token' });

  assert.match(calls[1].url, /^https:\/\/www\.googleapis\.com\/upload\/youtube\/v3\/videos\?uploadType=resumable&part=snippet,status$/);
  assert.equal(calls[1].headers.Authorization, 'Bearer yt-access');
  assert.equal(calls[1].headers['X-Upload-Content-Length'], '1234');
  assert.equal(calls[1].headers['X-Upload-Content-Type'], 'video/mp4');
  const meta = calls[1].body as { snippet: Record<string, string>; status: Record<string, unknown> };
  assert.equal(meta.snippet.title, caption.title);
  assert.equal(meta.snippet.description, 'She waited three weeks. wenna.app/?from=yt-x\n\n#friends');
  assert.deepEqual(meta.status, { privacyStatus: 'private', selfDeclaredMadeForKids: false });

  assert.equal(calls[2].url, 'https://upload.example/session?id=1');
  assert.equal(calls[2].method, 'PUT');
  assert.equal(calls[2].headers['Content-Type'], 'video/mp4');
  assert.equal(calls[2].body, 1234);
});

test('youtube: privacy comes from YOUTUBE_PRIVACY and rejects anything else', () => {
  assert.equal(youtubePrivacy(), 'private');
  process.env.YOUTUBE_PRIVACY = 'public';
  assert.equal(youtubePrivacy(), 'public');
  process.env.YOUTUBE_PRIVACY = 'everyone';
  assert.throws(() => youtubePrivacy(), /not one of/);
});

test('youtube: refuses without a title or a video, before any request', async () => {
  await assert.rejects(youtube({ ...caption, title: undefined }, { localPaths: [], publicUrls: [], videoPath: mp4() }), /title/);
  await assert.rejects(youtube(caption, { localPaths: [], publicUrls: [] }), /npm run video/);
  assert.equal(calls.length, 0);
});

test('tiktok: video goes to the inbox by FILE_UPLOAD, never Direct Post, and polls to SEND_TO_USER_INBOX', async () => {
  replies.push(
    ttToken,
    tt({ publish_id: 'p_1', upload_url: 'https://upload.tiktok.example/u?x=1' }),
    () => new Response('', { status: 201 }),
    tt({ status: 'PROCESSING_UPLOAD' }),
    tt({ status: 'SEND_TO_USER_INBOX' }),
  );
  const id = await tiktok({ text: 'three weeks', hashtags: [] }, { localPaths: [], publicUrls: [], videoPath: mp4(2000) });
  assert.equal(id, 'p_1');

  assert.equal(calls[0].url, 'https://open.tiktokapis.com/v2/oauth/token/');
  assert.deepEqual(calls[0].body, { client_key: 'tt-key', client_secret: 'tt-secret', grant_type: 'refresh_token', refresh_token: 'tt-refresh' });

  assert.equal(calls[1].url, 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/');
  assert.equal(calls[1].headers.Authorization, 'Bearer tt-access');
  assert.deepEqual(calls[1].body, { source_info: { source: 'FILE_UPLOAD', video_size: 2000, chunk_size: 2000, total_chunk_count: 1 } });

  assert.equal(calls[2].method, 'PUT');
  assert.equal(calls[2].url, 'https://upload.tiktok.example/u?x=1');
  assert.equal(calls[2].headers['Content-Range'], 'bytes 0-1999/2000');
  assert.equal(calls[2].headers['Content-Type'], 'video/mp4');

  assert.equal(calls[3].url, 'https://open.tiktokapis.com/v2/post/publish/status/fetch/');
  assert.deepEqual(calls[3].body, { publish_id: 'p_1' });
  assert.ok(!calls.some((c) => /video\/init\/$/.test(c.url) && !/inbox/.test(c.url)), 'never the Direct Post endpoint');
});

test('tiktok: JPEG stills go as a PHOTO draft, PULL_FROM_URL, MEDIA_UPLOAD', async () => {
  replies.push(ttToken, tt({ publish_id: 'p_2' }), tt({ status: 'SEND_TO_USER_INBOX' }));
  const photoUrls = ['https://media.example/x/01.jpg', 'https://media.example/x/02.jpg'];
  const id = await tiktok({ text: 'three weeks', hashtags: [] }, { localPaths: [], publicUrls: [], photoUrls, videoPath: mp4() });
  assert.equal(id, 'p_2');
  assert.equal(calls[1].url, 'https://open.tiktokapis.com/v2/post/publish/content/init/');
  assert.deepEqual(calls[1].body, {
    post_info: { description: 'three weeks' },
    source_info: { source: 'PULL_FROM_URL', photo_images: photoUrls, photo_cover_index: 0 },
    post_mode: 'MEDIA_UPLOAD',
    media_type: 'PHOTO',
  });
  assert.ok(!('privacy_level' in (calls[1].body as { post_info: object }).post_info), 'no Direct Post fields');
});

test('tiktok: a FAILED status throws with the reason', async () => {
  replies.push(ttToken, tt({ publish_id: 'p_3' }), tt({ status: 'FAILED', fail_reason: 'picture_size_check_failed' }));
  await assert.rejects(
    tiktok({ text: 'x', hashtags: [] }, { localPaths: [], publicUrls: [], photoUrls: ['https://m.example/01.jpg'] }),
    /picture_size_check_failed/,
  );
});

test('tiktok: an API error envelope throws', async () => {
  replies.push(ttToken, ok({ data: {}, error: { code: 'spam_risk_too_many_pending_share', message: 'too many' } }));
  await assert.rejects(tiktok({ text: 'x', hashtags: [] }, { localPaths: [], publicUrls: [], videoPath: mp4() }), /spam_risk_too_many_pending_share/);
});

test('tiktok: chunk plan follows the media transfer rules', () => {
  const MB = 1024 * 1024;
  assert.deepEqual(tiktokChunks(3 * MB), { chunkSize: 3 * MB, count: 1 });
  assert.deepEqual(tiktokChunks(64 * MB), { chunkSize: 64 * MB, count: 1 });
  assert.deepEqual(tiktokChunks(100 * MB + 5), { chunkSize: 10 * MB, count: 10 });
});

test('threads: a video is a VIDEO container by URL, polled to FINISHED, then published', async () => {
  replies.push(ok({ id: 'c1' }), ok({ status: 'IN_PROGRESS' }), ok({ status: 'FINISHED' }), ok({ id: 'post1' }));
  const videoUrl = 'https://media.example/x/x.mp4';
  const id = await threads({ text: 'a real question', hashtags: [] }, { localPaths: ['01.png'], publicUrls: ['https://media.example/x/01.png'], videoUrl });
  assert.equal(id, 'post1');
  assert.equal(calls[0].url, 'https://graph.threads.net/v1.0/th-user/threads');
  assert.deepEqual(calls[0].body, { media_type: 'VIDEO', video_url: videoUrl, text: 'a real question', access_token: 'th-token' });
  assert.equal(calls[1].url, 'https://graph.threads.net/v1.0/c1?fields=status,error_message&access_token=th-token');
  assert.equal(calls[3].url, 'https://graph.threads.net/v1.0/th-user/threads_publish');
  assert.deepEqual(calls[3].body, { creation_id: 'c1', access_token: 'th-token' });
});

test('threads: a video container in ERROR throws and never publishes', async () => {
  replies.push(ok({ id: 'c2' }), ok({ status: 'ERROR', error_message: 'bad codec' }));
  await assert.rejects(
    threads({ text: 'x', hashtags: [] }, { localPaths: [], publicUrls: [], videoUrl: 'https://media.example/x.mp4' }),
    /ERROR: bad codec/,
  );
  assert.equal(calls.length, 2);
});

const blobJson = { $type: 'blob', ref: { $link: 'bafkrei' }, mimeType: 'video/mp4', size: 1234 };
const bskySession = (seen: string[][]) => ({
  did: 'did:plc:wenna',
  pdsHost: 'puffball.us-east.host.bsky.network',
  serviceToken: async (aud: string, lxm: string) => (seen.push([aud, lxm]), 'svc-token'),
});

test('bluesky: a video goes to the video service with a PDS service token, and the processed blob comes back', async () => {
  const seen: string[][] = [];
  replies.push(
    ok({ jobStatus: { jobId: 'j1', did: 'did:plc:wenna', state: 'JOB_STATE_CREATED' } }),
    ok({ jobStatus: { jobId: 'j1', did: 'did:plc:wenna', state: 'JOB_STATE_ENCODING', progress: 50 } }),
    ok({ jobStatus: { jobId: 'j1', did: 'did:plc:wenna', state: 'JOB_STATE_COMPLETED', blob: blobJson } }),
  );
  const blob = await bskyVideoBlob(bskySession(seen), mp4(1234));
  assert.deepEqual(blob, blobJson);
  assert.deepEqual(seen, [['did:web:puffball.us-east.host.bsky.network', 'com.atproto.repo.uploadBlob']]);
  assert.match(calls[0].url, /^https:\/\/video\.bsky\.app\/xrpc\/app\.bsky\.video\.uploadVideo\?did=did%3Aplc%3Awenna&name=x\.mp4$/);
  assert.equal(calls[0].headers.Authorization, 'Bearer svc-token');
  assert.equal(calls[0].headers['Content-Type'], 'video/mp4');
  assert.equal(calls[0].body, 1234);
  assert.equal(calls[1].url, 'https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=j1');
});

test('bluesky: an already-processed video returns its blob from the error body', async () => {
  replies.push(() => new Response(JSON.stringify({ error: 'already_exists', jobId: 'j2', state: 'JOB_STATE_COMPLETED', blob: blobJson }), { status: 409 }));
  assert.deepEqual(await bskyVideoBlob(bskySession([]), mp4()), blobJson);
  assert.equal(calls.length, 1);
});

test('bluesky: a refused upload (say, an unverified email) throws with the reason', async () => {
  replies.push(() => new Response(JSON.stringify({ error: 'Unauthorized', message: 'email not verified' }), { status: 401 }));
  await assert.rejects(bskyVideoBlob(bskySession([]), mp4()), /401 Unauthorized email not verified/);
});

test('bluesky: a failed processing job throws', async () => {
  replies.push(
    ok({ jobStatus: { jobId: 'j3', state: 'JOB_STATE_CREATED' } }),
    ok({ jobStatus: { jobId: 'j3', state: 'JOB_STATE_FAILED', error: 'unsupported codec' } }),
  );
  await assert.rejects(bskyVideoBlob(bskySession([]), mp4()), /unsupported codec/);
});

test('loopback: hands over the code only when state matches', async () => {
  globalThis.fetch = realFetch;
  const good = await listen(0, '/callback/', 's1');
  const r = await fetch(`${good.redirectUri}?code=abc&state=s1`);
  assert.equal(r.status, 200);
  assert.equal(await good.code, 'abc');

  const bad = await listen(0, '/callback/', 's2');
  const caught = bad.code.catch((e: Error) => e.message);
  await fetch(`${bad.redirectUri}?code=abc&state=nope`);
  assert.match(String(await caught), /state/);
});

test('loopback: the TikTok challenge is hex SHA-256', () => {
  assert.equal(challengeHex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('envfile: rewrites one line, appends a missing one, and reports no .env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-env-'));
  const p = join(dir, '.env');
  writeFileSync(p, '# keep\nA=1\nTIKTOK_REFRESH_TOKEN=old\nB=2');
  assert.equal(setEnvLine('TIKTOK_REFRESH_TOKEN', 'new', p), true);
  assert.equal(setEnvLine('IG_TOKEN_EXPIRES', '2026-12-20', p), true);
  assert.equal(readFileSync(p, 'utf8'), '# keep\nA=1\nTIKTOK_REFRESH_TOKEN=new\nB=2\nIG_TOKEN_EXPIRES=2026-12-20\n');
  assert.equal(setEnvLine('X', 'y', join(dir, 'missing.env')), false);
  assert.equal(existsSync(join(dir, 'missing.env')), false);
});
