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
// state machine and `gen-events.mjs` the event catalogue.
//
//   pnpm gen:functions     rewrite the generated block from the source files
//   pnpm check:functions   fail if they have drifted, or a rule is broken
//
// `--check` also runs `selfTest()` below, because a guard nobody has seen
// fail is a guard nobody knows works: it feeds the rules three files that
// break them and fails if any goes unreported.
//
// **Once the migration named below has shipped**, regenerating in place would
// edit an applied migration. From that point a change means a *new* migration
// carrying the changed definitions, and `MIGRATION` moves to it — the same
// rule the other two generators carry.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'supabase/sql/functions');
const MIGRATIONS = join(root, 'supabase/migrations');
const MIGRATION = join(MIGRATIONS, '0008_function_definitions.sql');
const BEGIN = '-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)';
const END = '-- END GENERATED: function definitions';

/** `create or replace function public.foo(` → `public.foo`, args on any line. */
const DEFINES = /^create or replace function\s+([A-Za-z_][\w.]*)\s*\(/gm;
const DROPS = /^drop function(?: if exists)?\s+([A-Za-z_][\w.]*)\s*\(/gm;

function namesIn(sql, pattern) {
  return [...sql.matchAll(pattern)].map((match) => match[1]);
}

/**
 * The rules, over a map of `repo-relative path → contents` rather than over
 * the disk, so that `selfTest` can hand them a tree that does not exist.
 */
export function analyse(sourceFiles, migrationFiles) {
  const problems = [];
  const sources = new Map();

  for (const [where, raw] of sourceFiles) {
    const sql = raw.trimEnd();
    const defined = namesIn(sql, DEFINES);

    if (defined.length !== 1) {
      problems.push(
        `${where}: expected exactly one "create or replace function", found ${defined.length}. ` +
          'One function per file is what makes the filename an index.',
      );
      continue;
    }

    const name = defined[0];
    const [schema, short] = name.split('.');
    const expected = `supabase/sql/functions/${schema}/${short}.sql`;
    if (where !== expected) {
      problems.push(`${where}: defines ${name}, so it belongs at ${expected}.`);
    }
    if (sources.has(name)) {
      problems.push(`${name} is defined in two files: ${sources.get(name).where} and ${where}.`);
    }

    // Who may call it, decided rather than defaulted. Postgres grants
    // `execute` on a new function to PUBLIC and Supabase's default privileges
    // grant it to the client roles by name; neither goes away on its own, and
    // a function that says nothing is a function anyone can call. `from
    // public` is always required; each client role must then be either
    // revoked or granted, so the answer is in the file rather than in
    // whatever the defaults happened to be.
    const acl = sql
      .split('\n')
      .filter((line) => /^\s*(revoke|grant)\b/.test(line) || /^\s+(from|to)\b/.test(line))
      .join(' ');
    if (!/revoke[^;]*\bfrom\b[^;]*\bpublic\b/.test(acl)) {
      problems.push(
        `${where}: no "revoke ... from public" — PUBLIC keeps the execute Postgres gave it.`,
      );
    }
    for (const role of ['anon', 'authenticated']) {
      const revoked = new RegExp(`revoke[^;]*\\bfrom\\b[^;]*\\b${role}\\b`).test(acl);
      const granted = new RegExp(`grant[^;]*\\bto\\b[^;]*\\b${role}\\b`).test(acl);
      if (!revoked && !granted) {
        problems.push(`${where}: ${role} is neither revoked nor granted — say which.`);
      }
    }

    sources.set(name, { where, sql });
  }

  // Nothing may be defined in a migration and left unfiled, or the next
  // ticket adds a function the old way and the tree quietly stops being true.
  const dropped = new Set();
  const inMigrations = new Map();
  for (const [entry, sql] of migrationFiles) {
    for (const name of namesIn(sql, DEFINES)) inMigrations.set(name, entry);
    for (const name of namesIn(sql, DROPS)) dropped.add(name);
  }
  for (const [name, entry] of inMigrations) {
    if (!sources.has(name) && !dropped.has(name)) {
      problems.push(
        `${name} is defined in ${entry} but has no file under supabase/sql/functions/. ` +
          'Move the definition there and run `pnpm gen:functions`.',
      );
    }
  }

  return { problems, sources };
}

export function render(sources) {
  // `check_function_bodies` off for the length of the block: a `language sql`
  // function's body is resolved at creation, so one calling another would make
  // the order of these files matter. It is turned back on immediately, and the
  // pgTAP suites are what actually prove the bodies work.
  return [
    BEGIN,
    'set check_function_bodies = off;',
    ...[...sources.values()].map(({ where, sql }) => `-- ${where}\n${sql}`),
    'reset check_function_bodies;',
    END,
  ].join('\n\n');
}

/** A minimal well-formed function file, for the self-test to break. */
function sample(name = 'public.example', extra = '') {
  return `create or replace function ${name}()
returns integer
language sql
immutable
as $$ select 1 $$;

revoke all on function ${name}() from public;
revoke all on function ${name}() from anon, authenticated;
${extra}`;
}

/** Every rule, shown failing. Returns a list of rules that did not fire. */
export function selfTest() {
  const path = 'supabase/sql/functions/public/example.sql';
  const cases = [
    ['a clean file', new Map([[path, sample()]]), new Map(), false],
    [
      'drift is caught elsewhere, but a clean tree must not report problems',
      new Map([[path, sample()]]),
      new Map([['0002_x.sql', 'create or replace function public.example() returns integer']]),
      false,
    ],
    [
      'two functions in one file',
      new Map([[path, `${sample()}\n${sample('public.other')}`]]),
      new Map(),
      true,
    ],
    [
      'a stripped revoke',
      new Map([[path, sample().replace(/revoke all on function [^\n]*from public;\n/, '')]]),
      new Map(),
      true,
    ],
    [
      'a client role neither revoked nor granted',
      new Map([[path, sample().replace(/revoke all on function [^\n]*from anon[^\n]*\n/, '')]]),
      new Map(),
      true,
    ],
    [
      'a function filed under the wrong name',
      new Map([['supabase/sql/functions/public/wrong.sql', sample()]]),
      new Map(),
      true,
    ],
    [
      'a function defined in a migration but never filed',
      new Map([[path, sample()]]),
      new Map([['0009_new.sql', 'create or replace function public.unfiled(a uuid)\n']]),
      true,
    ],
    [
      'unless that migration also drops it',
      new Map([[path, sample()]]),
      new Map([
        ['0009_new.sql', 'create or replace function public.unfiled(a uuid)\n'],
        ['0010_gone.sql', 'drop function public.unfiled(uuid);\n'],
      ]),
      false,
    ],
  ];

  return cases
    .filter(([, files, migrations, shouldFail]) => {
      const { problems } = analyse(files, migrations);
      return problems.length > 0 !== shouldFail;
    })
    .map(([label]) => label);
}

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

const checking = process.argv.includes('--check');

if (checking) {
  const unfired = selfTest();
  if (unfired.length > 0) {
    console.error('check:functions: the guard itself is broken — these rules did not fire:');
    for (const rule of unfired) console.error(`  - ${rule}`);
    process.exit(1);
  }
}

const migrationFiles = new Map(
  readdirSync(MIGRATIONS)
    .sort()
    .filter((entry) => entry.endsWith('.sql') && join(MIGRATIONS, entry) !== MIGRATION)
    .map((entry) => [entry, readFileSync(join(MIGRATIONS, entry), 'utf8')]),
);

const { problems, sources } = analyse(walk(SOURCE), migrationFiles);

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

const rendered = render(sources);
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
    `check:functions: ok (${sources.size} functions, ${selfTest().length} rules unproven)`,
  );
  process.exit(0);
}

writeFileSync(
  MIGRATION,
  migration.slice(0, start) + rendered + migration.slice(finish + END.length),
);
console.log(`gen:functions: wrote ${sources.size} functions to ${relative(root, MIGRATION)}`);
