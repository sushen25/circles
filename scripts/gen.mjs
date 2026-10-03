// `pnpm gen`: every generator, in the one order that works (SUS-141).
//
//   events -> transitions -> functions -> types
//
// `gen-events` writes the forbidden-key fragments into a source file that
// `gen-sql-functions` renders, so events come before functions. Types come
// last: they are read from the running local database, which has to hold the
// migrations as they now are (`pnpm db:reset` first if you changed one).
import { spawnSync } from 'node:child_process';

const steps = ['gen:events', 'gen:transitions', 'gen:functions', 'gen:types'];
const pnpm = process.env.npm_execpath;
for (const step of steps) {
  console.log(`\n> pnpm ${step}`);
  const run = pnpm
    ? spawnSync(process.execPath, [pnpm, 'run', step], { stdio: 'inherit' })
    : spawnSync('pnpm', ['run', step], { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`\ngen: stopped at ${step} (exit ${run.status}).`);
    process.exit(run.status ?? 1);
  }
}
