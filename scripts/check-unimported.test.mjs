// Run by `pnpm check:static` with `node --test` (SUS-145). The check has to
// fail on a new file nothing imports, pass when the file is imported, and not
// be fooled by the places a file legitimately has no importer.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findOrphans, specifiers } from './check-unimported.mjs';

const PKG = JSON.stringify({ name: '@circles/domain', main: './dist/index.js' });

/** A small repository: a route, a feature it imports, a package, a test. */
function repo(extra = {}) {
  return {
    'packages/domain/package.json': PKG,
    'packages/domain/src/index.ts': "export * from './rules';\n",
    'packages/domain/src/rules.ts': 'export const rule = 1;\n',
    'apps/app/app/index.tsx': "import { Home } from '../src/features/Home';\n",
    'apps/app/src/features/Home.tsx': "import { rule } from '@circles/domain';\n",
    'apps/app/src/features/Home.test.tsx': "import { Home } from './Home';\n",
    ...extra,
  };
}

const run = (files, options = { exempt: [] }) =>
  findOrphans(Object.keys(files), (f) => files[f], options);

test('a connected repository has no orphans', () => {
  assert.deepEqual(run(repo()), { orphans: [], unusedExemptions: [] });
});

test('a new source file that nothing imports is an orphan', () => {
  const files = repo({ 'apps/app/src/features/DeadScreen.tsx': 'export const Dead = 1;\n' });
  assert.deepEqual(run(files).orphans, ['apps/app/src/features/DeadScreen.tsx']);
});

test('the same file passes once something imports it, by any spelling', () => {
  for (const line of [
    "import { Dead } from './DeadScreen';\n",
    "import { Dead } from './DeadScreen.js';\n",
    "export { Dead } from './DeadScreen';\n",
    "const Dead = await import('./DeadScreen');\n",
    "import {\n  Dead,\n} from './DeadScreen';\n",
  ]) {
    const files = repo({
      'apps/app/src/features/DeadScreen.tsx': 'export const Dead = 1;\n',
      'apps/app/src/features/Home.tsx': line,
    });
    assert.deepEqual(run(files).orphans, [], line);
  }
});

test('an import in a comment does not count', () => {
  const files = repo({
    'apps/app/src/features/DeadScreen.tsx': 'export const Dead = 1;\n',
    'apps/app/src/features/Home.tsx':
      "// import { Dead } from './DeadScreen';\n * import x from './DeadScreen'\n",
  });
  assert.deepEqual(run(files).orphans, ['apps/app/src/features/DeadScreen.tsx']);
});

test('an import that is only commented out, or sits in a template string, does not count', () => {
  for (const text of [
    "/*\nimport { Dead } from './DeadScreen';\n*/\nexport const x = 1;\n",
    "// const Dead = import('./DeadScreen');\nexport const x = 1;\n",
    "const example = `\nimport { Dead } from './DeadScreen';\n`;\n",
    'export const example = "import(\'./DeadScreen\')";\n',
    'export const example = \'from \' + "./DeadScreen";\n',
    "const url = 'http://x.test/';\n// import('./DeadScreen')\n",
  ]) {
    const files = repo({
      'apps/app/src/features/DeadScreen.tsx': 'export const Dead = 1;\n',
      'apps/app/src/features/Home.tsx': text,
    });
    assert.deepEqual(run(files).orphans, ['apps/app/src/features/DeadScreen.tsx'], text);
  }
});

test('a real import after a comment marker inside a string is still read', () => {
  assert.deepEqual(specifiers("const u = 'a//b';\nimport x from './x';\n"), ['./x']);
});

test('a file only its own test imports is reached: tests are entry points', () => {
  const files = repo({
    'apps/app/src/features/Helper.ts': 'export const h = 1;\n',
    'apps/app/src/features/Helper.test.ts': "import { h } from './Helper';\n",
  });
  assert.deepEqual(run(files).orphans, []);
});

test('a directory import reaches its index', () => {
  const files = repo({
    'apps/app/src/features/Home.tsx': "import { x } from './widgets';\n",
    'apps/app/src/features/widgets/index.ts': "export { x } from './x';\n",
    'apps/app/src/features/widgets/x.ts': 'export const x = 1;\n',
  });
  assert.deepEqual(run(files).orphans, []);
});

test('a script is reached when package.json names it, an orphan when nothing does', () => {
  const files = repo({ 'scripts/tool.mjs': 'console.log(1);\n', 'package.json': '{"scripts":{}}' });
  assert.deepEqual(run(files).orphans, ['scripts/tool.mjs']);
  files['package.json'] = '{"scripts":{"tool":"node scripts/tool.mjs"}}';
  assert.deepEqual(run(files).orphans, []);
});

test('a script that only mentions its own path is still an orphan', () => {
  const files = repo({ 'scripts/tool.mjs': '// Run: node scripts/tool.mjs\n' });
  assert.deepEqual(run(files).orphans, ['scripts/tool.mjs']);
});

test('an exemption passes the file; one that matches nothing fails', () => {
  const files = repo({ 'packages/domain/src/db.generated.ts': 'export {};\n' });
  const exempt = [{ pattern: /\.generated\.ts$/, reason: 'generated' }];
  assert.deepEqual(run(files, { exempt: [] }).orphans, ['packages/domain/src/db.generated.ts']);
  assert.deepEqual(run(files, { exempt }), { orphans: [], unusedExemptions: [] });
  const stale = [{ pattern: /nothing-here\.ts$/, reason: 'gone' }];
  assert.deepEqual(run(repo(), { exempt: stale }).unusedExemptions, ['/nothing-here\\.ts$/']);
});

test('specifiers reads the statements and ignores strings that merely look like them', () => {
  assert.deepEqual(specifiers("import a from './a';\nconst s = \"import b from './b'\";\n"), [
    './a',
  ]);
});

test('the CLI exits 1 and names the file when a real orphan appears', () => {
  const root = mkdtempSync(join(tmpdir(), 'unimported-'));
  try {
    const files = repo({ 'apps/app/src/features/DeadScreen.tsx': 'export const Dead = 1;\n' });
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: root });
    const script = join(dirname(fileURLToPath(import.meta.url)), 'check-unimported.mjs');
    let failure = null;
    try {
      execFileSync('node', [script], { cwd: root, stdio: 'pipe' });
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.status, 1);
    assert.match(
      String(failure?.stderr),
      /nothing imports apps\/app\/src\/features\/DeadScreen\.tsx/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
