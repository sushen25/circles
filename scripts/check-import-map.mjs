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
 * Reads `dist/`, not source, because that is what the bundler reads. Runs after
 * `typecheck` in `pnpm check`, which is what builds it.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MAP_PATH = 'supabase/functions/import_map.json';
// The packages an Edge Function can reach, directly or through another.
const REACHABLE = ['packages/domain/dist', 'packages/contracts/dist', 'packages/config/dist'];

const missingBuilds = REACHABLE.filter((dir) => !existsSync(dir));
if (missingBuilds.length > 0) {
  console.error(
    `check:imports: no build output at ${missingBuilds.join(', ')} — run \`pnpm run build\``,
  );
  process.exit(1);
}

const imports = JSON.parse(readFileSync(MAP_PATH, 'utf8')).imports ?? {};

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (path.endsWith('.js')) yield path;
  }
}

// Bare specifiers only: anything not starting with '.', '/' or 'node:'.
const BARE = /(?:^|\s)(?:import|export)[^'"]*?from\s*['"]([^./][^'"]*)['"]/g;

const problems = new Map();
for (const dir of REACHABLE) {
  for (const file of files(dir)) {
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(BARE)) {
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
