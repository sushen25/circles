// `expo-router` pins `query-string` 7.1.3 (CommonJS), which `require`s
// `decode-uri-component`. The fixed release of that (0.5.0, GHSA-vcc3-ghjq-m6fr)
// is ESM-only, so `patches/query-string@7.1.3.patch` takes `.default`. This
// resolves `query-string` the way `expo-router` does and proves the patch holds:
// without it `parse` throws "decodeComponent is not a function" on the first
// percent-encoded value. Run by `check:audit`; see docs/runbooks/ci.md.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const fromApp = createRequire(new URL('../apps/app/package.json', import.meta.url));
const fromRouter = createRequire(fromApp.resolve('expo-router'));
const queryString = fromRouter('query-string');

test('query-string still decodes percent-encoded values under the fixed decode-uri-component', () => {
  assert.deepEqual({ ...queryString.parse('a=%E2%82%AC&b=x%20y') }, { a: '€', b: 'x y' });
  assert.equal(queryString.stringify({ a: '€' }), 'a=%E2%82%AC');
});

test('the decoder in use is the fixed release', () => {
  // The decoder sits next to `query-string` in pnpm's store; package.json is
  // not in its `exports`, so read it from disk.
  const qsDir = path.dirname(fromRouter.resolve('query-string'));
  const decoder = createRequire(path.join(qsDir, 'index.js')).resolve('decode-uri-component');
  const root = path.resolve(path.dirname(decoder));
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(Number(version.split('.')[1]) >= 5, `decode-uri-component ${version} is vulnerable`);
});
