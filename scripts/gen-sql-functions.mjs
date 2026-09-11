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
// `--check` also runs `selfTest()` below, because a guard nobody has seen
// fail is a guard nobody knows works: it feeds the rules trees that break
// them and fails unless each one is reported, by name.
//
// **Once the migration named below has shipped**, regenerating in place would
// edit an applied migration. From that point a change means a *new* migration
// carrying the changed definitions, and `MIGRATION` moves to it — the same
// rule the other two generators carry.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'supabase/sql/functions');
const MIGRATIONS = join(root, 'supabase/migrations');
const MIGRATION = join(MIGRATIONS, '0008_function_definitions.sql');
const BEGIN = '-- BEGIN GENERATED: function definitions (scripts/gen-sql-functions.mjs)';
const END = '-- END GENERATED: function definitions';

// Deliberately lenient about everything Postgres is lenient about, because
// this is a guard and what it guards against is somebody writing SQL the
// ordinary way: `CREATE OR REPLACE FUNCTION` in caps, a bare `create
// function`, an indented statement, a quoted identifier. Strict matching would
// mean the rule only catches the house style, which is the one form that was
// never the risk.
const NAME = String.raw`"?[A-Za-z_][\w$]*"?(?:\s*\.\s*"?[A-Za-z_][\w$]*"?)*`;
const CREATES = new RegExp(
  String.raw`^[ \t]*create\s+(?:or\s+replace\s+)?function\s+(${NAME})\s*\(`,
  'gim',
);
const VERBS = new RegExp(
  String.raw`^[ \t]*(create\s+(?:or\s+replace\s+)?function|drop\s+function(?:\s+if\s+exists)?)\s`,
  'gim',
);
const NAMES = new RegExp(NAME, 'g');

/**
 * Postgres folds an unquoted identifier to lower case, so `Public.Foo` and
 * `public.foo` are one function. Quoted identifiers keep their case; this
 * folds them too, which could in principle mis-key `"Foo"` — no such name
 * exists here, and mis-keying makes the guard *complain*, never pass.
 */
function normalise(name) {
  return name.replace(/["\s]/g, '').toLowerCase();
}

function createdIn(sql) {
  return [...sql.matchAll(CREATES)].map((match) => normalise(match[1]));
}

/**
 * Every create and drop, in the order they appear, so a drop cannot excuse a
 * create that comes after it. A single `drop function a(…), b(…)` drops both,
 * so a drop's names are read from its whole statement rather than just the
 * first one.
 */
function operations(sql) {
  const ops = [];
  for (const match of sql.matchAll(VERBS)) {
    if (!/^\s*drop/i.test(match[1])) {
      const created = new RegExp(CREATES.source, 'im').exec(sql.slice(match.index));
      if (created) ops.push({ name: normalise(created[1]), dropping: false });
      continue;
    }
    const statement = sql.slice(match.index + match[0].length).split(';')[0];
    for (const name of statement.match(NAMES) ?? []) {
      ops.push({ name: normalise(name), dropping: true });
    }
  }
  return ops;
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
    const defined = createdIn(sql);

    if (defined.length !== 1) {
      problems.push(
        `${where}: expected exactly one "create or replace function", found ${defined.length}. ` +
          'One function per file is what makes the filename an index.',
      );
      continue;
    }

    const name = defined[0];
    if (!name.includes('.')) {
      problems.push(`${where}: defines ${name} with no schema — write \`schema.name\`.`);
      continue;
    }
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
    // public` is always required and a grant back to PUBLIC undoes it; each
    // client role must then be either revoked or granted, so the answer is in
    // the file rather than in whatever the defaults happened to be.
    const acl = sql
      .split('\n')
      .filter((line) => /^\s*(revoke|grant)\b/.test(line) || /^\s+(from|to)\b/.test(line))
      .join(' ');
    if (!/revoke[^;]*\bfrom\b[^;]*\bpublic\b/.test(acl)) {
      problems.push(
        `${where}: no "revoke ... from public" — PUBLIC keeps the execute Postgres gave it.`,
      );
    }
    if (/grant[^;]*\bto\b[^;]*\bpublic\b/.test(acl)) {
      problems.push(`${where}: grants execute to PUBLIC, which is every role there will ever be.`);
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
  //
  // What matters is each function's *last* word: created and later dropped
  // needs no file, but dropped and later created again does. Migrations are
  // read in filename order and each file's statements in the order they
  // appear, so "last" means last.
  const history = new Map();
  for (const [entry, sql] of migrationFiles) {
    for (const { name, dropping } of operations(sql)) {
      const seen = history.get(name) ?? { creates: 0, entry };
      history.set(name, {
        creates: seen.creates + (dropping ? 0 : 1),
        dropping,
        entry: dropping ? seen.entry : entry,
      });
    }
  }
  for (const [name, { creates, dropping, entry }] of history) {
    if (sources.has(name)) continue;
    if (!dropping) {
      problems.push(
        `${name} is defined in ${entry} but has no file under supabase/sql/functions/. ` +
          'Move the definition there and run `pnpm gen:functions`.',
      );
    } else if (creates > 1) {
      // The tree is keyed by name, so it cannot hold two signatures, and this
      // script cannot tell which one a `drop` removed. Rather than guess in
      // the permissive direction, say so.
      problems.push(
        `${name} was created ${creates} times and then dropped; with overloads this script ` +
          'cannot tell which signature survives. Give the surviving one a file, or drop them all.',
      );
    }
  }

  return { problems, sources };
}

export function render(sources) {
  return [BEGIN, ...[...sources.values()].map(({ where, sql }) => `-- ${where}\n${sql}`), END].join(
    '\n\n',
  );
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

const FILE = 'supabase/sql/functions/public/example.sql';
const clean = () => new Map([[FILE, sample()]]);

/**
 * Every rule, shown failing — and each case says *which* rule it expects, so a
 * case cannot pass because some unrelated rule happened to fire.
 */
const CASES = [
  { label: 'a clean tree', files: clean(), migrations: new Map() },
  {
    label: 'a clean tree whose function is also in a migration',
    files: clean(),
    migrations: new Map([['0002_x.sql', 'create or replace function public.example()\n']]),
  },
  {
    label: 'two functions in one file',
    files: new Map([[FILE, `${sample()}\n${sample('public.other')}`]]),
    migrations: new Map(),
    expect: 'found 2',
  },
  {
    label: 'a stripped revoke from public',
    files: new Map([[FILE, sample().replace(/revoke all on function [^\n]*from public;\n/, '')]]),
    migrations: new Map(),
    expect: 'PUBLIC keeps the execute',
  },
  {
    label: 'a grant back to PUBLIC',
    files: new Map([
      [FILE, sample('public.example', 'grant execute on function public.example() to public;')],
    ]),
    migrations: new Map(),
    expect: 'grants execute to PUBLIC',
  },
  {
    label: 'a client role neither revoked nor granted',
    files: new Map([
      [FILE, sample().replace(/revoke all on function [^\n]*from anon[^\n]*\n/, '')],
    ]),
    migrations: new Map(),
    expect: 'anon is neither revoked nor granted',
  },
  {
    label: 'a function filed under the wrong name',
    files: new Map([['supabase/sql/functions/public/wrong.sql', sample()]]),
    migrations: new Map(),
    expect: 'it belongs at',
  },
  {
    label: 'a function with no schema',
    files: new Map([[FILE, sample('example')]]),
    migrations: new Map(),
    expect: 'with no schema',
  },
  {
    label: 'a function defined in a migration but never filed',
    files: clean(),
    migrations: new Map([['0009_new.sql', 'create or replace function public.unfiled(a uuid)\n']]),
    expect: 'has no file',
  },
  {
    label: 'the same, shouted — the form most tools emit',
    files: clean(),
    migrations: new Map([['0009_new.sql', 'CREATE OR REPLACE FUNCTION public.unfiled(a uuid)\n']]),
    expect: 'has no file',
  },
  {
    label: 'the same, without "or replace"',
    files: clean(),
    migrations: new Map([['0009_new.sql', 'create function public.unfiled(a uuid)\n']]),
    expect: 'has no file',
  },
  {
    label: 'the same, indented',
    files: clean(),
    migrations: new Map([
      ['0009_new.sql', '  create or replace function public.unfiled(a uuid)\n'],
    ]),
    expect: 'has no file',
  },
  {
    label: 'the same, quoted',
    files: clean(),
    migrations: new Map([
      ['0009_new.sql', 'create or replace function "public"."unfiled"(a uuid)\n'],
    ]),
    expect: 'has no file',
  },
  {
    label: 'unless a later migration drops it',
    files: clean(),
    migrations: new Map([
      ['0009_new.sql', 'create or replace function public.unfiled(a uuid)\n'],
      ['0010_gone.sql', 'drop function public.unfiled(uuid);\n'],
    ]),
  },
  {
    label: 'or the same migration does',
    files: clean(),
    migrations: new Map([
      [
        '0009_both.sql',
        'create or replace function public.unfiled(a uuid)\ndrop function public.unfiled(uuid);\n',
      ],
    ]),
  },
  {
    label: 'or one drop statement names it alongside another',
    files: clean(),
    migrations: new Map([
      [
        '0009_two.sql',
        'create or replace function public.one(a uuid)\ncreate or replace function public.two(a uuid)\n' +
          'drop function public.one(uuid), public.two(uuid);\n',
      ],
    ]),
  },
  {
    label: 'but a drop does not excuse a later create',
    files: clean(),
    migrations: new Map([
      ['0009_gone.sql', 'drop function public.unfiled(uuid);\n'],
      ['0010_back.sql', 'create or replace function public.unfiled(a uuid)\n'],
    ]),
    expect: 'has no file',
  },
  {
    label: 'nor one recreated further down the same migration',
    files: clean(),
    migrations: new Map([
      [
        '0009_churn.sql',
        'drop function public.unfiled(uuid);\ncreate or replace function public.unfiled(a uuid)\n',
      ],
    ]),
    expect: 'has no file',
  },
  {
    label: 'and a dropped overload does not excuse its surviving sibling',
    files: clean(),
    migrations: new Map([
      [
        '0009_overload.sql',
        'create or replace function public.u(a uuid)\ncreate or replace function public.u(a text)\n' +
          'drop function public.u(text);\n',
      ],
    ]),
    expect: 'cannot tell which signature survives',
  },
];

/** Returns the labels of cases whose rule did not fire as intended. */
export function selfTest() {
  return CASES.filter(({ files, migrations, expect }) => {
    const { problems } = analyse(files, migrations);
    if (expect === undefined) return problems.length > 0;
    return !problems.some((problem) => problem.includes(expect));
  }).map(({ label }) => label);
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
    console.log(`check:functions: ok (${sources.size} functions, ${CASES.length} rules proven)`);
    process.exit(0);
  }

  writeFileSync(
    MIGRATION,
    migration.slice(0, start) + rendered + migration.slice(finish + END.length),
  );
  console.log(`gen:functions: wrote ${sources.size} functions to ${relative(root, MIGRATION)}`);
}

// Only when run, never when imported for `analyse` / `render` / `selfTest`:
// importing a module should not rewrite a migration.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
