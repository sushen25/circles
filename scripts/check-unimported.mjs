#!/usr/bin/env node
// A source file that nothing reaches is dead, and dead files are how the wrong
// "ChangeTimeScreen" gets edited (SUS-145): three screens sat in
// `features/confirmation` for weeks after the live ones moved to `planning`,
// and nothing in `pnpm check` noticed. This walks the import graph from the
// places code is entered and fails on a source file the walk never touches.
//
// Entry points (see `isRoot`):
//   - the route tree, `apps/app/app/**`: Expo Router loads every file in it
//   - every test file (`*.test.*`, `*.spec.*`): a runner loads those
//   - each package's public entries, from its `exports` map (dist -> src)
//   - each Edge Function's `index.ts`: the runtime loads those
//   - tool config the runners load by name (`*.config.*`, `vitest.setup.ts`)
//   - a file in `scripts/` or `tests/` that something names: package.json, the Makefile,
//     a workflow, a skill or the docs (`isNamed`)
//
// Reachability is by file, not by name: a barrel that re-exports an unused
// name still reaches its file. Pruning the domain's public API is a different
// job (the ticket's "out of scope"). No dependency: a regex over import
// statements, because Rule 11 prefers a small function to a library.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Files the walk is not expected to reach, each with the reason. A pattern that
 * matches nothing fails the check, so this list cannot rot.
 */
export const EXEMPT = [
  {
    pattern: /\.generated\.[mc]?[jt]sx?$/,
    reason:
      'written by a generator (`pnpm gen`); `check:types` and the gen checks own its freshness',
  },
  {
    pattern: /\.d\.ts$/,
    reason: 'an ambient declaration: tsc picks it up from `include`, nothing imports it',
  },
  {
    pattern: /^scripts\/extract-copy\.mjs$/,
    reason:
      'a seeding tool run by hand once per batch of artboards; en.ts and scaffold-screens.mjs document it and it refuses to overwrite en.ts',
  },
  {
    pattern: /^apps\/app\/app\/\(dev\)\//,
    reason: 'the dev gallery and its fixture routes are reached by Expo Router, never imported',
  },
];

const SOURCE = /\.[mc]?[jt]sx?$/;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs'];
const SCOPE = [
  /^apps\/app\/(app|src|metro)\//,
  /^apps\/app\/[^/]+\.[mc]?[jt]s$/,
  /^packages\/[^/]+\/src\//,
  /^supabase\/functions\//,
  /^scripts\//,
  /^tests\//,
  /^[^/]+\.[mc]?[jt]s$/,
];
const TEXT_SOURCES = [
  /(^|\/)package\.json$/,
  /^Makefile$/,
  /^\.github\//,
  /^\.claude\//,
  /\.md$/,
  /\.toml$/,
];

const inScope = (file) => SOURCE.test(file) && SCOPE.some((re) => re.test(file));
const isTest = (file) => /\.(test|spec)\.[mc]?[jt]sx?$/.test(file);

/** Entry points that need no importer. `isNamed` handles the scripts. */
function isRoot(file) {
  return (
    file.startsWith('apps/app/app/') ||
    isTest(file) ||
    /^apps\/app\/(index\.ts|[^/]*\.config\.[mc]?[jt]s|vitest\.setup\.ts|metro\/)/.test(file) ||
    /^[^/]+\.config\.[mc]?[jt]s$/.test(file) ||
    /^supabase\/functions\/[^/]+\/index\.ts$/.test(file) ||
    /^supabase\/functions\/[^/]+\.config\.[mc]?[jt]s$/.test(file)
  );
}

/**
 * The file with comments and template-literal text blanked (newlines kept), so
 * an `import` that is only written about is not read as one. Quoted strings
 * stay: they are where specifiers live, and a string ends at its line. A regex
 * literal holding a lone quote can confuse the rest of its line, no further.
 */
export function withoutCommentsAndTemplates(text) {
  let out = '';
  let i = 0;
  const blank = (chunk) => chunk.replace(/[^\n]/g, ' ');
  while (i < text.length) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    let end = -1;
    if (two === '//') {
      end = text.indexOf('\n', i);
      end = end === -1 ? text.length : end;
      out += blank(text.slice(i, end));
    } else if (two === '/*') {
      end = text.indexOf('*/', i + 2);
      end = end === -1 ? text.length : end + 2;
      out += blank(text.slice(i, end));
    } else if (c === '`') {
      end = i + 1;
      while (end < text.length && text[end] !== '`') end += text[end] === '\\' ? 2 : 1;
      end = Math.min(end + 1, text.length);
      out += '`' + blank(text.slice(i + 1, end - 1)) + '`';
    } else if (c === "'" || c === '"') {
      end = i + 1;
      while (end < text.length && text[end] !== c && text[end] !== '\n')
        end += text[end] === '\\' ? 2 : 1;
      end = Math.min(end + 1, text.length);
      out += text.slice(i, end);
    } else {
      out += c;
      end = i + 1;
    }
    i = end;
  }
  return out;
}

/** The module specifiers a file names. Statements must start a line, so an
 *  `import` inside a string is not an import either. */
export function specifiers(source) {
  const text = withoutCommentsAndTemplates(source);
  const found = [];
  const patterns = [
    /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^[ \t]*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bvi\.(?:mock|importActual)\(\s*['"]([^'"]+)['"]/g,
    /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) found.push(m[1]);
  return found;
}

/** `./dist/font-assets.js` -> `src/font-assets` candidates for a package. */
function packageEntries(pkgDir, pkg) {
  const targets = new Map(); // subpath ('' for the root) -> source stem
  const add = (sub, target) => {
    if (typeof target !== 'string') return;
    const m = /^\.\/dist\/(.+?)\.[mc]?js$/.exec(target);
    if (m) targets.set(sub, `${pkgDir}/src/${m[1]}`);
  };
  const exp = pkg.exports ?? {};
  for (const [key, value] of Object.entries(exp)) {
    const sub = key === '.' ? '' : key.replace(/^\.\//, '');
    add(sub, typeof value === 'string' ? value : value?.default);
  }
  if (!targets.has('')) add('', pkg.main);
  return targets;
}

/**
 * @param {string[]} files   repository-relative paths, forward slashes
 * @param {(file: string) => string} read
 * @param {{exempt?: typeof EXEMPT}} [options]
 * @returns {{orphans: string[], unusedExemptions: string[]}}
 */
export function findOrphans(files, read, { exempt = EXEMPT } = {}) {
  const known = new Set(files);
  const sources = files.filter(inScope);

  const packages = new Map(); // '@circles/domain' -> Map(subpath -> stem)
  for (const file of files) {
    const m = /^(packages\/[^/]+)\/package\.json$/.exec(file);
    if (!m) continue;
    const pkg = JSON.parse(read(file));
    packages.set(pkg.name, packageEntries(m[1], pkg));
  }

  const resolveStem = (stem) => {
    if (known.has(stem) && SOURCE.test(stem)) return stem;
    const bare = stem.replace(/\.[mc]?jsx?$/, ''); // ESM-style `./x.js` names `x.ts`
    for (const candidate of [stem, bare]) {
      for (const ext of EXTENSIONS) if (known.has(candidate + ext)) return candidate + ext;
      for (const ext of EXTENSIONS)
        if (known.has(`${candidate}/index${ext}`)) return `${candidate}/index${ext}`;
    }
    return null;
  };

  const resolve = (from, spec) => {
    if (spec.startsWith('.'))
      return resolveStem(posix.normalize(posix.join(posix.dirname(from), spec)));
    const m = /^(@[^/]+\/[^/]+)(?:\/(.+))?$/.exec(spec);
    if (m && packages.has(m[1])) {
      const stem = packages.get(m[1]).get(m[2] ?? '');
      return stem ? resolveStem(stem) : null;
    }
    return null;
  };

  // Package entries: every export that maps to a source file is a root.
  const roots = new Set(sources.filter(isRoot));
  for (const entries of packages.values()) {
    for (const stem of entries.values()) {
      const hit = resolveStem(stem);
      if (hit) roots.add(hit);
    }
  }

  // A script, or a Playwright `globalSetup`, is an entry when something that is
  // not imported code names its path: package.json, the Makefile, a workflow, a
  // skill, the docs, or a tool config that holds it as a string.
  const prose = files.filter(
    (f) => TEXT_SOURCES.some((re) => re.test(f)) && !f.startsWith('docs/audits/'),
  );
  const named = [...prose, ...roots].map((f) => [f, read(f)]);
  for (const file of sources) {
    if (!/^(scripts|tests)\//.test(file) || roots.has(file)) continue;
    if (named.some(([f, text]) => f !== file && text.includes(file))) roots.add(file);
  }

  const reached = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    if (!SOURCE.test(file)) continue;
    for (const spec of specifiers(read(file))) {
      const next = resolve(file, spec);
      if (next && !reached.has(next)) queue.push(next);
    }
  }

  const matched = new Set();
  const orphans = sources.filter((file) => {
    if (reached.has(file)) return false;
    const rule = exempt.find((e) => e.pattern.test(file));
    if (rule) {
      matched.add(rule);
      return false;
    }
    return true;
  });
  const unusedExemptions = exempt
    .filter((e) => !matched.has(e) && !files.some((f) => e.pattern.test(f)))
    .map((e) => String(e.pattern));
  return { orphans: orphans.sort(), unusedExemptions };
}

function main() {
  const root = process.cwd();
  // Tracked and untracked-but-not-ignored: a new file counts before it is added.
  const listed = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = listed.split('\n').filter((f) => f && existsSync(join(root, f)));
  const { orphans, unusedExemptions } = findOrphans(files, (f) =>
    readFileSync(join(root, f), 'utf8'),
  );

  if (orphans.length === 0 && unusedExemptions.length === 0) {
    console.log('check:unimported: ok — every source file is reached');
    return;
  }
  for (const file of orphans) console.error(`check:unimported: nothing imports ${file}`);
  for (const pattern of unusedExemptions) {
    console.error(`check:unimported: the exemption ${pattern} matches no file; remove it`);
  }
  console.error(
    'check:unimported: delete the file, import it, or (for a file code never imports) add it to EXEMPT in scripts/check-unimported.mjs with the reason',
  );
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
