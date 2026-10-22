import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configured, fetchFunnel, parseExport, rowsOf, type FunnelExport } from './wenna.ts';

const EXPORT: FunnelExport = {
  since: '2026-10-19',
  by_source_ref: {
    'yt-never-lead-anywhere': { counters: { circles_created: 3, plans_created: 2, answers: 5, plans_confirmed: 1 }, events: { plan_shared: 2 } },
    'bs-open-seat': { counters: {}, events: {} },
  },
  stalled: [{ week: '2026-10-19', cohort: 'external', source: 'content', state: 'not_shared', circles: 1, oldest_hours: 30, median_hours: 30 }],
};

const reply = (status: number, body: unknown) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

test('it is configured only with both the URL and the secret', () => {
  const env = (m: Record<string, string>) => (k: string) => m[k];
  assert.deepEqual(configured(env({})), { ok: false, reason: 'WENNA_FUNNEL_URL, CONTENT_FUNNEL_SECRET unset' });
  assert.deepEqual(configured(env({ WENNA_FUNNEL_URL: 'https://x.test/f' })), { ok: false, reason: 'CONTENT_FUNNEL_SECRET unset' });
  assert.deepEqual(configured(env({ WENNA_FUNNEL_URL: 'https://x.test/f', CONTENT_FUNNEL_SECRET: 's' })), { ok: true, url: 'https://x.test/f', secret: 's' });
});

test('the request is a POST of { since } with the bearer, and nothing else', async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fake: typeof fetch = async (url, init) => {
    seen = { url: String(url), init: init! };
    return new Response(JSON.stringify(EXPORT));
  };
  const got = await fetchFunnel({ url: 'https://x.test/functions/v1/content-funnel', secret: 'the-secret', since: '2026-10-19', fetch: fake });
  assert.deepEqual(got, EXPORT);
  assert.equal(seen!.url, 'https://x.test/functions/v1/content-funnel');
  assert.equal(seen!.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(seen!.init.body)), { since: '2026-10-19' });
  const headers = seen!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer the-secret');
});

test('a refusal is an error that does not carry the secret', async () => {
  await assert.rejects(
    fetchFunnel({ url: 'https://x.test/f', secret: 'the-secret', since: '2026-10-19', fetch: reply(401, { message: 'Not something you can call. Bearer the-secret' }) }),
    (e: Error) => /401/.test(e.message) && !e.message.includes('the-secret'),
  );
});

test('an answer that is not the export is refused rather than read as zeros', async () => {
  await assert.rejects(fetchFunnel({ url: 'https://x.test/f', secret: 's', since: '2026-10-19', fetch: reply(200, 'not json') }), /not JSON/);
  assert.throws(() => parseExport({ since: '2026-10-19' }), /was not/);
  assert.throws(() => parseExport(null), /was not/);
});

test('one row per tag, with the counts named and the block kept whole, and one stalled row', () => {
  const { tags, stalled } = rowsOf(EXPORT, '2026-10-22', '2026-10-22T16:15:00.000Z');
  assert.deepEqual(
    tags.map(({ raw: _raw, ...r }) => r),
    [
      { date: '2026-10-22', at: '2026-10-22T16:15:00.000Z', from: 'bs-open-seat', circles: 0, plans_shared: 0, answered: 0, confirmed: 0 },
      { date: '2026-10-22', at: '2026-10-22T16:15:00.000Z', from: 'yt-never-lead-anywhere', circles: 3, plans_shared: 2, answered: 5, confirmed: 1 },
    ],
  );
  assert.deepEqual(tags[1].raw, EXPORT.by_source_ref['yt-never-lead-anywhere']);
  assert.deepEqual(stalled, { date: '2026-10-22', at: '2026-10-22T16:15:00.000Z', stalled: EXPORT.stalled });
});
