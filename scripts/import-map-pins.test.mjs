// Run by `pnpm check:imports` with `node --test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkFunctionConfig, checkLock, checkPins, parseNpm } from './import-map-pins.mjs';

const pnpm = {
  importers: {
    'supabase/functions': {
      dependencies: {
        zod: { specifier: '^4.5.4', version: '4.5.4' },
        '@react-email/render': {
          specifier: '2.1.0',
          version: '2.1.0(react-dom@19.2.3(react@19.2.3))(react@19.2.3)',
        },
      },
    },
    'packages/domain': { dependencies: { 'date-fns-tz': { version: '3.2.0(date-fns@4.4.0)' } } },
  },
  packages: {
    'zod@4.5.4': { resolution: { integrity: 'sha512-zod' } },
    'date-fns-tz@3.2.0': { resolution: { integrity: 'sha512-tz' } },
    'left-pad@1.3.0': { resolution: { integrity: 'sha512-pad' } },
  },
};

test('parses the three shapes of npm specifier', () => {
  assert.deepEqual(parseNpm('npm:zod@4.5.4'), { name: 'zod', version: '4.5.4' });
  assert.deepEqual(parseNpm('npm:/date-fns-tz@3.2.0/'), { name: 'date-fns-tz', version: '3.2.0' });
  assert.deepEqual(parseNpm('npm:@react-email/render@2.1.0'), {
    name: '@react-email/render',
    version: '2.1.0',
  });
  assert.deepEqual(parseNpm('npm:react@19.2.3/jsx-runtime'), { name: 'react', version: '19.2.3' });
  assert.equal(parseNpm('../../packages/domain/dist/index.js'), null);
});

test('exact versions that pnpm resolved pass', () => {
  assert.deepEqual(
    checkPins(
      {
        zod: 'npm:zod@4.5.4',
        'date-fns-tz/': 'npm:/date-fns-tz@3.2.0/',
        '@circles/domain': '../d.js',
      },
      pnpm,
    ),
    [],
  );
});

test('a range fails', () => {
  for (const range of ['^4.5.4', '~4.5.4', '4', '4.x', '>=4', '*', 'latest', '']) {
    const problems = checkPins({ zod: `npm:zod@${range}` }, pnpm);
    assert.equal(problems.length, 1, range);
    assert.match(problems[0], /not an exact version/);
  }
  assert.equal(checkPins({ zod: 'npm:zod' }, pnpm).length, 1);
});

test('a version that disagrees with the pnpm lock fails', () => {
  const [problem] = checkPins({ zod: 'npm:zod@4.5.3' }, pnpm);
  assert.match(problem, /disagrees with pnpm-lock\.yaml, which resolves zod to 4\.5\.4/);
});

test('a package pnpm does not hold fails; one held only transitively is compared there', () => {
  assert.match(checkPins({ x: 'npm:nope@1.0.0' }, pnpm)[0], /not in pnpm-lock\.yaml/);
  assert.deepEqual(checkPins({ x: 'npm:left-pad@1.3.0' }, pnpm), []);
  assert.equal(checkPins({ x: 'npm:left-pad@1.2.0' }, pnpm).length, 1);
});

const lock = {
  version: '4',
  specifiers: { 'npm:zod@4.5.4': '4.5.4', 'npm:date-fns-tz@3.2.0': '3.2.0_date-fns@4.4.0' },
  npm: {
    'zod@4.5.4': { integrity: 'sha512-zod' },
    'date-fns-tz@3.2.0_date-fns@4.4.0': { integrity: 'sha512-tz' },
    'only-deno@1.0.0': { integrity: 'sha512-whatever' },
  },
};
const map = { zod: 'npm:zod@4.5.4', 'date-fns-tz': 'npm:date-fns-tz@3.2.0' };

test('a lock that names every entry and agrees with pnpm passes', () => {
  assert.deepEqual(checkLock(map, lock, pnpm), []);
});

test('a missing lock, a missing entry and a different hash fail', () => {
  assert.match(checkLock(map, null, pnpm)[0], /missing/);
  const without = { ...lock, specifiers: { 'npm:zod@4.5.4': '4.5.4' } };
  assert.match(checkLock(map, without, pnpm)[0], /no entry for npm:date-fns-tz@3\.2\.0/);
  const edited = { ...lock, npm: { ...lock.npm, 'zod@4.5.4': { integrity: 'sha512-evil' } } };
  assert.match(checkLock(map, edited, pnpm)[0], /different hash/);
});

test('every function must use the shared map and the frozen lock', () => {
  const good = { importMap: '../import_map.json', lock: { path: '../deno.lock', frozen: true } };
  assert.deepEqual(checkFunctionConfig('a', good), []);
  assert.equal(checkFunctionConfig('a', { importMap: '../import_map.json' }).length, 1);
  assert.equal(
    checkFunctionConfig('a', { ...good, lock: { path: '../deno.lock', frozen: false } }).length,
    1,
  );
  assert.equal(checkFunctionConfig('a', undefined).length, 2);
});
