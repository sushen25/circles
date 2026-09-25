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
// **Once the migration named below has shipped**, regenerating in place would
// edit an applied migration. From that point a change means a *new* migration
// carrying the changed definitions, and `MIGRATION` moves to it — the same
// rule the other two generators carry.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join, relative, sep } from 'node:path';

import {
  BEGIN,
  END,
  analyse,
  migrationsFor,
  priorRenderings,
  render,
} from './sql-functions-rules.mjs';
import { CLAIMS, selfTest } from './sql-functions-cases.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'supabase/sql/functions');
const MIGRATIONS = join(root, 'supabase/migrations');
// `0025` has shipped; a function change goes in a new migration (ADR 0015).
const MIGRATION = join(MIGRATIONS, '0026_quiet_ask.sql');

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

  const { checked, earlier } = migrationsFor(
    new Map(
      readdirSync(MIGRATIONS)
        .sort()
        .filter((entry) => entry.endsWith('.sql'))
        .map((entry) => [entry, readFileSync(join(MIGRATIONS, entry), 'utf8')]),
    ),
    basename(MIGRATION),
  );

  const { problems, sources } = analyse(walk(SOURCE), checked);

  if (problems.length > 0) {
    console.error(`${checking ? 'check' : 'gen'}:functions:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const migration = readFileSync(MIGRATION, 'utf8');
  const start = migration.indexOf(BEGIN);
  const finish = migration.indexOf(END);
  if (start === -1 || finish === -1) {
    console.error(`gen-sql-functions: markers not found in ${relative(root, MIGRATION)}`);
    process.exit(2);
  }

  const { text: rendered, changed } = render(sources, priorRenderings(earlier));
  const current = migration.slice(start, finish + END.length);

  if (checking) {
    if (current !== rendered) {
      console.error(
        'check:functions: the generated block no longer matches supabase/sql/functions/.\n' +
          'Run `pnpm gen:functions`. If that migration has already shipped, add a new one ' +
          'and point MIGRATION in scripts/gen-sql-functions.mjs at it.',
      );
      process.exit(1);
    }
    console.log(
      `check:functions: ok (${sources.size} functions, ${changed.length} carried by ` +
        `${relative(root, MIGRATION)}, ${CLAIMS} rules proven)`,
    );
    process.exit(0);
  }

  writeFileSync(
    MIGRATION,
    migration.slice(0, start) + rendered + migration.slice(finish + END.length),
  );
  console.log(
    `gen:functions: ${changed.length} of ${sources.size} function(s) changed ` +
      `(${changed.map(({ where }) => where.split('/').pop()).join(', ') || 'none'}); wrote to ` +
      `${relative(root, MIGRATION)}`,
  );
}

// Only when run, never when imported: importing a module should not rewrite a
// migration.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
