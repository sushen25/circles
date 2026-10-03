// The gate refuses a change to a migration that is already on the base branch
// (SUS-141). See `migrations.mjs` for why, and for what "the base" is.
//
//   pnpm check:migrations     fail, naming the file, if an applied migration changed
//
// If this fires: put the change in a NEW migration (`pnpm gen:migration <name>`)
// and restore the old one with `git checkout origin/main -- supabase/migrations/<file>`.
// A generated block (functions, transitions, event names) is changed the same
// way: add the migration, then `pnpm gen`.
import {
  baseRef,
  judge,
  localMigrations,
  readBase,
  readLocal,
  refreshBase,
} from './migrations.mjs';

/** The cases that prove the guard fires; run before the real check, like check:functions. */
function selfTest() {
  const a = '0001_a.sql';
  const b = '0002_b.sql';
  const base = new Map([
    [a, 'one'],
    [b, 'two'],
  ]);
  const cases = [
    [
      'an applied migration edited',
      new Map([
        [a, 'ONE'],
        [b, 'two'],
      ]),
      (p) => p.some((x) => x.startsWith(a)),
    ],
    ['an applied migration deleted', new Map([[a, 'one']]), (p) => p.some((x) => x.startsWith(b))],
    [
      'a new migration below the base latest',
      new Map([
        [a, 'one'],
        [b, 'two'],
        ['0001_c.sql', 'x'],
      ]),
      (p) => p.some((x) => x.startsWith('0001_c.sql')),
    ],
    [
      'a new migration at the base latest number',
      new Map([
        [a, 'one'],
        [b, 'two'],
        ['0002_c.sql', 'x'],
      ]),
      (p) => p.some((x) => x.startsWith('0002_c.sql')),
    ],
    [
      'a new migration with no version',
      new Map([
        [a, 'one'],
        [b, 'two'],
        ['extra.sql', 'x'],
      ]),
      (p) => p.some((x) => x.startsWith('extra.sql')),
    ],
  ];
  const unfired = cases.filter(([, local, fires]) => !fires(judge(base, local))).map(([n]) => n);
  const quiet = [
    ['nothing changed', new Map(base)],
    ['one new migration above the latest', new Map([...base, ['0003_c.sql', 'x']])],
    [
      'two new migrations (a stacked branch)',
      new Map([...base, ['0003_c.sql', 'x'], ['0004_d.sql', 'y']]),
    ],
  ]
    .filter(([, local]) => judge(base, local).length > 0)
    .map(([n]) => `false alarm: ${n}`);
  return [...unfired, ...quiet];
}

const broken = selfTest();
if (broken.length > 0) {
  console.error('check:migrations: the guard itself is broken:');
  for (const name of broken) console.error(`  - ${name}`);
  process.exit(1);
}

const ref = baseRef();
const stale = refreshBase(ref);
const base = readBase(ref);

if (base.error) {
  const message = `check:migrations: cannot read ${ref} (${base.error.split('\n')[0]}).`;
  if (process.env.CI) {
    console.error(
      `${message}\nIn CI that is a failure: a guard that cannot see the base guards nothing.`,
    );
    process.exit(1);
  }
  console.warn(`${message} Skipped locally; CI checks it against the pull request's base.`);
  process.exit(0);
}

const local = new Map(localMigrations().map((name) => [name, readLocal(name)]));
const problems = judge(base.files, local, ref);

if (problems.length > 0) {
  console.error(`check:migrations: ${problems.length} problem(s) against ${ref}\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nA migration on the base has been applied, and `supabase db push` skips it, so an edit\n' +
      'changes the repository and nothing else. Put the change in a new migration\n' +
      '(`pnpm gen:migration <name>`, then `pnpm gen`) and restore the old file with\n' +
      '`git checkout ' +
      ref +
      ' -- supabase/migrations/<file>`.',
  );
  process.exit(1);
}

const added = [...local.keys()].filter((name) => !base.files.has(name));
if (stale) console.warn(`check:migrations: note: ${stale}`);
console.log(
  `check:migrations: ok (${base.files.size} on ${ref} untouched, ` +
    `${added.length === 0 ? 'none new' : `${added.length} new: ${added.join(', ')}`})`,
);
