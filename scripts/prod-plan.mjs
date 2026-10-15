#!/usr/bin/env node
/**
 * Writes what a production deploy is about to change into the run summary, so a
 * reviewer can read it before approving (SUS-105).
 *
 *   node scripts/prod-plan.mjs --repo owner/name --sha <sha> [--rollback <tag> --head <sha>]
 *
 * The exact plan is `supabase db push --dry-run`, and it needs the production
 * access token, which is a secret of the `production` environment: a job that
 * can read it has already been approved. So this is the plan the repository can
 * give without it. It finds the commit production was last deployed from (the
 * most recent `production` deployment whose status is `success`) and lists the
 * migrations and Edge Functions that differ between that commit and this one.
 * A rollback deploys a tag's commit, but GitHub records the commit the workflow
 * was dispatched on; the `tag` job therefore adds a status to that deployment
 * whose description names the commit actually deployed (SUS-212,
 * scripts/record-deployed.mjs), and that commit is the baseline for code.
 * The dry run itself still runs, in the approved job, and prints the CLI's own
 * list.
 *
 * It runs from a full clone (`fetch-depth: 0`) with `GH_TOKEN` set, and only
 * reads: git history and the deployments API.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** `git diff --name-status` lines for `supabase/migrations` as `[status, file]`. */
export function parseNameStatus(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split(/\s+/);
      return [status[0], rest[rest.length - 1]];
    });
}

/**
 * The CLI applies a migration file statement by statement unless the file opens
 * its own transaction. `0025` and `0027` do not, and one that fails halfway
 * stays half applied (docs/runbooks/release-slice-2.md).
 */
export function isTransactional(sql) {
  return /^\s*begin\s*;/im.test(sql) && /^\s*commit\s*;/im.test(sql);
}

/** The Edge Function directories among changed `supabase/functions/...` paths. */
export function changedFunctions(paths) {
  const names = new Set();
  for (const path of paths) {
    const m = /^supabase\/functions\/([^/_][^/]*)\//.exec(path);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * Paths every function bundle is built from: `_shared`, the import map, the
 * workspace packages and the lockfile (AGENTS.md, "Edge runtime"). A change to
 * one redeploys all of them, so the plan says that instead of listing none.
 */
export function sharedChanged(paths) {
  return paths.filter((path) =>
    /^(supabase\/functions\/(_[^/]+\/|import_map\.json$|deno\.)|packages\/|pnpm-lock\.yaml$)/.test(
      path,
    ),
  );
}

export function render({ base, schemaBase, sha, migrations, functions, shared = [], note }) {
  const lines = ['### Production plan: what this deploy changes', ''];
  lines.push(
    base
      ? `Production was last deployed from \`${base}\`. This deploys \`${sha}\`.`
      : `No earlier successful production deployment was found, so every migration is listed. This deploys \`${sha}\`.`,
  );
  if (base && schemaBase !== undefined && schemaBase !== base) {
    lines.push(
      '',
      schemaBase
        ? `Production's code was rolled back to \`${base}\`. Functions are listed from there; migrations from \`${schemaBase}\`, the last forward deployment, because a rollback applies none.`
        : `Production's code was rolled back to \`${base}\`. Functions are listed from there; no earlier forward deployment was found, so every migration is listed.`,
    );
  }
  if (note) lines.push('', note);
  lines.push('', `**Migrations to apply: ${migrations.length}**`, '');
  if (migrations.length === 0) {
    lines.push('None.');
  } else {
    lines.push('| Migration | Change | Transaction |', '|---|---|---|');
    for (const m of migrations) {
      lines.push(
        `| \`${m.file}\` | ${m.status} | ${m.transactional ? 'begin … commit' : '**none: applied statement by statement; a failure leaves it half applied**'} |`,
      );
    }
  }
  if (shared.length > 0) {
    lines.push(
      '',
      `**Shared code changed, so every Edge Function is redeployed** (${shared.length} file(s), e.g. \`${shared[0]}\`).`,
    );
  }
  lines.push('', `**Edge Functions with their own changes: ${functions.length}**`, '');
  lines.push(functions.length === 0 ? 'None.' : functions.map((f) => `- \`${f}\``).join('\n'));
  lines.push(
    '',
    "This list comes from git, not from the production database. `supabase db push --dry-run` runs first in the approved job and prints the CLI's own list.",
  );
  return lines.join('\n');
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' });

/** The description the `tag` job gives a rollback's deployment: `deployed:<40 hex>`. */
export const RECORDED = /^deployed:([0-9a-f]{40})$/;

/** Who writes the `deployed:` status: the `tag` job's own token. */
export const RECORDER = 'github-actions[bot]';

/**
 * Production's baselines from its deployments, newest first, each
 * `{ sha, state, recorded }`: `state` is the latest status's, `recorded` the
 * commit a `deployed:` status from {@link RECORDER} names, if any.
 *
 * `code` is what is actually live: the newest successful deployment's recorded
 * commit when a rollback wrote one, else the commit it was dispatched on.
 * `schema` is the newest successful deployment that was not a rollback, because
 * only those apply migrations; a rollback's dispatched commit never migrated.
 * `inactive` counts as successful: GitHub only marks a deployment inactive
 * after it succeeded, when a later one replaced it.
 */
export function pickBaselines(rows) {
  const ok = rows.filter((r) => r.state === 'success' || r.state === 'inactive');
  if (ok.length === 0) return { code: null, schema: null };
  return {
    code: ok[0].recorded ?? ok[0].sha,
    schema: ok.find((r) => !r.recorded)?.sha ?? null,
  };
}

/** A deployment's row from its statuses, newest first. */
export function rowOf(sha, statuses) {
  const recorded = statuses
    .filter((s) => s.state === 'success' && s.creator?.login === RECORDER)
    .map((s) => RECORDED.exec(s.description ?? '')?.[1])
    .find(Boolean);
  return { sha, state: statuses[0]?.state ?? '', recorded: recorded ?? null };
}

function deploymentRows(repo) {
  const deployments = JSON.parse(
    gh('api', `repos/${repo}/deployments?environment=production&per_page=100`),
  );
  return deployments.map((d) =>
    rowOf(d.sha, JSON.parse(gh('api', `repos/${repo}/deployments/${d.id}/statuses?per_page=20`))),
  );
}

function lastDeployed(repo) {
  return pickBaselines(deploymentRows(repo));
}

/** Keeps a baseline only if it is an ancestor of `sha` in this clone. */
function ancestorOnly(deployed, sha) {
  if (!deployed) return { base: null, note: null };
  try {
    git('merge-base', '--is-ancestor', deployed, sha);
    return { base: deployed, note: null };
  } catch {
    return {
      base: null,
      note: `Production's last deployment (\`${deployed}\`) is not an ancestor of this commit, or is not in the clone. Listing every migration instead.`,
    };
  }
}

/**
 * What differs between production and `sha`: `migrations` are `[status, file]`
 * since `schemaBase`, `changed` is every path under the function sources since
 * `base`. A null base lists everything in `sha`.
 */
export function forwardDiff({ base, schemaBase, sha, run = git }) {
  const migrations = schemaBase
    ? parseNameStatus(run('diff', '--name-status', schemaBase, sha, '--', 'supabase/migrations'))
    : run('ls-tree', '--name-only', sha, 'supabase/migrations/')
        .split('\n')
        .filter(Boolean)
        .map((f) => ['A', f]);
  const changed = base
    ? run(
        'diff',
        '--name-only',
        base,
        sha,
        '--',
        'supabase/functions',
        'packages',
        'pnpm-lock.yaml',
      ).split('\n')
    : run('ls-tree', '-r', '--name-only', sha, 'supabase/functions/').split('\n');
  return { migrations, changed };
}

/**
 * A rollback redeploys older code and applies no migration. What matters to the
 * person approving is the migrations the database has that this code has never
 * seen, and whether the code can live with them.
 *
 * Two lists, because "what production has applied" is not known from outside:
 * `applied` is what the last *successful* deployment carried; `possible` is
 * everything after that up to the dispatched commit, which a deployment that
 * applied its migrations and then failed (the web deploy, the smoke test) may
 * also have run. Treating the second as empty would be a claim of safety that
 * nothing supports, so it is listed, and the dry run is the way to tell.
 */
export function renderRollback({ tag, sha, base, applied, possible = [], note }) {
  const lines = ['### Rollback plan: what this redeploys', ''];
  lines.push(
    `Redeploys \`${tag}\` (\`${sha}\`): its Edge Functions (all of them) and its web build.`,
    base
      ? `The last successful production deployment recorded \`${base}\`.`
      : 'No earlier successful production deployment was found.',
  );
  if (note) lines.push('', note);
  lines.push('', '**No migration is applied or undone.** Migrations are forward-only.', '');
  lines.push(`**Migrations the database has that this code predates: ${applied.length}**`, '');
  lines.push(applied.length === 0 ? 'None.' : applied.map((f) => `- \`${f}\``).join('\n'));
  lines.push(
    '',
    `**Migrations that a failed or half-finished deployment may also have applied: ${possible.length}**`,
    '',
    possible.length === 0
      ? 'None between the last successful deployment and the dispatched commit.'
      : possible.map((f) => `- \`${f}\``).join('\n'),
  );
  if (applied.length + possible.length > 0) {
    lines.push(
      '',
      'The old code will run against a schema with the first list, and possibly the second. Approve only if each is additive (a new column or table, a new function) or the old code does not touch what it changed. A renamed or dropped column, or a tightened constraint, is not safe to roll back over. Anything in the second list that production does not have yet will simply not be applied.',
    );
  }
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) =>
    argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined;
  const repo = opt('repo');
  const sha = opt('sha');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
    console.error('prod-plan: --repo owner/name and a full 40-character --sha are required');
    process.exit(2);
  }

  const rollbackTag = opt('rollback');
  if (rollbackTag) {
    const head = opt('head');
    if (!/^[0-9a-f]{40}$/.test(head ?? '')) {
      console.error(
        'prod-plan: --rollback needs the dispatched commit as a full 40-character --head',
      );
      process.exit(2);
    }
    // Migrations never roll back, so the schema baseline is the last forward deploy.
    const base = lastDeployed(repo).schema;
    const migrationsBetween = (from, to) =>
      parseNameStatus(git('diff', '--name-status', from, to, '--', 'supabase/migrations'))
        .filter(([, file]) => file.endsWith('.sql'))
        .map(([, file]) => file.replace(/^supabase\/migrations\//, ''));
    const applied = base ? migrationsBetween(sha, base) : migrationsBetween(sha, head);
    const possible = base ? migrationsBetween(base, head).filter((f) => !applied.includes(f)) : [];
    const out = renderRollback({
      tag: rollbackTag,
      sha,
      base,
      applied,
      possible,
      note: base
        ? null
        : 'Everything between the tag and the dispatched commit is listed as applied, because nothing says otherwise.',
    });
    console.log(out);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out}\n`);
    return;
  }

  const deployed = lastDeployed(repo);
  const code = ancestorOnly(deployed.code, sha);
  const schema = deployed.schema === deployed.code ? code : ancestorOnly(deployed.schema, sha);
  const { base } = code;
  const { migrations, changed } = forwardDiff({ base, schemaBase: schema.base, sha });
  const functions = changedFunctions(changed);
  const note = [code.note, schema.note !== code.note ? schema.note : null]
    .filter(Boolean)
    .join('\n\n');

  const rows = migrations
    .filter(([, file]) => file.endsWith('.sql'))
    .map(([status, file]) => ({
      file: file.replace(/^supabase\/migrations\//, ''),
      status: { A: 'new', M: '**edited after it was applied**', D: 'deleted' }[status] ?? status,
      transactional: status === 'D' ? true : isTransactional(readFileSync(file, 'utf8')),
    }));

  const out = render({
    base,
    schemaBase: schema.base,
    sha,
    migrations: rows,
    functions,
    shared: base ? sharedChanged(changed) : [],
    note: note || null,
  });
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`prod-plan: ${error?.message ?? error}`);
    process.exit(1);
  }
}
