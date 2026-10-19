// Run by `pnpm check:workflows` with `node --test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PULL_REQUEST_TARGET_ALLOWED,
  expressionsInRun,
  pullRequestTargetProblems,
  unpinnedUses,
  unsafeRunExpressions,
} from './workflow-hygiene.mjs';

const SHA = 'a'.repeat(40);
const job = (...steps) => ({ jobs: { j: { 'runs-on': 'ubuntu-latest', steps } } });

test('a full commit SHA pins an action, with or without a path', () => {
  assert.deepEqual(unpinnedUses(job({ uses: `actions/checkout@${SHA}` })), []);
  assert.deepEqual(unpinnedUses(job({ uses: `github/codeql-action/init@${SHA}` })), []);
});

test('a tag, a branch, a short SHA, an uppercase SHA and no ref at all are not pins', () => {
  for (const uses of [
    'actions/checkout@v4',
    'actions/checkout@main',
    'actions/checkout@v4.2.2',
    `actions/checkout@${'a'.repeat(39)}`,
    `actions/checkout@${'a'.repeat(41)}`,
    `actions/checkout@${'A'.repeat(40)}`,
    'actions/checkout',
  ]) {
    assert.equal(unpinnedUses(job({ uses })).length, 1, uses);
  }
});

test('local actions are exempt, docker images need a digest, reusable workflows are judged too', () => {
  assert.deepEqual(unpinnedUses(job({ uses: './.github/actions/setup' })), []);
  assert.equal(unpinnedUses(job({ uses: 'docker://alpine:3.20' })).length, 1);
  assert.deepEqual(unpinnedUses(job({ uses: `docker://alpine@sha256:${'b'.repeat(64)}` })), []);
  const reusable = { jobs: { call: { uses: 'org/repo/.github/workflows/x.yml@v1' } } };
  assert.equal(unpinnedUses(reusable).length, 1);
  assert.deepEqual(
    unpinnedUses({ jobs: { call: { uses: `org/repo/.github/workflows/x.yml@${SHA}` } } }),
    [],
  );
});

test('expressions are found in run only, whatever the spacing', () => {
  assert.deepEqual(expressionsInRun(job({ run: 'echo "${{ inputs.x }}" ${{github.sha}}' })), [
    'inputs.x',
    'github.sha',
  ]);
  assert.deepEqual(expressionsInRun(job({ env: { A: '${{ inputs.x }}' }, run: 'echo "$A"' })), []);
  assert.deepEqual(expressionsInRun(job({ run: "docker ps --format '{{.Names}}'" })), []);
});

test('the event payload and user-chosen text never reach a script', () => {
  for (const expr of [
    'inputs.confirm',
    'github.event.head_commit.message',
    'github.event.pull_request.title',
    'github.event.pull_request.head.ref',
    'github.head_ref',
    'github.ref_name',
    'github.base_ref',
    'github.actor',
    'steps.scope.outputs.kind',
    'needs.plan.outputs.sha',
    'toJSON(needs)',
    'github.event_name == github.sha',
    'github.event.pull_request.number || github.head_ref',
  ]) {
    const found = unsafeRunExpressions(job({ run: `echo "\${{ ${expr} }}"` }));
    assert.equal(found.length, 1, expr);
  }
});

test('the contexts that cannot carry attacker text are allowed', () => {
  for (const expr of [
    'github.event_name',
    'github.sha',
    'github.run_id',
    'github.repository',
    'github.event.pull_request.number',
    'job.status',
    'runner.os',
    'matrix.shard',
    'strategy.job-index',
    'secrets.SUPABASE_DEV_PROJECT_REF',
  ]) {
    assert.deepEqual(unsafeRunExpressions(job({ run: `echo "\${{ ${expr} }}"` })), [], expr);
  }
});

test('pull_request_target is refused outside the allow-list', () => {
  const doc = { on: { pull_request_target: { types: ['closed'] } }, jobs: {} };
  assert.equal(pullRequestTargetProblems('preview.yml', doc).length, 1);
  assert.deepEqual(pullRequestTargetProblems('preview-cleanup.yml', doc), []);
  assert.ok(PULL_REQUEST_TARGET_ALLOWED.includes('preview-cleanup.yml'));
  // The other spellings of `on`.
  assert.equal(pullRequestTargetProblems('x.yml', { on: 'pull_request_target' }).length, 1);
  assert.equal(
    pullRequestTargetProblems('x.yml', { on: ['push', 'pull_request_target'] }).length,
    1,
  );
  assert.deepEqual(pullRequestTargetProblems('x.yml', { on: { pull_request: {} } }), []);
});

test('an allowed pull_request_target workflow may not check out or run the PR', () => {
  const wf = (step) => ({
    on: { pull_request_target: {} },
    jobs: { j: { steps: [step] } },
  });
  const f = 'preview-cleanup.yml';
  assert.deepEqual(
    pullRequestTargetProblems(
      f,
      wf({
        uses: `actions/checkout@${SHA}`,
        with: { ref: '${{ github.event.repository.default_branch }}' },
      }),
    ),
    [],
  );
  assert.deepEqual(pullRequestTargetProblems(f, wf({ uses: `actions/checkout@${SHA}` })), []);
  for (const ref of [
    '${{ github.event.pull_request.head.sha }}',
    '${{ github.event.pull_request.head.ref }}',
    '${{ github.head_ref }}',
    'refs/pull/${{ github.event.number }}/merge',
    '${{ github.event.pull_request.merge_commit_sha }}',
  ]) {
    assert.equal(
      pullRequestTargetProblems(f, wf({ uses: `actions/checkout@${SHA}`, with: { ref } })).length,
      1,
      ref,
    );
  }
  assert.equal(
    pullRequestTargetProblems(
      f,
      wf({
        uses: `actions/checkout@${SHA}`,
        with: { repository: '${{ github.event.pull_request.head.repo.full_name }}' },
      }),
    ).length,
    1,
  );
  assert.equal(pullRequestTargetProblems(f, wf({ run: 'gh pr checkout 5' })).length, 1);
  assert.equal(
    pullRequestTargetProblems(f, wf({ run: 'git fetch origin refs/pull/5/head' })).length,
    1,
  );
});
