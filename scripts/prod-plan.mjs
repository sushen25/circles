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

export function render({ base, sha, migrations, functions, shared = [], note }) {
  const lines = ['### Production plan: what this deploy changes', ''];
  lines.push(
    base
      ? `Production was last deployed from \`${base}\`. This deploys \`${sha}\`.`
      : `No earlier successful production deployment was found, so every migration is listed. This deploys \`${sha}\`.`,
  );
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

function lastDeployed(repo) {
  const rows = gh(
    'api',
    `repos/${repo}/deployments?environment=production&per_page=30`,
    '--jq',
    '.[] | "\\(.id) \\(.sha)"',
  )
    .split('\n')
    .filter(Boolean);
  for (const row of rows) {
    const [id, deployed] = row.split(' ');
    const state = gh(
      'api',
      `repos/${repo}/deployments/${id}/statuses?per_page=1`,
      '--jq',
      '.[0].state // ""',
    ).trim();
    if (state === 'success') return deployed;
  }
  return null;
}

function lastDeployedSha(repo, sha) {
  const deployed = lastDeployed(repo);
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
    const base = lastDeployed(repo);
    const migrationsBetween = (from, to) =>
      parseNameStatus(git('diff', '--name-status', from, to, '--', 'supabase/migrations'))
        .filter(([, file]) => file.endsWith('.sql'))
        .map(([, file]) => file.replace(/^supabase\/migrations\//, ''));
    // The deployments API records the dispatched commit, not the one a rollback
    // deployed. For the schema that is the right base: migrations never roll back.
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

  const { base, note } = lastDeployedSha(repo, sha);
  let migrations;
  let functions;
  let changed;
  if (base) {
    migrations = parseNameStatus(
      git('diff', '--name-status', base, sha, '--', 'supabase/migrations'),
    );
    changed = git(
      'diff',
      '--name-only',
      base,
      sha,
      '--',
      'supabase/functions',
      'packages',
      'pnpm-lock.yaml',
    ).split('\n');
    functions = changedFunctions(changed);
  } else {
    migrations = git('ls-tree', '--name-only', sha, 'supabase/migrations/')
      .split('\n')
      .filter(Boolean)
      .map((f) => ['A', f]);
    changed = git('ls-tree', '-r', '--name-only', sha, 'supabase/functions/').split('\n');
    functions = changedFunctions(changed);
  }

  const rows = migrations
    .filter(([, file]) => file.endsWith('.sql'))
    .map(([status, file]) => ({
      file: file.replace(/^supabase\/migrations\//, ''),
      status: { A: 'new', M: '**edited after it was applied**', D: 'deleted' }[status] ?? status,
      transactional: status === 'D' ? true : isTransactional(readFileSync(file, 'utf8')),
    }));

  const out = render({
    base,
    sha,
    migrations: rows,
    functions,
    shared: base ? sharedChanged(changed) : [],
    note,
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
