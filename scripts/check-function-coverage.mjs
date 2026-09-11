// How much of the database is actually exercised by the database tests.
//
// There are 47 functions in `public`, `planning`, `private` and `jobs`, and
// since ADR 0015 each one's definition lives in a file you can read. What no
// file said was whether anything *calls* them. `check_function_bodies` catches
// a syntax error when a migration applies; a renamed column or a wrong cast
// inside a body waits until something calls it, and a migration header has
// claimed "the pgTAP suites are what prove the bodies work" without anybody
// checking that they reach them.
//
// So this measures it, nearly for free: Postgres counts function calls itself
// when `track_functions` is on, so the only work is turning that on, resetting
// the counters before the suites, and reading them after. It runs the suites
// rather than running beside them, which is why `db:test` calls this instead of
// `supabase test db`.
//
// Turning it on needs a superuser, and Supabase's `postgres` role is not one —
// `supabase_admin` is, locally. The setting is made here rather than in
// `seed.sql` for two reasons: the seed cannot (it is refused), and a local
// diagnostic has no business in a file that describes the product's scenarios.
// A database recreated by `db reset` loses the setting, which is why it is set
// on every run.
//
// pg_cron is paused for the duration, because it is not a test: it calls
// `jobs.invoke_process_scheduled_jobs` every minute and `jobs.run_retention`
// at 03:15, and a suite that runs for more than a minute would otherwise count
// those as reached whether or not anything tests them.
//
// It fails on a function that is **newly** unreached, against the baseline in
// `supabase/tests/function-coverage.txt`. Demanding that every function be
// reached today would fail the gate on the day it landed; stopping the number
// from growing is the part worth having. A function that becomes covered is
// reported, not punished — the nudge is to trim the baseline.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(root, 'supabase/tests/function-coverage.txt');
const SCHEMAS = "('public', 'planning', 'private', 'jobs')";

function supabase(args, options = {}) {
  return execFileSync('corepack', ['pnpm', 'exec', 'supabase', ...args], {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

function databaseUrl() {
  let status;
  try {
    status = supabase(['status', '-o', 'env']);
  } catch {
    console.error('check:function-coverage: the local stack is not running (`supabase start`).');
    process.exit(2);
  }
  const line = status.split('\n').find((candidate) => candidate.startsWith('DB_URL='));
  if (line === undefined) {
    console.error('check:function-coverage: `supabase status` reported no DB_URL.');
    process.exit(2);
  }
  return line.slice('DB_URL='.length).replace(/^"|"$/g, '');
}

const url = databaseUrl();
const query = (sql, as = url) =>
  execFileSync('psql', [as, '-Atc', sql], { encoding: 'utf8' }).trim();

const admin = url.replace('://postgres:', '://supabase_admin:');

/**
 * Turn the counters on, stop cron from contributing to them, and zero them.
 * Returns false when that is not possible — locally the suites still run and
 * their result is what matters, but in CI an unmeasured run is a silent hole in
 * the gate, so it fails there.
 */
function startCounting() {
  try {
    query(`alter database ${new URL(url).pathname.slice(1)} set track_functions = 'all'`, admin);
    query('update cron.job set active = false', admin);
    query('select pg_stat_reset()', admin);
    return true;
  } catch (reason) {
    const message = `check:function-coverage: coverage could not be measured — ${reason.message}`;
    if (process.env.CI !== undefined) {
      console.error(message);
      console.error('  In CI an unmeasured run is a hole in the gate, so this is a failure.');
      process.exit(1);
    }
    console.warn(`${message}\n  Carrying on; the test result below still stands.`);
    return false;
  }
}

/** Cron is the database's, not this script's: give it back. */
function stopCounting() {
  try {
    query('update cron.job set active = true', admin);
  } catch {
    console.warn('check:function-coverage: could not re-enable pg_cron; `supabase db reset` will.');
  }
}

const tracking = startCounting();

const tests = spawnSync('corepack', ['pnpm', 'exec', 'supabase', 'test', 'db'], {
  cwd: root,
  stdio: 'inherit',
});
if (tracking) stopCounting();
if (tests.status !== 0) process.exit(tests.status ?? 1);
if (!tracking) process.exit(0);

const unreached = query(`
  select n.nspname || '.' || p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join pg_stat_user_functions s on s.funcid = p.oid
  where n.nspname in ${SCHEMAS} and coalesce(s.calls, 0) = 0
  order by 1`)
  .split('\n')
  .filter((name) => name !== '');

const total = Number(
  query(`
  select count(*) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ${SCHEMAS}`),
);

const baseline = existsSync(BASELINE)
  ? readFileSync(BASELINE, 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter((line) => line !== '')
  : [];

const newlyUnreached = unreached.filter((name) => !baseline.includes(name));
const newlyCovered = baseline.filter((name) => !unreached.includes(name));

console.log(
  `check:function-coverage: ${total - unreached.length}/${total} functions called by the ` +
    `database tests; ${unreached.length} unreached.`,
);

if (newlyCovered.length > 0) {
  console.log(
    `  ${newlyCovered.length} now covered — trim them from supabase/tests/function-coverage.txt:`,
  );
  for (const name of newlyCovered) console.log(`    ${name}`);
}

if (newlyUnreached.length > 0) {
  console.error(
    '\ncheck:function-coverage: these functions are no longer called by any database test:',
  );
  for (const name of newlyUnreached) console.error(`  - ${name}`);
  console.error(
    '\nEither reach them from a test in supabase/tests/database/, or — if one is genuinely ' +
      'dead — delete it. Adding it to supabase/tests/function-coverage.txt is the last resort ' +
      'and wants a reason beside it.',
  );
  process.exit(1);
}
