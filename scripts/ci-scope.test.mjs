// Run by `pnpm check:workflows` with `node --test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { spawnSync } from 'node:child_process';

const scope = (...files) =>
  spawnSync('node', ['scripts/ci-scope.mjs'], {
    input: files.join('\n'),
    encoding: 'utf8',
  }).stdout.trim();

test('Markdown anywhere is prose', () => {
  assert.equal(scope('README.md', 'docs/a.md', '.claude/skills/x/SKILL.md'), 'prose');
});

test('a shell script under .claude is code: it runs with the founder credentials', () => {
  assert.equal(scope('.claude/skills/work-tickets-in-parallel/parallel.sh'), 'code');
  assert.equal(scope('docs/a.md', '.claude/skills/work-tickets-in-parallel/gate-lock.sh'), 'code');
});

test('any other file under .claude is code too', () => {
  assert.equal(scope('.claude/settings.json'), 'code');
  assert.equal(scope('.claude/launch.json'), 'code');
});

test('an empty diff, and an unrecognised path, are code', () => {
  assert.equal(scope(), 'code');
  assert.equal(scope('docs/design/gen.py'), 'code');
});
