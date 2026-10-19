// Run by `pnpm check:workflows` with `node --test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PULL_REQUEST_TARGET_ALLOWED,
  expressionsInRun,
  pullRequestTargetProblems,
  unpinnedUses,
  unversionedPins,
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
    assert.ok(
      pullRequestTargetProblems(f, wf({ uses: `actions/checkout@${SHA}`, with: { ref } })).length >=
        1,
      ref,
    );
  }
  assert.ok(
    pullRequestTargetProblems(
      f,
      wf({
        uses: `actions/checkout@${SHA}`,
        with: { repository: '${{ github.event.pull_request.head.repo.full_name }}' },
      }),
    ).length >= 1,
  );
  assert.equal(pullRequestTargetProblems(f, wf({ run: 'gh pr checkout 5' })).length, 1);
  assert.ok(
    pullRequestTargetProblems(f, wf({ run: 'git fetch origin refs/pull/5/head' })).length >= 1,
  );
});

test('a matrix value is safe only when the matrix is written in the file', () => {
  const wf = (matrix) => ({
    jobs: { j: { strategy: { matrix }, steps: [{ run: 'echo ${{ matrix.x }}' }] } },
  });
  assert.deepEqual(unsafeRunExpressions(wf({ x: ['a', 'b'] })), []);
  assert.equal(unsafeRunExpressions(wf('${{ fromJSON(inputs.list) }}')).length, 1);
  assert.equal(unsafeRunExpressions(wf({ x: '${{ fromJSON(needs.a.outputs.l) }}' })).length, 1);
});

test('harmless GitHub paths are allowed in run', () => {
  for (const expr of ['github.workspace', 'runner.temp', 'github.server_url', 'github.token']) {
    assert.deepEqual(unsafeRunExpressions(job({ run: `echo "\${{ ${expr} }}"` })), [], expr);
  }
});

test('an allowed pull_request_target workflow cannot reach the PR through env, with or a third party', () => {
  const f = 'preview-cleanup.yml';
  const on = { pull_request_target: {} };
  const one = (step, extra = {}) => ({ on, ...extra, jobs: { j: { steps: [step] } } });
  const co = `actions/checkout@${SHA}`;
  for (const ref of [
    '${{ github.event.after }}',
    '${{ env.PR }}',
    '${{ GITHUB.HEAD_REF }}',
    "${{ github.event['pull_request'].head.sha }}",
    '${{ fromJSON(toJSON(github.event)).pull_request.head.sha }}',
    'pr-branch',
  ]) {
    assert.ok(pullRequestTargetProblems(f, one({ uses: co, with: { ref } })).length >= 1, ref);
  }
  assert.ok(
    pullRequestTargetProblems(
      f,
      one({
        uses: `someone/checkout@${SHA}`,
        with: { ref: '${{ github.event.pull_request.head.sha }}' },
      }),
    ).length >= 1,
  );
  // The PR's head through env, then used in a script.
  assert.ok(
    pullRequestTargetProblems(
      f,
      one({ env: { S: '${{ github.event.pull_request.head.sha }}' }, run: 'git fetch origin $S' }),
    ).length >= 1,
  );
  assert.ok(pullRequestTargetProblems(f, one({ run: 'git fetch origin pull/5/head' })).length >= 1);
  assert.ok(
    pullRequestTargetProblems(f, one({ run: 'echo hi' }, { env: { S: '${{ github.head_ref }}' } }))
      .length >= 1,
  );
  // A reusable workflow job runs code this check cannot see.
  assert.equal(
    pullRequestTargetProblems(f, { on, jobs: { j: { uses: './.github/workflows/x.yml' } } }).length,
    1,
  );
  // The PR number, which the real clean-up reads, is fine.
  assert.deepEqual(
    pullRequestTargetProblems(
      f,
      one({
        env: { PR_NUMBER: '${{ github.event.pull_request.number }}' },
        run: 'eas alias:delete',
      }),
    ),
    [],
  );
});

test('a pinned action names its version in a comment', () => {
  const line = (rest) => `      - uses: actions/checkout@${SHA}${rest}\n`;
  assert.deepEqual(unversionedPins(line(' # v4.4.0')), []);
  assert.equal(unversionedPins(line('')).length, 1);
  assert.equal(unversionedPins(line(' # pinned')).length, 1);
  assert.deepEqual(unversionedPins('      - uses: ./local\n'), []);
});
