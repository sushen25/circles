// Which migration a generator writes into, and whether an applied one was
// edited. One place, because three generators and a guard have to agree.
//
// A migration that is on the base branch has been applied: every merge to
// `main` runs `supabase db push` on dev, and `db push` skips a version it has
// already seen. Editing one still passes `pnpm check` (`db reset` replays the
// new text) and changes nothing anywhere that matters. So:
//
//   - `check:migrations` fails when a file that exists on the base differs
//     from it, and when a new file is numbered at or below the base's latest
//     (`db push` refuses to apply a version older than what it has applied).
//   - the generators write into **the highest-numbered migration that is not
//     on the base**. A stacked branch legitimately holds several; the
//     highest is the one that branch added last, and the ones below it belong
//     to the branches underneath. Nothing is edited by hand when a migration
//     is added, and no constant has to move.
//
// The base is `origin/main`. In CI it is the pull request's base branch
// (`MIGRATION_BASE`, set by check.yml), so a PR stacked on another ticket's
// branch is compared with that branch and holds one new migration, not
// several. Locally, `MIGRATION_BASE=origin/<branch>` does the same.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS = join(root, 'supabase/migrations');
const REL = 'supabase/migrations';

export const versionOf = (name) => {
  const match = /^(\d+)_/.exec(name);
  return match ? Number(match[1]) : null;
};

export function baseRef(env = process.env) {
  return env.MIGRATION_BASE || 'origin/main';
}

export function localMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((entry) => entry.endsWith('.sql'))
    .sort();
}

export function readLocal(name) {
  return readFileSync(join(MIGRATIONS, name));
}

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * Bring `origin/<branch>` up to date, once, best effort. Skipped in CI (the
 * checkout just fetched everything) and with `MIGRATION_NO_FETCH=1`. Returns
 * a note when it could not, so the caller can say the ref may be stale.
 */
export function refreshBase(ref = baseRef(), env = process.env) {
  if (env.CI || env.MIGRATION_NO_FETCH) return null;
  const match = /^origin\/(.+)$/.exec(ref);
  if (!match) return null;
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin', match[1]], {
      cwd: root,
      stdio: 'ignore',
      timeout: 20_000,
    });
    return null;
  } catch {
    return `could not reach origin; using ${ref} as last fetched`;
  }
}

/**
 * The migrations on the base: `{ ref, files: Map<name, Buffer> }`, or
 * `{ ref, error }` when the ref does not resolve.
 */
export function readBase(ref = baseRef()) {
  let listing;
  try {
    listing = git(['ls-tree', '--name-only', ref, `${REL}/`]).toString('utf8');
  } catch (error) {
    return { ref, error: String(error.stderr ?? error.message).trim() };
  }
  const files = new Map();
  for (const path of listing.split('\n').filter((line) => line.endsWith('.sql'))) {
    files.set(path.slice(REL.length + 1), git(['show', `${ref}:${path}`]));
  }
  return { ref, files };
}

const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/**
 * The whole guard as a pure function, so a case can prove it fires.
 * `base` and `local` are Map<name, Buffer|string>.
 */
export function judge(base, local, ref = 'origin/main') {
  const problems = [];
  for (const [name, text] of base) {
    if (!local.has(name)) {
      problems.push(
        `${name} is on ${ref} and is gone here. An applied migration is never deleted or renamed.`,
      );
    } else if (!sameBytes(text, local.get(name))) {
      problems.push(`${name} is on ${ref} and has been changed here.`);
    }
  }
  const latest = Math.max(0, ...[...base.keys()].map((name) => versionOf(name) ?? 0));
  const seen = new Map();
  for (const name of local.keys()) {
    const version = versionOf(name);
    if (version === null) continue;
    if (seen.has(version)) {
      problems.push(
        `${name} and ${seen.get(version)} share version ${String(version).padStart(4, '0')}. ` +
          'Supabase records a migration by its version, so the second would never apply.',
      );
    } else seen.set(version, name);
  }
  for (const name of local.keys()) {
    if (base.has(name)) continue;
    const version = versionOf(name);
    if (version === null) {
      problems.push(`${name} does not start with a version number (NNNN_name.sql).`);
    } else if (version <= latest) {
      problems.push(
        `${name} is new but numbered at or below ${ref}'s latest migration (${String(latest).padStart(4, '0')}). ` +
          '`supabase db push` will not apply a version older than one it has applied. ' +
          'Rename it to the next number after rebasing on the base.',
      );
    }
  }
  return problems;
}

/** The migrations that are here and not on the base, lowest first. */
export function addedSince(base, local) {
  return [...local.keys()].filter((name) => !base.has(name)).sort();
}

/**
 * Where the generators write: the highest-numbered migration not on the base.
 * Returns `{ ref, added, newest, note }`; `newest` is null when there is none,
 * and `unreachable` is true when the base could not be read at all (the caller
 * falls back to the latest migration that already holds its block, and says so).
 */
export function findTarget({ fetch = true } = {}) {
  const ref = baseRef();
  const note = fetch ? refreshBase(ref) : null;
  const base = readBase(ref);
  if (base.error) {
    return { ref, added: [], newest: null, unreachable: true, note: base.error };
  }
  const local = new Map(localMigrations().map((name) => [name, true]));
  const added = addedSince(base.files, local);
  return { ref, added, newest: added.at(-1) ?? null, unreachable: false, note };
}

/**
 * The latest migration that contains `begin` — where a generated block lives
 * today, whether or not it has shipped. `files` is Map<name, text>.
 */
export function holderOf(files, begin) {
  return [...files.keys()]
    .sort()
    .reverse()
    .find((name) => files.get(name).includes(begin));
}

export function readAll() {
  return new Map(localMigrations().map((name) => [name, readLocal(name).toString('utf8')]));
}

/** `NNNN_name.sql` after everything here and on the base. */
export function nextName(slug, names) {
  const top = Math.max(0, ...names.map((name) => versionOf(name) ?? 0));
  return `${String(top + 1).padStart(4, '0')}_${slug}.sql`;
}

/** `pnpm gen:migration <name>`: a numbered, empty migration for the generators to find. */
export function createMigration(rawName) {
  const slug = String(rawName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (slug === '') {
    console.error('gen:migration: give it a name, e.g. `pnpm gen:migration plan_reminders`.');
    process.exit(2);
  }
  refreshBase();
  const base = readBase();
  const names = [...localMigrations(), ...(base.files ? base.files.keys() : [])];
  const added = base.files ? localMigrations().filter((name) => !base.files.has(name)) : [];
  const name = nextName(slug, names);
  writeFileSync(
    join(MIGRATIONS, name),
    `-- ${name.replace(/\.sql$/, '')}\n--\n-- What this changes, and why, in a sentence or two.\n`,
    { flag: 'wx' },
  );
  console.log(`gen:migration: created ${REL}/${name}`);
  if (added.length > 0) {
    console.log(
      `note: ${added.join(', ')} ${added.length === 1 ? 'is' : 'are'} already new on this branch. ` +
        'A branch adds one migration; the generators write into the highest-numbered new one.',
    );
  }
  if (base.error) {
    console.log(`note: could not read ${base.ref} (${base.error}); numbered from the files here.`);
  }
}

/**
 * Pick the file a generator writes into, or say why it will not. Called only
 * when there is something to write (a generator whose output already matches
 * is a no-op and never gets here).
 *
 *   gen        the generator's name, for messages
 *   files      Map<name, text> of the migrations here
 *   begin      the opening marker of this generator's block
 *   holder     the latest migration that holds the block today
 *   template   what a new migration must contain for the block to live in it
 *              (null when the generator can add the block itself)
 *
 * Returns the file name. Exits 1 with the instruction when there is no new
 * migration, and 2 when the new one cannot take the block.
 */
export function resolveWriteTarget({ gen, files, begin, holder, template }) {
  const found = findTarget();
  if (found.note) console.warn(`${gen}: ${found.note}`);
  if (found.unreachable) {
    console.warn(
      `${gen}: cannot read ${found.ref} (${found.note.split('\n')[0]}), so I cannot tell which ` +
        `migration is new. Falling back to ${holder}, the latest that holds this block. ` +
        'If that one has shipped, do not keep this change: add a migration and run this again online.',
    );
    return holder;
  }
  if (found.newest === null) {
    console.error(
      `${gen}: the output has changed, and there is no migration on this branch that is not on ${found.ref} ` +
        `to carry it. Every migration here has shipped, so writing into ${holder} would edit an applied ` +
        'one.\nAdd one with `pnpm gen:migration <name>`, then run this again.',
    );
    process.exit(1);
  }
  const text = files.get(found.newest);
  if (!text.includes(begin) && template !== null) {
    console.error(
      `${gen}: ${found.newest} is this branch's new migration, but it does not contain this block, ` +
        `and ${holder} has shipped.\nAdd this where the change belongs in ${found.newest}, then ` +
        `run this again:\n\n${template}\n`,
    );
    process.exit(2);
  }
  return found.newest;
}
