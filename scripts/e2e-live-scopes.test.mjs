// Run by `pnpm check:workflows` with `node --test` (SUS-179).
//
// The live suite runs every spec in two engines and only the tagged ones in the
// other three projects. These tests keep that honest: every spec says which it
// is, the tags are what the config's projects actually run (asked of Playwright
// itself, not of a copy of the rules), and a spec that arrives untagged, or
// tagged for less than its code needs, fails here rather than silently running
// in two of the five projects.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { codeOf, parseScopes, problems, readSpecs, specsFor } from '../tests/e2e-live/scopes.ts';

const BOTH_ENGINES = ['android-chrome', 'iphone-safari'];

test('the directive: a known scope or scopes, once, near the top', () => {
  assert.deepEqual(parseScopes('// @e2e: core\nimport x'), { scopes: ['core'], invalid: null });
  assert.deepEqual(parseScopes('// @e2e: in-app-browser, locale\n'), {
    scopes: ['in-app-browser', 'locale'],
    invalid: null,
  });
  assert.equal(parseScopes('import x\n').scopes, null);
  assert.equal(parseScopes('import x\n').invalid, null);
  assert.match(parseScopes('// @e2e: whatsapp\n').invalid, /unknown scope `whatsapp`/);
  assert.match(parseScopes('// @e2e:\n').invalid, /names no scope/);
  assert.match(parseScopes('// @e2e: core, locale\n').invalid, /`core` stands alone/);
  assert.match(parseScopes('// @e2e: core\n// @e2e: locale\n').invalid, /more than one/);
  // After the top of the file it is a comment like any other.
  assert.equal(parseScopes(`${'\n'.repeat(20)}// @e2e: core\n`).scopes, null);
});

test('comments are not code, so prose about the in-app browser is not a use of it', () => {
  const text =
    '/** the in-app browser, userAgent */\n// navigator.share\nconst x = 1; // userAgent\n';
  assert.equal(/userAgent|navigator\.share/.test(codeOf(text)), false);
  assert.equal(/userAgent/.test(codeOf('const ua = project.use.userAgent;')), true);
});

test('every live spec is tagged, and none is tagged for less than its code needs', () => {
  assert.deepEqual(problems(), []);
});

test('an untagged spec, and a spec tagged core that reads the user agent, both fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopes-'));
  writeFileSync(
    join(dir, 'new.spec.ts'),
    "import { test } from './fixtures';\ntest('a', () => {});\n",
  );
  writeFileSync(
    join(dir, 'ua.spec.ts'),
    "// @e2e: core\ntest('b', async ({}, info) => { info.project.use.userAgent; });\n",
  );
  writeFileSync(
    join(dir, 'au.spec.ts'),
    "// @e2e: in-app-browser\nimport { OTHER_LOCALE } from '../locale';\n",
  );
  writeFileSync(
    join(dir, 'ok.spec.ts'),
    "// @e2e: in-app-browser, locale\nconst a = 'userAgent'; const b = OTHER_LOCALE;\n",
  );
  const found = problems(dir);
  assert.equal(found.length, 3, found.join('\n'));
  assert.match(found.join('\n'), /new\.spec\.ts: has no `\/\/ @e2e:` line/);
  assert.match(
    found.join('\n'),
    /ua\.spec\.ts: is tagged `core` but its code reads the user agent/,
  );
  assert.match(
    found.join('\n'),
    /au\.spec\.ts: is tagged `in-app-browser` but its code names the second locale/,
  );
});

test('a scope with no spec is an error, not an empty project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopes-'));
  writeFileSync(join(dir, 'a.spec.ts'), '// @e2e: core\n');
  assert.throws(() => specsFor('locale', dir), /no live spec is tagged `locale`/);
});

test("Playwright's own list: both engines run every spec, the others run their tags", () => {
  const out = execFileSync(
    'node_modules/.bin/playwright',
    ['test', '-c', 'playwright.live.config.ts', '--list', '--reporter=json'],
    { encoding: 'utf8', env: { ...process.env, CI: '', E2E_LIVE_PORT: '8282' } },
  );
  const files = {};
  const walk = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests) (files[t.projectName] ??= new Set()).add(spec.file);
      }
      walk(suite.suites);
    }
  };
  walk(JSON.parse(out).suites);

  const specs = readSpecs();
  const named = (scope) => specs.filter((s) => s.scopes?.includes(scope)).map((s) => s.file);
  const every = specs.map((s) => s.file);
  for (const project of BOTH_ENGINES) {
    assert.deepEqual([...files[project]].sort(), every, `${project} runs every spec`);
  }
  for (const project of ['whatsapp-android', 'messenger-ios']) {
    assert.deepEqual([...files[project]].sort(), named('in-app-browser'), project);
  }
  assert.deepEqual(
    [...files['iphone-safari-en-au']].sort(),
    named('locale'),
    'iphone-safari-en-au',
  );
});
