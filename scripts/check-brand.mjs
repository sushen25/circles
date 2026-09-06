// Architecture §5.4: the display name, the link domain and the sender exist in
// exactly one file. Renaming is then a config change, not a refactor.
//
// This walks the source tree (not docs, not READMEs — prose may name the
// product) and fails on a literal that belongs in `packages/config/src/brand.ts`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['apps', 'packages', 'supabase', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.expo', 'assets', 'ios', 'android']);
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const ALLOWED = new Set(['packages/config/src/brand.ts']);

const RULES = [
  { name: 'display name', pattern: /\bCircles\b/ },
  { name: 'link domain', pattern: /\bcircles\.app\b/ },
  { name: 'email address', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      yield path;
    }
  }
}

const failures = [];
for (const root of ROOTS) {
  for (const path of walk(root)) {
    const file = relative('.', path);
    if (ALLOWED.has(file)) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        if (rule.pattern.test(line)) {
          failures.push(`${file}:${index + 1}  ${rule.name}: ${line.trim()}`);
        }
      }
    });
  }
}

if (failures.length > 0) {
  console.error('check:brand: hard-coded brand values outside packages/config/src/brand.ts\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(`\n${failures.length} problem(s). Read them from \`brand\` instead (§5.4).`);
  process.exit(1);
}

console.log('check:brand: no hard-coded product name, domain or sender outside brand.ts');
