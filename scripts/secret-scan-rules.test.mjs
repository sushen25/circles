// Run by `pnpm check:workflows` with `node --test`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { secretScanProblems } from './secret-scan-rules.mjs';

const { parse } = createRequire(import.meta.url)('yaml');
const CHECK = readFileSync('.github/workflows/check.yml', 'utf8');

/** check.yml after one textual edit, parsed. The edit has to change something. */
const edited = (edit) => {
  const after = edit(CHECK);
  assert.notEqual(after, CHECK, 'the edit changed nothing, so it proves nothing');
  return parse(after);
};
const problemsAfter = (edit) => secretScanProblems(edited(edit));

const DISPATCH_IF = "        if: github.event_name == 'workflow_dispatch'\n";
const ACTION_IF = "        if: github.event_name != 'workflow_dispatch'\n";
const RANGE = '--log-opts="origin/main..HEAD"';

/** The dispatch step, from its name to the blank line after it. */
const dispatchStep = /\n {6}- name: Look for secrets in the branch's own commits[\s\S]*?\n\n/;

test('check.yml as it is: the scan runs on every event, the dispatch on its own commits', () => {
  assert.deepEqual(secretScanProblems(parse(CHECK)), []);
});

test('the action on its own, with no condition, is the other shape that scans every event', () => {
  const doc = edited((t) => t.replace(ACTION_IF, '').replace(dispatchStep, '\n\n'));
  assert.deepEqual(secretScanProblems(doc), []);
});

test('mutation: the action skips a dispatch and nothing else scans it', () => {
  const p = problemsAfter((t) => t.replace(dispatchStep, '\n\n'));
  assert.match(p.join('\n'), /a dispatch would scan nothing/);
});

test('mutation: any other condition on the action leaves an event unscanned', () => {
  for (const other of [
    "        if: github.event_name == 'pull_request'\n",
    "        if: github.event_name == 'workflow_dispatch'\n",
    '        if: false\n',
  ]) {
    const p = problemsAfter((t) => t.replace(ACTION_IF, other));
    assert.ok(p.length > 0, other);
  }
});

test('mutation: the dispatch step under a different condition does not cover the dispatch', () => {
  const p = problemsAfter((t) =>
    t.replace(DISPATCH_IF, "        if: github.event_name == 'schedule'\n"),
  );
  assert.match(p.join('\n'), /a dispatch would scan nothing/);
});

test('mutation: a dispatch with no range scans every branch again', () => {
  const p = problemsAfter((t) => t.replace(` ${RANGE}`, ''));
  assert.match(p.join('\n'), /every branch in the repository/);
});

test('mutation: an unchecked download, or no pinned hash', () => {
  assert.match(
    problemsAfter((t) => t.replace(/\n.*sha256sum --check --strict -/, '')).join('\n'),
    /GITLEAKS_SHA256/,
  );
  assert.match(
    problemsAfter((t) =>
      t.replace(/GITLEAKS_SHA256: [0-9a-f]{64}/, 'GITLEAKS_SHA256: latest'),
    ).join('\n'),
    /GITLEAKS_SHA256/,
  );
});

test('mutation: a red scan cannot be hidden by the way it is run', () => {
  for (const tail of [' || true', '; true', '\n          exit 0']) {
    const p = problemsAfter((t) => t.replace(`${RANGE} .`, `${RANGE} .${tail}`));
    assert.match(p.join('\n'), /hide gitleaks/, tail);
  }
  const p = problemsAfter((t) =>
    t.replace('archive="$RUNNER_TEMP', 'set +e\n          archive="$RUNNER_TEMP'),
  );
  assert.match(p.join('\n'), /hide gitleaks/);
});

test('mutation: the dispatch scan moved after the scope step, or the job made conditional', () => {
  const step = CHECK.match(dispatchStep)[0];
  const late = problemsAfter((t) => {
    const without = t.replace(step, '\n\n');
    const at = without.indexOf('\n\n  # `pnpm check:static`');
    return `${without.slice(0, at)}\n${step.trimEnd().replace(/^\n/, '')}${without.slice(at)}`;
  });
  assert.match(late.join('\n'), /first two steps after the checkout/);
  assert.match(
    problemsAfter((t) => t.replace('    name: scope\n', '    name: scope\n    if: false\n')).join(
      '\n',
    ),
    /`scope` job has an `if`/,
  );
});

test('mutation: a shallow checkout gives gitleaks no history', () => {
  const p = problemsAfter((t) =>
    t.replace(
      'fetch-depth: 0\n\n      - name: Look for secrets',
      'fetch-depth: 1\n\n      - name: Look for secrets',
    ),
  );
  assert.match(p.join('\n'), /fetch-depth: 0/);
});

test('check-workflows applies the rule', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-secrets-'));
  cpSync('.github', join(dir, '.github'), { recursive: true });
  cpSync('package.json', join(dir, 'package.json'));
  writeFileSync(join(dir, '.github/workflows/check.yml'), CHECK.replace(dispatchStep, '\n\n'));
  const r = spawnSync('node', [join(process.cwd(), 'scripts/check-workflows.mjs')], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
  assert.match(`${r.stdout}${r.stderr}`, /a dispatch would scan nothing/);
});
