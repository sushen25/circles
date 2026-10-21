/**
 * getJson's retry and redaction against a stubbed fetch: a URL that carries
 * a token never reaches an error message, a thrown fetch and a 5xx are tried
 * once more and a 4xx is not, and withQuery builds the URL a module hands
 * its token through. fetch is stubbed before every test and restored after;
 * nothing here reaches the network.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { HttpError, clock, getJson, redact, withQuery } from './http.ts';

const realFetch = globalThis.fetch;
const realSleep = clock.sleep;
let calls: string[] = [];
let answers: (() => Response)[] = [];
const reply = (status: number, body: string) => () => new Response(body, { status });
const refuse = (message: string) => (): Response => {
  throw new Error(message);
};

before(() => {
  clock.sleep = async () => {};
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const next = answers.shift();
    if (!next) throw new Error('no answer scripted');
    return next();
  }) as typeof fetch;
});
beforeEach(() => {
  calls = [];
  answers = [];
});
after(() => {
  globalThis.fetch = realFetch;
  clock.sleep = realSleep;
});

const URL_WITH_TOKEN = 'https://graph.example.com/v1/me/insights?metric=views&access_token=SECRETTOKEN';
const REDACTED_URL = 'https://graph.example.com/v1/me/insights?metric=views&access_token=…';

test('a fetch that throws twice rejects after exactly two calls, with the token redacted', async () => {
  answers = [refuse('socket hang up'), refuse('socket hang up')];
  await assert.rejects(getJson(URL_WITH_TOKEN), (e: Error) => {
    assert.equal(e.message, `${REDACTED_URL}: socket hang up`);
    assert.doesNotMatch(e.message, /SECRETTOKEN/);
    return true;
  });
  assert.equal(calls.length, 2);
});

test('a 503 is tried once more, and the 200 that follows is returned as JSON', async () => {
  answers = [reply(503, '{"error":"down"}'), reply(200, '{"ok":1}')];
  assert.deepEqual(await getJson(URL_WITH_TOKEN), { ok: 1 });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c === URL_WITH_TOKEN), 'the request itself still carries the token');
});

test('two 5xx answers end in an HttpError after two calls; an empty 200 body is an empty object', async () => {
  answers = [reply(502, 'bad gateway'), reply(502, 'bad gateway')];
  await assert.rejects(getJson(URL_WITH_TOKEN), (e: HttpError) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 502);
    assert.equal(e.url, REDACTED_URL);
    return true;
  });
  assert.equal(calls.length, 2);

  calls = [];
  answers = [reply(200, '')];
  assert.deepEqual(await getJson(URL_WITH_TOKEN), {});
  assert.equal(calls.length, 1);
});

test('a 400 makes one call and throws an HttpError whose URL, body and message are redacted', async () => {
  answers = [reply(400, '{"error":{"message":"Error validating access token","code":190},"refresh_token":"SECRETTOKEN"}')];
  await assert.rejects(getJson(URL_WITH_TOKEN), (e: HttpError) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.name, 'HttpError');
    assert.equal(e.status, 400);
    assert.equal(e.url, REDACTED_URL);
    assert.equal(e.body, '{"error":{"message":"Error validating access token","code":190},"refresh_token":"…"}');
    assert.ok(e.message.startsWith(`400 ${REDACTED_URL}: `));
    assert.doesNotMatch(e.message, /SECRETTOKEN/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('redact: every key the regex names, as a query parameter, as a JSON field and as a Bearer header', () => {
  const table: [string, string][] = [
    ['https://x/?access_token=abc&fields=id', 'https://x/?access_token=…&fields=id'],
    ['https://x/?refresh_token=abc', 'https://x/?refresh_token=…'],
    ['client_secret=abc&grant_type=refresh_token', 'client_secret=…&grant_type=refresh_token'],
    ['https://www.googleapis.com/youtube/v3/videos?key=AIza123&id=x', 'https://www.googleapis.com/youtube/v3/videos?key=…&id=x'],
    ['token=abc', 'token=…'],
    ['secret=abc', 'secret=…'],
    ['password=hunter2 next', 'password=… next'],
    ['authorization=abc', 'authorization=…'],
    ['ACCESS_TOKEN=abc', 'ACCESS_TOKEN=…'],
    ['{"access_token":"abc","token_type":"bearer"}', '{"access_token":"…","token_type":"bearer"}'],
    ['{"refresh_token": "abc"}', '{"refresh_token": "…"}'],
    ['{"client_secret":"abc"}', '{"client_secret":"…"}'],
    ['{"token":"abc"}', '{"token":"…"}'],
    ['{"secret":"abc"}', '{"secret":"…"}'],
    ['{"password":"abc"}', '{"password":"…"}'],
    ['Authorization: Bearer ya29.abc-def_ghi/jk=', 'Authorization: Bearer …'],
    ['nothing to hide here', 'nothing to hide here'],
  ];
  for (const [input, want] of table) assert.equal(redact(input), want, input);
});

test('withQuery: sets what is given, drops an empty string and undefined, keeps zero, and encodes', () => {
  assert.equal(withQuery('https://x/api', { a: '1', b: '', c: undefined, d: 0 }), 'https://x/api?a=1&d=0');
  assert.equal(withQuery('https://x/api?grant_type=t', { access_token: 'abc' }), 'https://x/api?grant_type=t&access_token=abc');
  assert.equal(withQuery('https://x/api', { q: 'a b&c' }), 'https://x/api?q=a+b%26c');
  assert.equal(withQuery('https://x/api', {}), 'https://x/api');
});
