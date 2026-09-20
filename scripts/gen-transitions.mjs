// The plan state machine exists twice — once in TypeScript, where the client
// asks "can I do this?", and once in SQL, where the server decides. Architecture
// §8.3 says the SQL one is "mirrored from `packages/domain/planning`"; this is
// what makes that word true rather than aspirational.
//
//   pnpm gen:transitions     rewrite the generated block in the migration
//   pnpm check:transitions   fail if it no longer matches the domain
//
// The generated block lives inside `0003_planning.sql` between markers rather
// than in a file of its own, because Supabase migrations have no include
// mechanism and a seed that is not applied is not a mirror.
//
// **Once this migration has shipped**, regenerating in place would edit an
// applied migration. From that point a domain change means a *new* migration
// that reseeds `planning.transitions`, and `MIGRATION` below moves to it. The
// check compares the domain against whichever file is named here, so pointing
// it at the new one is the whole of the change.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(root, 'supabase/migrations/0019_soft_quorum.sql');
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

const sql = readFileSync(MIGRATION, 'utf8');
const start = sql.indexOf(BEGIN);
const finish = sql.indexOf(END);
if (start === -1 || finish === -1) {
  console.error(`gen-transitions: markers not found in ${MIGRATION}`);
  process.exit(2);
}

const current = sql.slice(start, finish + END.length);
const generated = render();

if (process.argv.includes('--check')) {
  if (current !== generated) {
    console.error(
      'check:transitions: the SQL transition table no longer matches ' +
        'packages/domain/src/planning/state-machine.ts.\n' +
        'Run `pnpm gen:transitions`. If this migration has already shipped, ' +
        'add a new migration that reseeds planning.transitions and point ' +
        'MIGRATION in scripts/gen-transitions.mjs at it.',
    );
    process.exit(1);
  }
  console.log(`check:transitions: ok (${TRANSITIONS.length} transitions)`);
  process.exit(0);
}

writeFileSync(MIGRATION, sql.slice(0, start) + generated + sql.slice(finish + END.length));
console.log(`gen:transitions: wrote ${TRANSITIONS.length} transitions to ${MIGRATION}`);
