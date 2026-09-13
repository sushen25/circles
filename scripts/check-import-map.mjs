#!/usr/bin/env node
/**
 * Every bare import the Edge Function bundler will meet must be in the import
 * map, or `supabase functions deploy` fails at bundle time — in CI, minutes
 * after the commit, with a message about one file deep inside `dist/`.
 *
 * Deno has no node_modules to fall back on. The client and the test suites do,
 * which is why a missing entry is invisible everywhere except the deploy: the
 * domain package imported `date-fns-tz` for months, and the map never named it.
 *
 * Reads the packages' `dist/`, not their source, because that is what the
 * bundler reads. Runs after `typecheck` in `pnpm check`, which is what builds it.
 *
 * And reads the functions' own source, which for a long time it did not. The
 * script was written when `supabase/functions` held one smoke test that imported
 * nothing but the two workspace packages, so the gap was invisible: the first
 * function to reach for `@supabase/supabase-js` would have passed this check and
 * failed the deploy. A guard that covers the libraries and not the callers is
 * half a guard.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MAP_PATH = 'supabase/functions/import_map.json';
// The packages an Edge Function can reach, directly or through another.
const REACHABLE = ['packages/domain/dist', 'packages/contracts/dist', 'packages/config/dist'];
// And the functions themselves, which are TypeScript that Deno runs as it finds it.
const FUNCTIONS = 'supabase/functions';

const missingBuilds = REACHABLE.filter((dir) => !existsSync(dir));
if (missingBuilds.length > 0) {
  console.error(
    `check:imports: no build output at ${missingBuilds.join(', ')} — run \`pnpm run build\``,
  );
  process.exit(1);
}

const imports = JSON.parse(readFileSync(MAP_PATH, 'utf8')).imports ?? {};

function* files(dir, extension = '.js') {
  for (const entry of readdirSync(dir)) {
    // `node_modules` is the one thing Deno will not have, so it is also the one
    // thing that must not be read as though it were going to be bundled.
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path, extension);
    else if (path.endsWith(extension)) yield path;
  }
}

// What Deno actually runs: not the ambient declarations, not the tests, and not
// a config file the runner reads under Node.
function deployed(file) {
  return !file.endsWith('.d.ts') && !file.endsWith('.test.ts') && !file.endsWith('.config.ts');
}

// Bare specifiers only: anything not starting with '.', '/' or 'node:'. A
// type-only import is skipped because `verbatimModuleSyntax` erases it outright —
// nothing is left for the bundler to resolve.
const BARE = /(?:^|\s)(?:import|export)\s+(?!type\s)[^'"]*?from\s*['"]([^./][^'"]*)['"]/g;
// And `import 'some-polyfill'`, which has no `from` and so matched nothing above.
// The bundler resolves it exactly like any other, and a function that needed one
// would have passed this check and failed the deploy — which is the single thing
// this script exists to prevent.
const SIDE_EFFECT = /(?:^|\s)import\s*['"]([^./][^'"]*)['"]/g;

const problems = new Map();
const scanned = [
  ...REACHABLE.flatMap((dir) => [...files(dir)]),
  ...[...files(FUNCTIONS, '.ts')].filter(deployed),
];

for (const file of scanned) {
  {
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of [...source.matchAll(BARE), ...source.matchAll(SIDE_EFFECT)]) {
      if (specifier.startsWith('node:')) continue;
      // A subpath import (`foo/bar`) is satisfied by a `foo/` prefix entry.
      const mapped =
        specifier in imports ||
        Object.keys(imports).some((key) => key.endsWith('/') && specifier.startsWith(key));
      if (!mapped) {
        if (!problems.has(specifier)) problems.set(specifier, []);
        problems.get(specifier).push(file);
      }
    }
  }
}

if (problems.size > 0) {
  console.error(`check:imports: ${problems.size} specifier(s) missing from ${MAP_PATH}:\n`);
  for (const [specifier, where] of problems) {
    console.error(
      `  "${specifier}"  — imported by ${where[0]}${where.length > 1 ? ` (+${where.length - 1} more)` : ''}`,
    );
  }
  console.error(`\nDeno has no node_modules. Add each as "npm:<name>@<range>" to the map.`);
  process.exit(1);
}

console.log(
  `check:imports: every bare import is in the map (${Object.keys(imports).length} entries)`,
);
