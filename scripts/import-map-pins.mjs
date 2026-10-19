/**
 * What `supabase/functions` is allowed to resolve at deploy time: nothing that
 * `pnpm-lock.yaml` did not already resolve and the test suites did not already
 * run against.
 *
 * Deno has no node_modules, so every `npm:` entry in the import map is looked up
 * by the bundler on the day of the deploy. A range there means the newest
 * release inside it that day, in code that holds the service role, with no
 * review. Pure functions on parsed inputs, so `import-map-pins.test.mjs` can
 * feed them a regression; `check-import-map.mjs` reads the files and calls them.
 */

// The workspace members whose dependencies end up in the Edge bundle.
export const IMPORTERS = [
  'supabase/functions',
  'packages/domain',
  'packages/contracts',
  'packages/config',
];

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** `npm:/pkg@1.2.3/sub`, `npm:@scope/pkg@^1` → `{ name, version }`, or null for a non-npm value. */
export function parseNpm(value) {
  if (typeof value !== 'string' || !value.startsWith('npm:')) return null;
  const rest = value.slice(4).replace(/^\//, '');
  const at = rest.indexOf('@', rest.startsWith('@') ? 1 : 0);
  if (at === -1) return { name: rest.replace(/\/$/, ''), version: '' };
  const name = rest.slice(0, at);
  const version = rest.slice(at + 1).split('/')[0];
  return { name, version };
}

/** pnpm writes `1.2.3(peer@4)` — the part before the first parenthesis is the version. */
const bare = (version) => String(version).split('(')[0];

/** name → versions the lockfile resolved for the Edge bundle's own importers. */
export function resolvedVersions(pnpmLock) {
  const byName = new Map();
  const add = (name, version) => {
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(bare(version));
  };
  for (const importer of IMPORTERS) {
    const entry = pnpmLock.importers?.[importer] ?? {};
    for (const group of ['dependencies', 'devDependencies']) {
      for (const [name, dep] of Object.entries(entry[group] ?? {})) add(name, dep.version);
    }
  }
  return byName;
}

/** name → versions anywhere in the lockfile, for a package no importer names directly. */
function anywhere(pnpmLock, name) {
  const found = new Set();
  for (const key of Object.keys(pnpmLock.packages ?? {})) {
    const at = key.indexOf('@', 1);
    if (key.slice(0, at) === name) found.add(key.slice(at + 1));
  }
  return found;
}

/** Problems with the import map's `npm:` entries: a range, or a version pnpm did not resolve. */
export function checkPins(imports, pnpmLock) {
  const problems = [];
  const direct = resolvedVersions(pnpmLock);
  for (const [specifier, value] of Object.entries(imports)) {
    const npm = parseNpm(value);
    if (!npm) continue;
    if (!EXACT.test(npm.version)) {
      problems.push(
        `"${specifier}": ${value} is not an exact version${npm.version ? ` ("${npm.version}" is a range)` : ''}; ` +
          `pin it to what pnpm-lock.yaml resolves`,
      );
      continue;
    }
    const known = direct.get(npm.name) ?? anywhere(pnpmLock, npm.name);
    if (known.size === 0) {
      problems.push(`"${specifier}": ${npm.name} is not in pnpm-lock.yaml at all`);
    } else if (!known.has(npm.version)) {
      problems.push(
        `"${specifier}": ${value} disagrees with pnpm-lock.yaml, which resolves ${npm.name} to ${[...known].join(', ')}`,
      );
    }
  }
  return problems;
}

/**
 * Problems with `deno.lock`: it must name every `npm:` entry, and where it and
 * pnpm both hold the same `name@version` they must hold the same tarball hash —
 * a difference is a lock that was edited, or regenerated against another
 * registry.
 */
export function checkLock(imports, denoLock, pnpmLock) {
  const problems = [];
  if (!denoLock || denoLock.version !== '4') {
    return [`deno.lock is missing or is not lock version 4 (found ${denoLock?.version ?? 'none'})`];
  }
  for (const [specifier, value] of Object.entries(imports)) {
    const npm = parseNpm(value);
    if (npm && !(`npm:${npm.name}@${npm.version}` in (denoLock.specifiers ?? {}))) {
      problems.push(`deno.lock has no entry for npm:${npm.name}@${npm.version} ("${specifier}")`);
    }
  }
  for (const [key, entry] of Object.entries(denoLock.npm ?? {})) {
    const id = key.split('_')[0];
    const pnpmEntry = pnpmLock.packages?.[id];
    const theirs = pnpmEntry?.resolution?.integrity;
    if (theirs && entry.integrity !== theirs) {
      problems.push(`deno.lock holds ${id} with a different hash from pnpm-lock.yaml`);
    }
  }
  return problems;
}

/** Problems with one function's `deno.json`: it must use the shared map and the frozen lock. */
export function checkFunctionConfig(name, config) {
  const problems = [];
  if (config?.importMap !== '../import_map.json') {
    problems.push(`${name}/deno.json: "importMap" must be "../import_map.json"`);
  }
  if (config?.lock?.path !== '../deno.lock' || config?.lock?.frozen !== true) {
    problems.push(`${name}/deno.json: "lock" must be { "path": "../deno.lock", "frozen": true }`);
  }
  return problems;
}
