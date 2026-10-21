/**
 * `npm run tokens` against fake modules and a fake renew, plus the shared
 * Meta renewal itself with fetch stubbed and a temp .env. No network, no
 * gh, nothing under the repository touched.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { META, canRenewInstagram, renew } from '../publish/meta-tokens.ts';
import { clock } from './platforms/http.ts';
import type { PlatformModule, TokenState } from './platforms/module.ts';
import { formatToken, ghLines, run, shouldRenew, type Deps } from './tokens.ts';

// Midnight, so a date-only expiry (what .env holds) is a whole number of days away.
const NOW = new Date('2026-10-22T00:00:00.000Z');
const realFetch = globalThis.fetch;
const realSleep = clock.sleep;
clock.sleep = async () => {};
after(() => {
  globalThis.fetch = realFetch;
  clock.sleep = realSleep;
});

const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);

function mod(platform: PlatformModule['platform'], state: Partial<TokenState> | Error): PlatformModule {
  return {
    platform,
    configured: () => ({ ok: true }),
    metrics: async () => ({ metrics: {}, raw: {} }),
    replies: async () => [],
    token: async () => {
      if (state instanceof Error) throw state;
      return { platform, configured: true, ...state };
    },
  };
}

function harness(opts: { modules?: Deps['modules']; env?: Record<string, string>; renew?: Deps['renew']; envFile?: boolean } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const renewals: [string, { github?: boolean }][] = [];
  const deps: Partial<Deps> = {
    modules: opts.modules ?? {},
    env: (k) => opts.env?.[k],
    envFile: () => opts.envFile ?? true,
    renew:
      opts.renew ??
      (async (p, o) => {
        renewals.push([p, o]);
        return { ok: true, until: day(60) };
      }),
    now: () => NOW,
    log: (l) => out.push(l),
    error: (l) => err.push(l),
  };
  return { deps, out, err, renewals, text: () => [...out, ...err].join('\n') };
}

test('shouldRenew: unset or unreadable renews; more than a day old renews; younger waits', () => {
  assert.equal(shouldRenew(undefined, NOW), true);
  assert.equal(shouldRenew('soon', NOW), true);
  assert.equal(shouldRenew(day(60), NOW), false); // issued today
  assert.equal(shouldRenew(day(59), NOW), false); // issued yesterday: by date that may be minutes, so not yet
  assert.equal(shouldRenew(day(58), NOW), true); // two days by date is at least a day in fact
  assert.equal(shouldRenew(`${day(58)}T12:00:00Z`, NOW), true); // a full timestamp works too
  assert.equal(shouldRenew(day(30), NOW), true);
  assert.equal(shouldRenew(day(-1), NOW), true); // expired: the attempt fails loudly
});

test('formatToken: one line with what is known, never more', () => {
  assert.equal(formatToken({ platform: 'bluesky', configured: true, note: 'reads without a token' }, NOW), 'bluesky: configured; reads without a token');
  assert.equal(formatToken({ platform: 'youtube', configured: false, note: 'YOUTUBE_API_KEY unset' }, NOW), 'youtube: not configured; YOUTUBE_API_KEY unset');
  assert.equal(
    formatToken({ platform: 'instagram', configured: true, expires: day(59), scopes: ['instagram_business_basic', 'instagram_business_manage_insights'] }, NOW),
    `instagram: configured; expires ${day(59)} (59 days left); scopes instagram_business_basic instagram_business_manage_insights`,
  );
  assert.equal(formatToken({ platform: 'threads', configured: true, expires: day(5), daysLeft: 5 }, NOW), `threads: configured; expires ${day(5)} (5 days left)`);
  assert.equal(formatToken({ platform: 'threads', configured: true, expires: day(-3) }, NOW), `threads: configured; expires ${day(-3)} (expired 3 days ago)`);
});

test('ghLines read the token from .env and never carry it', () => {
  assert.deepEqual(ghLines('threads', '2026-12-21'), [
    "grep '^THREADS_ACCESS_TOKEN=' .env | cut -d= -f2- | gh secret set THREADS_ACCESS_TOKEN",
    'gh variable set THREADS_TOKEN_EXPIRES --body 2026-12-21',
  ]);
});

test('a wrong flag prints the usage and exits 2', async () => {
  const h = harness();
  assert.equal(await run(['--force'], h.deps), 2);
  assert.match(h.err.join('\n'), /usage: npm run tokens/);
});

test('reports every module with token(), renews nothing young, exits 0', async () => {
  const h = harness({
    modules: {
      bluesky: { ...mod('bluesky', {}), token: undefined },
      instagram: mod('instagram', { expires: day(59), scopes: ['instagram_business_basic'] }),
      youtube: mod('youtube', { configured: false, note: 'YOUTUBE_API_KEY unset' }),
    },
    env: { IG_ACCESS_TOKEN: 'IGAAsecret', IG_TOKEN_EXPIRES: day(59) },
  });
  assert.equal(await run([], h.deps), 0);
  assert.equal(h.renewals.length, 0);
  const text = h.text();
  assert.match(text, /^instagram: configured; expires .*; scopes instagram_business_basic$/m);
  assert.match(text, /^youtube: not configured; YOUTUBE_API_KEY unset$/m);
  assert.match(text, /instagram: issued under a day ago/);
  assert.doesNotMatch(text, /bluesky/);
  assert.doesNotMatch(text, /IGAAsecret/);
});

test('a token over a day old is renewed and the gh lines are printed without --github', async () => {
  const h = harness({
    modules: { threads: mod('threads', { expires: day(30) }) },
    env: { THREADS_ACCESS_TOKEN: 'THsecret', THREADS_TOKEN_EXPIRES: day(30) },
  });
  assert.equal(await run([], h.deps), 0);
  assert.deepEqual(h.renewals, [['threads', { github: false }]]);
  const text = h.text();
  assert.match(text, /threads: put the renewed token into the repository with/);
  assert.match(text, /gh secret set THREADS_ACCESS_TOKEN/);
  assert.match(text, new RegExp(`gh variable set THREADS_TOKEN_EXPIRES --body ${day(60)}`));
  assert.doesNotMatch(text, /THsecret/);
});

test('with --github renew runs the gh commands itself and no lines are printed', async () => {
  const h = harness({ env: { THREADS_ACCESS_TOKEN: 'THsecret' } });
  assert.equal(await run(['--github'], h.deps), 0);
  assert.deepEqual(h.renewals, [['threads', { github: true }]]);
  assert.doesNotMatch(h.text(), /gh secret set/);
});

test('--no-refresh reports only, and says when the expiry is unknown', async () => {
  const h = harness({ env: { THREADS_ACCESS_TOKEN: 'THsecret', IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: day(20) } });
  assert.equal(await run(['--no-refresh'], h.deps), 0);
  assert.equal(h.renewals.length, 0);
  assert.match(h.text(), /threads: THREADS_TOKEN_EXPIRES unset, so the expiry is unknown/);
  assert.doesNotMatch(h.text(), /no \.env here/);
});

test('with no .env and no --github (the Action) nothing is renewed, and a renewable token is pointed out', async () => {
  const h = harness({ env: { IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: day(20) }, envFile: false });
  assert.equal(await run([], h.deps), 0);
  assert.equal(h.renewals.length, 0);
  assert.match(h.text(), /instagram: a day old and renewable, but there is no \.env here and no --github/);

  const gh = harness({ env: { IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: day(20) }, envFile: false });
  assert.equal(await run(['--github'], gh.deps), 0);
  assert.deepEqual(gh.renewals, [['instagram', { github: true }]]);
});

test('a Facebook Login Instagram token is not sent for renewal', async () => {
  const h = harness({ env: { IG_ACCESS_TOKEN: 'EAABfacebook', IG_TOKEN_EXPIRES: day(10) } });
  assert.equal(await run([], h.deps), 0);
  assert.equal(h.renewals.length, 0);
  assert.match(h.text(), /instagram: a Facebook Login token; renew it in the Meta dashboard/);
});

test('exit 1 when a token expires within seven days, unless the renewal moved it', async () => {
  const stuck = harness({ env: { IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: day(5) }, renew: async () => ({ ok: true }) });
  assert.equal(await run([], stuck.deps), 1);
  assert.match(stuck.err.join('\n'), /instagram: token expires in 5 days/);

  const renewed = harness({ env: { IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: day(5) } });
  assert.equal(await run([], renewed.deps), 0);

  const noRefresh = harness({ env: { IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: day(-2) } });
  assert.equal(await run(['--no-refresh'], noRefresh.deps), 1);
  assert.match(noRefresh.err.join('\n'), /instagram: token expired \(/);
});

test('exit 1 when a module refuses or a renewal fails; the error line is redacted', async () => {
  const refused = harness({ modules: { youtube: mod('youtube', new Error('401 https://x/?access_token=ya29.secret: bad')) } });
  assert.equal(await run([], refused.deps), 1);
  assert.match(refused.err.join('\n'), /youtube: refused: 401 https:\/\/x\/\?access_token=… bad/);
  assert.doesNotMatch(refused.text(), /ya29\.secret/);

  const failed = harness({ env: { THREADS_ACCESS_TOKEN: 'x', THREADS_TOKEN_EXPIRES: day(30) }, renew: async () => ({ ok: false }) });
  assert.equal(await run([], failed.deps), 1);
});

test("a non-Meta module's own expiry date is checked too", async () => {
  const h = harness({ modules: { youtube: mod('youtube', { expires: day(3), daysLeft: 3 }) } });
  assert.equal(await run([], h.deps), 1);
  assert.match(h.err.join('\n'), /youtube: token expires in 3 days/);
});

test('the boundary is the one metrics.ts owns, the same as the pull: seven days fails, eight does not', async () => {
  const seven = harness({ env: { IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: day(7) } });
  assert.equal(await run(['--no-refresh'], seven.deps), 1);
  assert.match(seven.err.join('\n'), /instagram: token expires in 7 days/);
  const eight = harness({ env: { IG_ACCESS_TOKEN: 'IGAAx', IG_TOKEN_EXPIRES: day(8) } });
  assert.equal(await run(['--no-refresh'], eight.deps), 0);
  assert.equal(eight.err.length, 0);

  const ytSeven = harness({ modules: { youtube: mod('youtube', { expires: day(7) }) } });
  assert.equal(await run([], ytSeven.deps), 1);
  assert.match(ytSeven.err.join('\n'), /youtube: token expires in 7 days/);
  const ytEight = harness({ modules: { youtube: mod('youtube', { expires: day(8) }) } });
  assert.equal(await run([], ytEight.deps), 0);
});

/* ---------------------------------------------------- publish/meta-tokens */

test('canRenewInstagram: Instagram Login tokens and an unset token, not Facebook Login', () => {
  assert.equal(canRenewInstagram('IGAAabc'), true);
  assert.equal(canRenewInstagram(undefined), true);
  assert.equal(canRenewInstagram(''), true);
  assert.equal(canRenewInstagram('EAABabc'), false);
});

test('renew: the token travels as a query parameter, .env gains both lines, gh is handed the token on stdin, and nothing printed carries it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meta-tokens-'));
  const envPath = join(dir, '.env');
  writeFileSync(envPath, 'THREADS_USER_ID=u\nTHREADS_ACCESS_TOKEN=THold\n');
  const calls: string[] = [];
  const execs: [string, string[], string | undefined][] = [];
  const logs: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  const realWarn = console.warn;
  console.log = (l: string) => logs.push(l);
  console.error = (l: string) => logs.push(l);
  console.warn = (l: string) => logs.push(l);
  globalThis.fetch = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ access_token: 'THnew', token_type: 'bearer', expires_in: 5_184_000 }), { status: 200 });
  }) as typeof fetch;
  const saved = process.env.THREADS_ACCESS_TOKEN;
  process.env.THREADS_ACCESS_TOKEN = 'THold';
  try {
    const r = await renew('threads', { github: true, envPath, exec: (c, a, i) => void execs.push([c, a, i]), now: () => NOW });
    assert.deepEqual(r, { ok: true, until: day(60) });
    assert.deepEqual(calls, [`${META.threads.url}&access_token=THold`]);
    assert.equal(readFileSync(envPath, 'utf8'), `THREADS_USER_ID=u\nTHREADS_ACCESS_TOKEN=THnew\nTHREADS_TOKEN_EXPIRES=${day(60)}\n`);
    assert.deepEqual(execs, [
      ['gh', ['secret', 'set', 'THREADS_ACCESS_TOKEN'], 'THnew'],
      ['gh', ['variable', 'set', 'THREADS_TOKEN_EXPIRES', '--body', day(60)], undefined],
    ]);
    assert.deepEqual(logs, [`threads: renewed, valid until ${day(60)}; repo secret updated`]);
    assert.doesNotMatch(logs.join('\n'), /THold|THnew/);
  } finally {
    if (saved === undefined) delete process.env.THREADS_ACCESS_TOKEN;
    else process.env.THREADS_ACCESS_TOKEN = saved;
    console.log = realLog;
    console.error = realError;
    console.warn = realWarn;
    globalThis.fetch = realFetch;
  }
});

test('renew: a refusal prints the status and the message, never the token, and is ok: false; an unset token is skipped', async () => {
  const logs: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (l: string) => logs.push(l);
  console.error = (l: string) => logs.push(l);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'Error validating access token: IGAAsecret has expired', code: 190 } }), { status: 400 })) as typeof fetch;
  const saved = process.env.IG_ACCESS_TOKEN;
  process.env.IG_ACCESS_TOKEN = 'IGAAsecret';
  try {
    assert.deepEqual(await renew('instagram', { envPath: join(mkdtempSync(join(tmpdir(), 'meta-tokens-')), '.env') }), { ok: false });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^instagram: renewal failed: 400 Error validating access token: … has expired$/);
    assert.doesNotMatch(logs.join('\n'), /IGAAsecret/);
    delete process.env.IG_ACCESS_TOKEN;
    logs.length = 0;
    assert.deepEqual(await renew('instagram'), { ok: true });
    assert.deepEqual(logs, ['instagram: IG_ACCESS_TOKEN not set, skipped']);
  } finally {
    if (saved === undefined) delete process.env.IG_ACCESS_TOKEN;
    else process.env.IG_ACCESS_TOKEN = saved;
    console.log = realLog;
    console.error = realError;
    globalThis.fetch = realFetch;
  }
});
