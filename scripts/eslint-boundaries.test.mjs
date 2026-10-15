// Run by `pnpm check:boundaries` with `node --test`.
//
// The folder rules in AGENTS.md "Boundaries" sat silent from S0-01 until
// SUS-215: the plugin could not resolve an extensionless `.ts` import, so it
// never learned which layer a file pointed at, and `pnpm lint` stayed green
// over `data` importing `features`. Each case below lints one import as if it
// were written in the named file and says whether the dependency rule must
// report it. A case that must fail and does not is that same silence again.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

import { ESLint } from 'eslint';

const eslint = new ESLint();

/** The `boundaries/dependencies` messages for `code` written at `filePath`. */
async function violations(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'boundaries/dependencies');
}

// Each `to` names a file or package that exists, so the import resolves.
const mustFail = [
  ['data never imports features', 'apps/app/src/data/x.ts', '../features/circles/CircleHomeFlow'],
  [
    'platform never imports features',
    'apps/app/src/platform/x.ts',
    '../features/circles/CircleHomeFlow',
  ],
  ['components do not import data', 'apps/app/src/components/x.ts', '../data/preview'],
  [
    'analytics does not import features',
    'apps/app/src/analytics/x.ts',
    '../features/circles/CircleHomeFlow',
  ],
  ['a feature does not import the routes', 'apps/app/src/features/x.ts', '../../app/index'],
  [
    'the domain imports no other package, by path',
    'packages/domain/src/x.ts',
    '../../contracts/src/index',
  ],
  [
    'the domain imports no other package, by name',
    'packages/domain/src/x.ts',
    '@circles/contracts',
  ],
  ['the domain imports no React', 'packages/domain/src/x.ts', 'react'],
  ['the domain imports no zod', 'packages/domain/src/x.ts', 'zod'],
  ['the domain imports no Node built-in', 'packages/domain/src/x.ts', 'node:fs'],
  [
    'contracts do not import the app',
    'packages/contracts/src/x.ts',
    '../../../apps/app/src/data/preview',
  ],
  ['tokens import nothing', 'packages/tokens/src/x.ts', '../../domain/src/index'],
  [
    'the app does not import the functions',
    'apps/app/src/features/x.ts',
    '../../../../supabase/functions/_shared/auth',
  ],
  [
    'the functions do not import the app',
    'supabase/functions/_shared/x.ts',
    '../../../apps/app/src/data/preview',
  ],
  [
    'a unit test under data keeps the layer’s limits',
    'apps/app/src/data/x.test.ts',
    'node:child_process',
  ],
  [
    'only an integration test imports an integration helper',
    'apps/app/src/features/x.ts',
    '../data/testing/stack.integration',
  ],
];

const mustPass = [
  ['features import data', 'apps/app/src/features/x.ts', '../data/preview'],
  ['data imports the domain', 'apps/app/src/data/x.ts', '@circles/domain'],
  ['the domain imports date-fns-tz', 'packages/domain/src/x.ts', 'date-fns-tz'],
  ['contracts import the domain', 'packages/contracts/src/x.ts', '../../domain/src/index'],
  ['a domain test imports vitest', 'packages/domain/src/x.test.ts', 'vitest'],
  [
    'an integration test imports node:child_process',
    'apps/app/src/data/x.integration.test.ts',
    'node:child_process',
  ],
  [
    'an integration test imports an integration helper',
    'apps/app/src/features/x.integration.test.ts',
    '../data/testing/stack.integration',
  ],
];

for (const [name, filePath, source] of mustFail) {
  test(`reported: ${name}`, async () => {
    const found = await violations(filePath, `import ${JSON.stringify(source)};\n`);
    assert.equal(found.length, 1, `${filePath} importing "${source}" was not reported`);
  });
}

for (const [name, filePath, source] of mustPass) {
  test(`allowed: ${name}`, async () => {
    const found = await violations(filePath, `import ${JSON.stringify(source)};\n`);
    assert.deepEqual(
      found.map((m) => m.message),
      [],
    );
  });
}

test('the config prints no boundaries deprecation warning', () => {
  const out = execFileSync(
    process.execPath,
    ['node_modules/eslint/bin/eslint.js', 'eslint.config.mjs'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  assert.equal(out, '');
});
