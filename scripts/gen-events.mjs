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
// kinds of thing, and each is written in exactly one place.
//
// The event names are a **table constraint** on `jobs.outbox`, so they live in
// the migration that last replaced it: the latest one that holds the block.
// `gen:events` writes into the highest-numbered migration that is not on
// `origin/main` (`migrations.mjs`) and refuses when there is none, because a
// shipped migration is never edited. A change to the event names therefore
// means `pnpm gen:migration <name>` with the constraint in it (below), then
// this. Earlier blocks are history, like 0006's fragments.
//
//   alter table jobs.outbox drop constraint outbox_event_name;
//   alter table jobs.outbox add constraint outbox_event_name check (event_name in (
//   -- BEGIN GENERATED: event names (scripts/gen-events.mjs)
//   -- END GENERATED: event names
//   ));
//
// The fragments are the body of **`jobs.carries_content`**, and a function's
// definition lives in `supabase/sql/functions/` (ADR 0015). That is the copy a
// database ends up with, because the functions migration re-creates every
// function from the tree after this one has run, so the tree is the only place
// worth writing. `0006` contains an older copy of the block, markers and all,
// from when the function was first created; it is history and is deliberately
// not regenerated. Do not edit it, and do not trust it — read the tree.
//
// The fragments need no new migration of their own: the tree is rendered into
// the branch's new functions migration by `gen-sql-functions.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MIGRATIONS, holderOf, readAll, resolveWriteTarget } from './migrations.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVENT_BEGIN = '-- BEGIN GENERATED: event names (scripts/gen-events.mjs)';
const EVENT_END = '-- END GENERATED: event names';
const files = readAll();
const HOLDER = holderOf(files, EVENT_BEGIN);
if (HOLDER === undefined) {
  console.error('gen-events: no migration holds the event names block (markers not found).');
  process.exit(2);
}
const MIGRATION = join(MIGRATIONS, HOLDER);
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
    begin: EVENT_BEGIN,
    end: EVENT_END,
    files: [MIGRATION],
    render: () =>
      DOMAIN_EVENT_NAMES.map(
        (name, i) => `    '${name}'${i === DOMAIN_EVENT_NAMES.length - 1 ? '' : ','}`,
      ).join('\n'),
  },
  {
    begin: '-- BEGIN GENERATED: forbidden key fragments (scripts/gen-events.mjs)',
    end: '-- END GENERATED: forbidden key fragments',
    // The tree only. `0006`'s copy is the historical one — see the header.
    files: [CARRIES_CONTENT],
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
        'rendered from the tree afterwards. If the event names changed, add a migration with ' +
        '`pnpm gen:migration <name>` (unless this branch has one) and put the constraint in it ' +
        '(see the header of scripts/gen-events.mjs); a migration on main is never edited.',
    );
    process.exit(1);
  }
  console.log(
    `check:events: ok (${DOMAIN_EVENT_NAMES.length} events, ${FORBIDDEN_PAYLOAD_KEYS.length} fragments)`,
  );
  process.exit(0);
}

if (!drifted) {
  console.log(`gen:events: up to date (${DOMAIN_EVENT_NAMES.length} events in ${HOLDER})`);
  process.exit(0);
}

const eventsDrifted = updated.get(MIGRATION) !== readFileSync(MIGRATION, 'utf8');
let written = null;
if (eventsDrifted) {
  const name = resolveWriteTarget({
    gen: 'gen:events',
    files,
    begin: EVENT_BEGIN,
    holder: HOLDER,
    template:
      'alter table jobs.outbox drop constraint outbox_event_name;\n' +
      'alter table jobs.outbox add constraint outbox_event_name check (event_name in (\n' +
      `${EVENT_BEGIN}\n${EVENT_END}\n));`,
  });
  const sql = files.get(name);
  const from = sql.indexOf(EVENT_BEGIN);
  const to = sql.indexOf(EVENT_END);
  const rendered = updated.get(MIGRATION);
  const generated = rendered.slice(
    rendered.indexOf(EVENT_BEGIN),
    rendered.indexOf(EVENT_END) + EVENT_END.length,
  );
  writeFileSync(
    join(MIGRATIONS, name),
    sql.slice(0, from) + generated + sql.slice(to + EVENT_END.length),
  );
  written = name;
}
for (const [target, sql] of updated) {
  if (target !== MIGRATION) writeFileSync(target, sql);
}
console.log(
  `gen:events: wrote ${DOMAIN_EVENT_NAMES.length} events and ${FORBIDDEN_PAYLOAD_KEYS.length} fragments ` +
    `(names: ${written ?? 'unchanged'}). Run \`pnpm gen:functions\` to carry the fragments into ` +
    'the functions migration.',
);
