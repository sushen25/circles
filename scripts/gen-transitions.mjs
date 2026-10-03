// The plan state machine exists twice — once in TypeScript, where the client
// asks "can I do this?", and once in SQL, where the server decides. Architecture
// §8.3 says the SQL one is "mirrored from `packages/domain/planning`"; this is
// what makes that word true rather than aspirational.
//
//   pnpm gen:transitions     rewrite the generated block in the migration
//   pnpm check:transitions   fail if it no longer matches the domain
//
// The generated block lives inside a migration between markers rather than in
// a file of its own, because Supabase migrations have no include mechanism and
// a seed that is not applied is not a mirror.
//
// Which migration: the check compares the domain against the latest one that
// holds the block. `gen:transitions` writes into the highest-numbered migration
// that is not on `origin/main` (`migrations.mjs`), and refuses when there is
// none, because a shipped migration is never edited. A domain change therefore
// means `pnpm gen:migration <name>` with the block in it (below), then this.
// The block is a reseed:
//
//   delete from planning.transitions;
//
//   -- BEGIN GENERATED: transitions (scripts/gen-transitions.mjs)
//   -- END GENERATED: transitions
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MIGRATIONS, holderOf, readAll, resolveWriteTarget } from './migrations.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '-- BEGIN GENERATED: transitions (scripts/gen-transitions.mjs)';
const END = '-- END GENERATED: transitions';

const { TRANSITIONS } = await import(
  join(root, 'packages/domain/dist/planning/state-machine.js')
).catch(() => {
  console.error(
    'gen-transitions: packages/domain/dist is missing — run `pnpm build` first.\n' +
      'In `pnpm check` this runs after `typecheck`, which builds it.',
  );
  process.exit(2);
});

/** Postgres has no empty-array literal that infers a type; `array[]` needs a cast. */
function guardArray(guards) {
  if (guards.length === 0) return 'array[]::text[]';
  return `array[${guards.map((g) => `'${g}'`).join(',')}]`;
}

function render() {
  const rows = TRANSITIONS.map(
    (t) =>
      `  ('${t.from}', '${t.action}', '${t.to}', ${guardArray(t.guards)}, ` +
      `${t.bumpsRevision === true ? 'true' : 'false'})`,
  );
  return [
    BEGIN,
    'insert into planning.transitions (from_state, action, to_state, guards, bumps_revision) values',
    `${rows.join(',\n')};`,
    END,
  ].join('\n');
}

const files = readAll();
const holder = holderOf(files, BEGIN);
if (holder === undefined || !files.get(holder).includes(END)) {
  console.error('gen-transitions: no migration holds the transitions block (markers not found).');
  process.exit(2);
}
const sql = files.get(holder);
const start = sql.indexOf(BEGIN);
const finish = sql.indexOf(END);

const current = sql.slice(start, finish + END.length);
const generated = render();

if (process.argv.includes('--check')) {
  if (current !== generated) {
    console.error(
      'check:transitions: the SQL transition table no longer matches ' +
        'packages/domain/src/planning/state-machine.ts.\n' +
        `Add a migration with \`pnpm gen:migration <name>\` (unless this branch already has one), ` +
        'put the block in it (see the header of scripts/gen-transitions.mjs), and run ' +
        '`pnpm gen:transitions`. A migration on main is never edited.',
    );
    process.exit(1);
  }
  console.log(`check:transitions: ok (${TRANSITIONS.length} transitions, in ${holder})`);
  process.exit(0);
}

if (current === generated) {
  console.log(`gen:transitions: up to date (${TRANSITIONS.length} transitions in ${holder})`);
  process.exit(0);
}

const target = resolveWriteTarget({
  gen: 'gen:transitions',
  files,
  begin: BEGIN,
  holder,
  template: `delete from planning.transitions;\n\n${BEGIN}\n${END}`,
});
const targetSql = files.get(target);
const from = targetSql.indexOf(BEGIN);
const to = targetSql.indexOf(END);
writeFileSync(
  join(MIGRATIONS, target),
  targetSql.slice(0, from) + generated + targetSql.slice(to + END.length),
);
console.log(`gen:transitions: wrote ${TRANSITIONS.length} transitions to ${target}`);
