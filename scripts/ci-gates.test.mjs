// Run by `pnpm check:workflows` with `node --test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decide, judge } from './green-check.mjs';
import { changedFunctions, isTransactional, parseNameStatus, render } from './prod-plan.mjs';

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
