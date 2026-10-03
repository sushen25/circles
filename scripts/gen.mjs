// `pnpm gen`: every generator, in the one order that works (SUS-141).
//
//   events -> transitions -> functions -> types
//
// The workspace is built first, because the generators read `packages/*/dist`
// and not the TypeScript beside it; without it an edit to the event catalogue
// or the state machine would be reported as up to date.
//
// `gen-events` writes the forbidden-key fragments into a source file that
// `gen-sql-functions` renders, so events come before functions. Types come
// last: they are read from the running local database, which has to hold the
// migrations as they now are. If an earlier step rewrote a migration this run,
// it stops before types and says so, because generating them from a database
// that has not seen the change would succeed and be wrong.
import { spawnSync } from 'node:child_process';

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS } from './migrations.mjs';

const digest = () =>
  createHash('sha256')
    .update(
      readdirSync(MIGRATIONS)
        .sort()
        .map((name) => name + readFileSync(join(MIGRATIONS, name), 'utf8'))
        .join('\0'),
    )
    .digest('hex');
const before = digest();

const steps = ['build', 'gen:events', 'gen:transitions', 'gen:functions', 'gen:types'];
const pnpm = process.env.npm_execpath;
for (const step of steps) {
  if (step === 'gen:types' && digest() !== before) {
    console.error(
      '\ngen: a migration was rewritten by this run. Apply it, then generate the types:\n' +
        '  pnpm db:reset && pnpm gen:types',
    );
    process.exit(1);
  }
  console.log(`\n> pnpm ${step}`);
  const run = pnpm
    ? spawnSync(process.execPath, [pnpm, 'run', step], { stdio: 'inherit' })
    : spawnSync('pnpm', ['run', step], { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`\ngen: stopped at ${step} (exit ${run.status}).`);
    process.exit(run.status ?? 1);
  }
}
