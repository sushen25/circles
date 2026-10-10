// Run by `pnpm check:workflows` with `node --test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decide, judge } from './green-check.mjs';
import { judgeNeeds } from './check-verdict.mjs';
import { markdown, summarise } from './live-summary.mjs';
import { isProdTag, resolve, tagFor, tagMatchesSha } from './release.mjs';
import { judgePreview, judgeShell, smoke } from './smoke-web.mjs';
import {
  renderRollback,
  changedFunctions,
  isTransactional,
  parseNameStatus,
  render,
  sharedChanged,
} from './prod-plan.mjs';

const run = (over) => ({
  id: 1,
  name: 'check',
  app: { slug: 'github-actions' },
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-10-09T01:00:00Z',
  ...over,
});

test('a completed success is the only green', () => {
  assert.equal(judge([run()]).state, 'green');
});

test('every other outcome is not green', () => {
  assert.equal(judge([]).state, 'none');
  assert.equal(judge(undefined).state, 'none');
  assert.equal(judge([run({ status: 'queued', conclusion: null })]).state, 'pending');
  assert.equal(judge([run({ status: 'in_progress', conclusion: null })]).state, 'pending');
  for (const conclusion of [
    'failure',
    'cancelled',
    'timed_out',
    'skipped',
    'neutral',
    'action_required',
    null,
  ]) {
    assert.equal(judge([run({ conclusion })]).state, 'red', String(conclusion));
  }
});

test('the latest run decides, so a re-run replaces a cancelled one and a red one replaces a green one', () => {
  const cancelled = run({ id: 1, conclusion: 'cancelled', started_at: '2026-10-09T01:00:00Z' });
  const green = run({ id: 2, started_at: '2026-10-09T02:00:00Z' });
  assert.equal(judge([cancelled, green]).state, 'green');
  assert.equal(judge([green, cancelled]).state, 'green');
  const red = run({ id: 3, conclusion: 'failure', started_at: '2026-10-09T03:00:00Z' });
  assert.equal(judge([green, red]).state, 'red');
});

test('only a GitHub Actions run named check counts', () => {
  assert.equal(judge([run({ app: { slug: 'some-app' } })]).state, 'none');
  assert.equal(judge([run({ app: null })]).state, 'none');
  assert.equal(judge([run({ name: 'preview' })]).state, 'none');
});

test('without --wait anything unfinished fails; with it, only a run that never appears does', () => {
  const state = (s) => ({ state: s, message: '' });
  const now = { waiting: false, noRunForSeconds: 0, graceSeconds: 300 };
  assert.equal(decide(state('green'), now), 'done');
  assert.equal(decide(state('pending'), now), 'fail');
  assert.equal(decide(state('none'), now), 'fail');
  const wait = { waiting: true, noRunForSeconds: 10, graceSeconds: 300 };
  assert.equal(decide(state('pending'), wait), 'retry');
  assert.equal(decide(state('none'), wait), 'retry');
  assert.equal(decide(state('none'), { ...wait, noRunForSeconds: 300 }), 'fail');
  assert.equal(decide(state('red'), wait), 'fail');
});

test('a migration is transactional only if it opens and closes its own transaction', () => {
  assert.equal(isTransactional('begin;\ncreate table t();\ncommit;\n'), true);
  assert.equal(isTransactional('-- header\nBEGIN;\nselect 1;\nCOMMIT;'), true);
  assert.equal(isTransactional('create table t();\n'), false);
  assert.equal(isTransactional('begin;\nselect 1;\n'), false);
});

test('names and paths are read out of git output', () => {
  assert.deepEqual(
    parseNameStatus('A\tsupabase/migrations/0029_x.sql\nM\tsupabase/migrations/0001_y.sql\n'),
    [
      ['A', 'supabase/migrations/0029_x.sql'],
      ['M', 'supabase/migrations/0001_y.sql'],
    ],
  );
  assert.deepEqual(
    changedFunctions([
      'supabase/functions/b/index.ts',
      'supabase/functions/a/x.ts',
      'supabase/functions/b/y.ts',
      'README.md',
      '',
    ]),
    ['a', 'b'],
  );
});

test('the plan names each migration and warns about the one with no transaction', () => {
  const text = render({
    base: 'a'.repeat(40),
    sha: 'b'.repeat(40),
    migrations: [
      { file: '0025_cadence.sql', status: 'new', transactional: false },
      { file: '0026_quiet_ask.sql', status: 'new', transactional: true },
    ],
    functions: ['answer-interest'],
    note: null,
  });
  assert.match(text, /Migrations to apply: 2/);
  assert.match(text, /0025_cadence\.sql.*half applied/);
  assert.match(text, /0026_quiet_ask\.sql.*begin … commit/);
  assert.match(text, /answer-interest/);
  assert.match(
    render({ base: null, sha: 'b'.repeat(40), migrations: [], functions: [], note: null }),
    /No earlier successful production deployment/,
  );
});

test('shared code is not an endpoint, and a change to it is named', () => {
  assert.deepEqual(
    changedFunctions(['supabase/functions/_shared/http.ts', 'supabase/functions/a/x.ts']),
    ['a'],
  );
  assert.deepEqual(
    sharedChanged([
      'supabase/functions/_shared/http.ts',
      'supabase/functions/import_map.json',
      'packages/domain/src/x.ts',
      'pnpm-lock.yaml',
      'supabase/functions/a/x.ts',
    ]),
    [
      'supabase/functions/_shared/http.ts',
      'supabase/functions/import_map.json',
      'packages/domain/src/x.ts',
      'pnpm-lock.yaml',
    ],
  );
  const text = render({
    base: 'a'.repeat(40),
    sha: 'b'.repeat(40),
    migrations: [],
    functions: [],
    shared: ['packages/domain/src/x.ts'],
    note: null,
  });
  assert.match(text, /every Edge Function is redeployed/);
});

test('a newer run that has not started yet is the verdict, not the older success before it', () => {
  const older = run({ id: 1 });
  const queued = run({ id: 2, status: 'queued', conclusion: null, started_at: null });
  assert.equal(judge([older, queued]).state, 'pending');
  assert.equal(judge([queued, older]).state, 'pending');
});

// --- tags and rollback (SUS-144) -------------------------------------------

const SHA = '2c0f807' + 'a'.repeat(33);

test('a release tag is the UTC day and the short sha', () => {
  assert.equal(tagFor(new Date('2026-10-09T23:59:59Z'), SHA), 'prod-20261009-2c0f807');
  assert.equal(tagFor(new Date('2026-10-10T00:00:00Z'), SHA), 'prod-20261010-2c0f807');
});

test('only our own tag names are production tags', () => {
  assert.ok(isProdTag('prod-20261009-2c0f807'));
  for (const bad of [
    '',
    'prod-',
    'dev-20261009-2c0f807',
    'prod-20261009-2c0f80',
    'prod-20261009-2C0F807',
    'main',
    'prod-20261009-2c0f807;rm',
    undefined,
  ]) {
    assert.equal(isProdTag(bad), false, String(bad));
  }
});

test('a tag matches only the commit its name says', () => {
  assert.ok(tagMatchesSha('prod-20261009-2c0f807', SHA));
  assert.equal(tagMatchesSha('prod-20261009-2c0f807', 'b'.repeat(40)), false);
  assert.equal(tagMatchesSha('prod-20261009-2c0f807', '2c0f807'), false);
});

test('resolve: no tag deploys the dispatched commit; a tag must be ours, unmoved and an ancestor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sus144-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'a@example.com');
  git('config', 'user.name', 'a');
  git('config', 'commit.gpgsign', 'false');
  const commit = (n) => {
    writeFileSync(join(dir, 'f'), n);
    git('add', 'f');
    git('commit', '-q', '-m', n);
    return git('rev-parse', 'HEAD');
  };
  const first = commit('1');
  const second = commit('2');
  git('checkout', '-q', '-b', 'side', first);
  const stray = commit('3');
  git('checkout', '-q', 'main');
  const good = `prod-20261001-${first.slice(0, 7)}`;
  git('tag', good, first);
  git('tag', `prod-20261002-${second.slice(0, 7)}`, first); // moved: name says second
  git('tag', `prod-20261003-${stray.slice(0, 7)}`, stray); // not an ancestor of main
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    assert.deepEqual(resolve({ head: second, tag: '' }), {
      sha: second,
      rollback: 'false',
      tag: '',
    });
    assert.deepEqual(resolve({ head: second, tag: good }), {
      sha: first,
      rollback: 'true',
      tag: good,
    });
    assert.throws(() => resolve({ head: second, tag: 'v1' }), /not a production tag/);
    assert.throws(() => resolve({ head: second, tag: 'prod-20261009-abcdef0' }), /no tag/);
    assert.throws(
      () => resolve({ head: second, tag: `prod-20261002-${second.slice(0, 7)}` }),
      /does not match/,
    );
    assert.throws(
      () => resolve({ head: second, tag: `prod-20261003-${stray.slice(0, 7)}` }),
      /not an ancestor/,
    );
    assert.throws(() => resolve({ head: 'main', tag: '' }), /40-character/);
  } finally {
    process.chdir(cwd);
  }
});

test('rollback plan lists applied and possibly applied migrations, and never claims safety it cannot know', () => {
  const out = renderRollback({
    tag: 'prod-20261001-aaaaaaa',
    sha: SHA,
    base: 'b'.repeat(40),
    applied: ['0042_x.sql'],
    possible: ['0043_drop.sql'],
  });
  assert.match(out, /No migration is applied or undone/);
  assert.match(out, /0042_x\.sql/);
  assert.match(out, /0043_drop\.sql/);
  assert.match(out, /failed or half-finished deployment may also have applied: 1/);
  assert.match(out, /additive/);
  const none = renderRollback({ tag: 't', sha: SHA, base: null, applied: [], possible: [] });
  assert.match(none, /predates: 0/);
  assert.doesNotMatch(none, /additive/);
});

const shell =
  '<!DOCTYPE html><html><body><div id="root"></div><script src="/_expo/static/js/web/index-1.js" defer></script></body></html>';

test('the smoke test recognises the app shell and nothing else', () => {
  assert.ok(judgeShell(shell).ok);
  assert.equal(judgeShell('<!doctype html><p>Marketing</p>').ok, false); // the marketing page
  assert.equal(judgeShell('<!doctype html><div id="root"></div>').ok, false); // no bundle
  assert.equal(judgeShell('502 Bad Gateway').ok, false);
  assert.equal(judgeShell('').ok, false);
});

test('the smoke test requires the preview card on the configured origin', () => {
  const card = (host) =>
    `<meta property="og:image" content="https://${host}/og-card.png"><meta http-equiv="refresh" content="0; url=https://${host}/j/abc234">`;
  assert.ok(judgePreview(card('app.example'), 'https://app.example').ok);
  assert.match(
    judgePreview(card('team--f0pgx8lb1j.expo.app'), 'https://app.example').detail,
    /vendor host/,
  );
  assert.match(judgePreview(card('other.example'), 'https://app.example').detail, /not on/);
  assert.equal(
    judgePreview(
      '<meta property="og:image" content="https://app.example/x.png">',
      'https://app.example',
    ).ok,
    false,
  );
  assert.equal(judgePreview('', 'https://app.example').ok, false);
  // a lookalike prefix is not the origin
  assert.equal(judgePreview(card('app.example.evil.example'), 'https://app.example').ok, false);
});

test('the smoke test fetches the bundle the shell names', async () => {
  const real = globalThis.fetch;
  const card =
    '<meta property="og:image" content="https://app.example/og-card.png"><meta http-equiv="refresh" content="0; url=https://app.example/j/abc234">';
  const serve = (bundle) => async (url) => {
    const u = String(url);
    if (u.endsWith('/start')) return new Response(shell, { status: 200 });
    if (u.includes('/_expo/static/js/web/')) return bundle.clone();
    return new Response(card, { status: 200 });
  };
  try {
    globalThis.fetch = serve(
      new Response('x', { status: 200, headers: { 'content-type': 'application/javascript' } }),
    );
    assert.ok((await smoke('https://app.example')).every((r) => r.ok));
    const SHA40 = 'c'.repeat(40);
    globalThis.fetch = serve(
      new Response(`var b="${SHA40}"`, {
        status: 200,
        headers: { 'content-type': 'application/javascript' },
      }),
    );
    assert.ok((await smoke('https://app.example', { sha: SHA40 })).every((r) => r.ok));
    const stale = await smoke('https://app.example', { sha: 'd'.repeat(40) });
    assert.equal(stale[0].ok, false);
    assert.match(stale[0].detail, /previous release/);
    globalThis.fetch = serve(new Response('gone', { status: 404 }));
    const missing = await smoke('https://app.example');
    assert.equal(missing[0].ok, false);
    assert.match(missing[0].detail, /404/);
    globalThis.fetch = serve(
      new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    assert.match((await smoke('https://app.example'))[0].detail, /not JavaScript/);
  } finally {
    globalThis.fetch = real;
  }
});

// --- One verdict named `check` (SUS-179) ------------------------------------

const needs = (over = {}, kind = 'code') => ({
  scope: { result: 'success', outputs: { kind } },
  static: { result: 'success', outputs: {} },
  database: { result: 'success', outputs: {} },
  live: { result: 'success', outputs: {} },
  ...over,
});

test('the verdict is green only when every suite job succeeded', () => {
  assert.equal(judgeNeeds(needs()).ok, true);
  for (const job of ['scope', 'static', 'database', 'live']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const v = judgeNeeds(needs({ [job]: { result, outputs: { kind: 'code' } } }));
      assert.equal(v.ok, false, `${job} ${result}`);
    }
  }
});

test('unit tests green while the live suite is red or still going is not green', () => {
  assert.equal(judgeNeeds(needs({ live: { result: 'failure' } })).ok, false);
  assert.equal(judgeNeeds(needs({ live: { result: 'cancelled' } })).ok, false);
  // What GitHub reports for a job whose dependency failed.
  assert.equal(
    judgeNeeds(needs({ database: { result: 'failure' }, live: { result: 'skipped' } })).ok,
    false,
  );
});

test('a prose change skips database and live on purpose, and nothing else', () => {
  const prose = (over) =>
    needs({ database: { result: 'skipped' }, live: { result: 'skipped' }, ...over }, 'prose');
  assert.equal(judgeNeeds(prose()).ok, true);
  assert.equal(judgeNeeds(prose({ static: { result: 'skipped' } })).ok, false);
  assert.equal(judgeNeeds(prose({ static: { result: 'failure' } })).ok, false);
  // The same skips on a code change are a job that did not run.
  assert.equal(
    judgeNeeds(needs({ database: { result: 'skipped' }, live: { result: 'skipped' } })).ok,
    false,
  );
  // A kind nobody recognises is not prose.
  assert.equal(judgeNeeds(needs({ live: { result: 'skipped' } }, 'unknown')).ok, false);
});

test('a job missing from needs, or an extra one that failed, or no input at all, is red', () => {
  const withoutLive = needs();
  delete withoutLive.live;
  assert.equal(judgeNeeds(withoutLive).ok, false);
  assert.equal(judgeNeeds(needs({ extra: { result: 'failure' } })).ok, false);
  assert.equal(judgeNeeds(needs({ extra: { result: 'success' } })).ok, true);
  assert.equal(judgeNeeds(undefined).ok, false);
  const bad = spawnSync('node', ['scripts/check-verdict.mjs'], {
    env: { ...process.env, NEEDS: 'not json' },
  });
  assert.equal(bad.status, 1);
  const red = spawnSync('node', ['scripts/check-verdict.mjs'], {
    env: { ...process.env, NEEDS: JSON.stringify(needs({ live: { result: 'failure' } })) },
    encoding: 'utf8',
  });
  assert.equal(red.status, 1);
  assert.match(red.stdout, /RED/);
});

test('the job summary names the runs and the minutes, per project', () => {
  const report = {
    stats: { duration: 330_000, expected: 3, unexpected: 0, flaky: 1, skipped: 1 },
    suites: [
      {
        specs: [{ tests: [{ projectName: 'android-chrome', status: 'expected' }] }],
        suites: [
          {
            specs: [
              {
                tests: [
                  { projectName: 'iphone-safari', status: 'skipped' },
                  { projectName: 'android-chrome', status: 'flaky' },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const s = summarise(report);
  assert.equal(s.runs, 3);
  assert.equal(s.seconds, 330);
  const text = markdown(s, '1/2');
  assert.match(text, /shard 1\/2: 3 runs in 5\.5 min/);
  assert.match(text, /\| android-chrome \| 2 \| 0 \|/);
  assert.match(text, /\| iphone-safari \| 1 \| 1 \|/);
});

/**
 * `check:workflows` run on a copy of the repo's workflows with one edit, in a
 * directory of its own, so the rule is proved by the thing it guards.
 */
const checkWorkflowsOn = (edit) => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-'));
  cpSync('.github', join(dir, '.github'), { recursive: true });
  cpSync('package.json', join(dir, 'package.json'));
  const path = join(dir, '.github/workflows/check.yml');
  const before = readFileSync(path, 'utf8');
  const after = edit(before);
  assert.notEqual(after, before, 'the edit changed nothing, so it proves nothing');
  writeFileSync(path, after);
  const result = spawnSync('node', [join(process.cwd(), 'scripts/check-workflows.mjs')], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

test('check.yml as it is passes', () => {
  assert.equal(checkWorkflowsOn((t) => `${t}\n# unchanged but for this\n`).status, 0);
});

test('mutation: take the aggregation out and check:workflows fails', () => {
  // The verdict job's `needs` loses the live suite.
  let r = checkWorkflowsOn((t) =>
    t.replace('needs: [scope, static, database, live]', 'needs: [scope, static, database]'),
  );
  assert.equal(r.status, 1);
  assert.match(r.output, /`check` does not `needs` `live`/);
  // The verdict job no longer runs when a dependency fails.
  r = checkWorkflowsOn((t) => t.replace('if: ${{ always() }}', 'if: ${{ success() }}'));
  assert.equal(r.status, 1);
  assert.match(r.output, /must run `if: \$\{\{ always\(\) \}\}`/);
  // Nothing judges the jobs.
  r = checkWorkflowsOn((t) => t.replace('run: node scripts/check-verdict.mjs', 'run: echo fine'));
  assert.equal(r.status, 1);
  assert.match(r.output, /does not run scripts\/check-verdict\.mjs/);
  // The whole job is gone.
  r = checkWorkflowsOn((t) => t.replace(/ {2}check:\n {4}name: check\n[\s\S]*$/, ''));
  assert.equal(r.status, 1);
  assert.match(r.output, /has no job `check`/);
});

test('mutation: a second check, a renamed verdict, or a suite job allowed to fail', () => {
  let r = checkWorkflowsOn((t) => t.replace('name: static', 'name: check'));
  assert.equal(r.status, 1);
  assert.match(r.output, /`static` is also named `check`/);
  r = checkWorkflowsOn((t) => t.replace(/name: check\n {4}needs/, 'name: verdict\n    needs'));
  assert.equal(r.status, 1);
  assert.match(r.output, /must have `name: check`/);
  r = checkWorkflowsOn((t) =>
    t.replace('    name: database\n', '    name: database\n    continue-on-error: true\n'),
  );
  assert.equal(r.status, 1);
  assert.match(r.output, /`database` has `continue-on-error`/);
});

test('mutation: CI must run every part of pnpm check, and no more', () => {
  let r = checkWorkflowsOn((t) => t.replace('run: pnpm run check:stack', 'run: echo skipped'));
  assert.equal(r.status, 1);
  assert.match(r.output, /no job runs `pnpm run check:stack`/);
  r = checkWorkflowsOn((t) => t.replace('pnpm run test:e2e:live --shard="$SHARD"', 'echo skipped'));
  assert.equal(r.status, 1);
  assert.match(r.output, /no job runs `pnpm run test:e2e:live`/);
  r = checkWorkflowsOn((t) =>
    t.replace('run: pnpm run check:stack', 'run: pnpm run check:stack && pnpm run lint'),
  );
  assert.equal(r.status, 1);
  assert.match(r.output, /runs `pnpm run lint`, which is not a part of `pnpm check`/);
  r = checkWorkflowsOn((t) => t.replace('run: pnpm run check:stack', 'run: pnpm check'));
  assert.equal(r.status, 1);
  // A part that only runs for some changes, or that may fail quietly.
  r = checkWorkflowsOn((t) =>
    t.replace(
      '      - name: pnpm check:stack\n',
      "      - name: pnpm check:stack\n        if: github.event_name == 'push'\n",
    ),
  );
  assert.equal(r.status, 1);
  assert.match(r.output, /under a condition other than the change being code/);
});

test('mutation: the live shards cover the whole suite', () => {
  let r = checkWorkflowsOn((t) => t.replace("shard: ['1/2', '2/2']", "shard: ['1/2']"));
  assert.equal(r.status, 1);
  assert.match(r.output, /not every shard of one total/);
  r = checkWorkflowsOn((t) => t.replace("shard: ['1/2', '2/2']", "shard: ['1/3', '2/2']"));
  assert.equal(r.status, 1);
  r = checkWorkflowsOn((t) => t.replace(' --shard="$SHARD"', ''));
  assert.equal(r.status, 1);
  assert.match(r.output, /shard matrix but runs `test:e2e:live` without --shard/);
  r = checkWorkflowsOn((t) =>
    t.replace('timeout-minutes: 15\n    strategy', 'timeout-minutes: 45\n    strategy'),
  );
  assert.equal(r.status, 1);
  assert.match(r.output, /`timeout-minutes` of 20 or less/);
});
