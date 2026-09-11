// Two lists live in TypeScript and are enforced in SQL: the domain event
// catalogue (`DOMAIN_EVENT_NAMES`, packages/domain) and the key fragments a
// payload may not carry (`FORBIDDEN_PAYLOAD_KEYS`, packages/contracts). The
// outbox checks both — `event_name` against the catalogue, every payload key at
// every depth against the fragments — and a check that lives in two places is a
// check that disagrees with itself one day. This makes the SQL a rendering of
// the TypeScript, the way `gen-transitions.mjs` does for the state machine.
//
//   pnpm gen:events      rewrite the generated blocks in the migration
//   pnpm check:events    fail if they no longer match
//
// The two lists have different homes, because they are enforced in different
// kinds of thing. The event names are a **table constraint** on `jobs.outbox`,
// so they live in the migration that creates the table. The fragments are the
// body of **`jobs.carries_content`**, and a function's definition lives in
// `supabase/sql/functions/` (ADR 0015) — which is the copy a database actually
// ends up with, because `0008` re-creates every function from the tree after
// this migration has run. Writing only the migration would let a new fragment
// be added, checked, and then silently reverted.
//
// **Once this migration has shipped**, a change to the event names means a new
// migration that replaces the constraint, and `MIGRATION` moves to it. The
// fragments need no new migration: the tree is regenerated into whichever
// functions migration is current.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(root, 'supabase/migrations/0006_communication_jobs_analytics.sql');
const CARRIES_CONTENT = join(root, 'supabase/sql/functions/jobs/carries_content.sql');

const missing = () => {
  console.error(
    'gen-events: packages/*/dist is missing — run `pnpm build` first.\n' +
      'In `pnpm check` this runs after `typecheck`, which builds it.',
  );
  process.exit(2);
};
const { DOMAIN_EVENT_NAMES } = await import(
  join(root, 'packages/domain/dist/shared/events.js')
).catch(missing);
const { FORBIDDEN_PAYLOAD_KEYS } = await import(
  join(root, 'packages/contracts/dist/analytics.js')
).catch(missing);

const BLOCKS = [
  {
    begin: '-- BEGIN GENERATED: event names (scripts/gen-events.mjs)',
    end: '-- END GENERATED: event names',
    files: [MIGRATION],
    render: () =>
      DOMAIN_EVENT_NAMES.map(
        (name, i) => `    '${name}'${i === DOMAIN_EVENT_NAMES.length - 1 ? '' : ','}`,
      ).join('\n'),
  },
  {
    begin: '-- BEGIN GENERATED: forbidden key fragments (scripts/gen-events.mjs)',
    end: '-- END GENERATED: forbidden key fragments',
    // Both homes: the migration that first created the function, and the tree
    // file that is now its definition. See the header.
    files: [MIGRATION, CARRIES_CONTENT],
    render: () => `    array[${FORBIDDEN_PAYLOAD_KEYS.map((k) => `'${k}'`).join(', ')}]`,
  },
];

const targets = [...new Set(BLOCKS.flatMap((block) => block.files))];
const updated = new Map();
let drifted = false;
for (const target of targets) {
  let sql = readFileSync(target, 'utf8');
  for (const block of BLOCKS.filter((candidate) => candidate.files.includes(target))) {
    const start = sql.indexOf(block.begin);
    const finish = sql.indexOf(block.end);
    if (start === -1 || finish === -1) {
      console.error(`gen-events: markers for "${block.begin}" not found in ${target}`);
      process.exit(2);
    }
    const generated = [block.begin, block.render(), block.end].join('\n');
    const current = sql.slice(start, finish + block.end.length);
    if (current !== generated) drifted = true;
    sql = sql.slice(0, start) + generated + sql.slice(finish + block.end.length);
  }
  updated.set(target, sql);
}

if (process.argv.includes('--check')) {
  if (drifted) {
    console.error(
      'check:events: the outbox constraints no longer match DOMAIN_EVENT_NAMES / ' +
        'FORBIDDEN_PAYLOAD_KEYS.\nRun `pnpm gen:events`, then `pnpm gen:functions` — the ' +
        'fragments are part of a function definition, so the functions migration is ' +
        'rendered from the tree afterwards. If this migration has already shipped, add a ' +
        'new migration and point MIGRATION in scripts/gen-events.mjs at it.',
    );
    process.exit(1);
  }
  console.log(
    `check:events: ok (${DOMAIN_EVENT_NAMES.length} events, ${FORBIDDEN_PAYLOAD_KEYS.length} fragments)`,
  );
  process.exit(0);
}

for (const [target, sql] of updated) writeFileSync(target, sql);
console.log(
  `gen:events: wrote ${DOMAIN_EVENT_NAMES.length} events and ${FORBIDDEN_PAYLOAD_KEYS.length} fragments ` +
    `to ${targets.length} file(s). Run \`pnpm gen:functions\` to carry the fragments into the functions migration.`,
);
