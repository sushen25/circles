// A database function lives in one file, and that file is the truth.
//
// The slice-1 stack grew 47 functions across seven migrations, and four of
// them were defined more than once — `planning.transition_plan` three times,
// in 0003, 0004 and 0006. Nothing in the files says which is current. A
// migration is a history: the right place to record that something changed,
// the wrong place to keep the thing somebody has to read and edit
// (ADR 0015).
//
// So `supabase/sql/functions/<schema>/<name>.sql` holds the current
// definition of each function — its body, its comment, and the grants that
// say who may call it, together — and this script renders all of them into a
// generated block in a migration, the way `gen-transitions.mjs` renders the
// state machine and `gen-events.mjs` the event catalogue. (`gen-events.mjs`
// writes *into* one of these files: the forbidden-key fragments are the body
// of `jobs.carries_content`. Run it first, then this.)
//
//   pnpm gen:functions     rewrite the generated block from the source files
//   pnpm check:functions   fail if they have drifted, or a rule is broken
//
// The rules live in `sql-functions-rules.mjs` and the cases that prove they
// fire in `sql-functions-cases.mjs`; this file is the command. `--check` runs
// the cases first, because a guard nobody has seen fail is a guard nobody
// knows works.
//
// Which migration: the highest-numbered one that is not on `origin/main`
// (`migrations.mjs`). A shipped migration is never edited, so with none new
// this refuses when a definition has changed — add one with
// `pnpm gen:migration <name>` — and does nothing when none has. A new migration
// needs no markers: the block is added at its end. `pnpm check:functions`
// checks the same file, or the latest block when nothing is new.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

import {
  BEGIN,
  END,
  analyse,
  migrationsFor,
  priorRenderings,
  render,
} from './sql-functions-rules.mjs';
import { CLAIMS, selfTest } from './sql-functions-cases.mjs';
import { findTarget, holderOf, resolveWriteTarget } from './migrations.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'supabase/sql/functions');
const MIGRATIONS = join(root, 'supabase/migrations');

function walk(dir, into = new Map()) {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, into);
    else if (path.endsWith('.sql')) {
      into.set(relative(root, path).split(sep).join('/'), readFileSync(path, 'utf8'));
    }
  }
  return into;
}

function main() {
  const checking = process.argv.includes('--check');

  if (checking) {
    const unfired = selfTest();
    if (unfired.length > 0) {
      console.error('check:functions: the guard itself is broken — these rules did not fire:');
      for (const rule of unfired) console.error(`  - ${rule}`);
      process.exit(1);
    }
  }

  const files = new Map(
    readdirSync(MIGRATIONS)
      .sort()
      .filter((entry) => entry.endsWith('.sql'))
      .map((entry) => [entry, readFileSync(join(MIGRATIONS, entry), 'utf8')]),
  );

  // The file this run is about. Checking: this branch's new migration, or the
  // latest block when nothing is new (and when `origin` cannot be read, which
  // `pnpm check:migrations` fails on in CI). Writing: decided below, once we
  // know there is something to write.
  const holder = holderOf(files, BEGIN);
  const found = findTarget({ fetch: !checking });
  if (found.note && !found.unreachable) console.warn(`gen-sql-functions: ${found.note}`);
  const name = found.newest ?? holder;
  if (name === undefined) {
    console.error('gen-sql-functions: no migration holds a function block, and none is new.');
    process.exit(2);
  }

  const { checked, earlier } = migrationsFor(files, name);
  const { problems, sources } = analyse(walk(SOURCE), checked);

  if (problems.length > 0) {
    console.error(`${checking ? 'check' : 'gen'}:functions:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const migration = files.get(name);
  const start = migration.indexOf(BEGIN);
  const finish = migration.indexOf(END);
  const hasBlock = start !== -1 && finish !== -1;

  const { text: rendered, changed } = render(sources, priorRenderings(earlier));
  const current = hasBlock ? migration.slice(start, finish + END.length) : null;
  // A migration with no block says nothing about functions, which is the right
  // answer exactly when nothing has changed since the earlier ones.
  const matches = hasBlock ? current === rendered : changed.length === 0;

  if (checking) {
    if (!matches) {
      console.error(
        'check:functions: the generated block no longer matches supabase/sql/functions/.\n' +
          'Run `pnpm gen:functions`. A migration on main is never edited: if none on this ' +
          'branch is new, add one first with `pnpm gen:migration <name>`.',
      );
      process.exit(1);
    }
    console.log(
      `check:functions: ok (${sources.size} functions, ${changed.length} carried by ` +
        `${name}, ${CLAIMS} rules proven)`,
    );
    process.exit(0);
  }

  if (matches) {
    console.log(`gen:functions: up to date (${sources.size} functions, none changed; ${name})`);
    return;
  }

  const target =
    found.newest ??
    resolveWriteTarget({
      gen: 'gen:functions',
      files,
      begin: BEGIN,
      holder,
      template: null,
    });
  // `found.newest` can be a migration with no block yet; `resolveWriteTarget`
  // covers a missing or unreadable base. Either way the target may be a file
  // without markers, and the block is then appended.
  const targetSql = files.get(target);
  const from = targetSql.indexOf(BEGIN);
  const to = targetSql.indexOf(END);
  const { text, changed: carried } = render(
    sources,
    priorRenderings(new Map([...files].filter(([entry]) => entry !== target))),
  );
  const next =
    from === -1 || to === -1
      ? `${targetSql.replace(/\s*$/, '')}\n\n${text}\n`
      : targetSql.slice(0, from) + text + targetSql.slice(to + END.length);
  writeFileSync(join(MIGRATIONS, target), next);
  console.log(
    `gen:functions: ${carried.length} of ${sources.size} function(s) changed ` +
      `(${carried.map(({ where }) => where.split('/').pop()).join(', ') || 'none'}); wrote to ` +
      `${target}`,
  );
}

// Only when run, never when imported: importing a module should not rewrite a
// migration.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
