#!/usr/bin/env node
/**
 * Writes what a production deploy is about to change into the run summary, so a
 * reviewer can read it before approving (SUS-105).
 *
 *   node scripts/prod-plan.mjs --repo owner/name --sha <sha>
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
    const m = /^supabase\/functions\/([^/]+)\//.exec(path);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

export function render({ base, sha, migrations, functions, note }) {
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
  lines.push('', `**Edge Functions touched: ${functions.length}**`, '');
  lines.push(functions.length === 0 ? 'None.' : functions.map((f) => `- \`${f}\``).join('\n'));
  lines.push(
    '',
    "This list comes from git, not from the production database. `supabase db push --dry-run` runs first in the approved job and prints the CLI's own list.",
  );
  return lines.join('\n');
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' });

function lastDeployedSha(repo, sha) {
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
    if (state !== 'success' || deployed === sha) continue;
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
  return { base: null, note: null };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => argv[argv.indexOf(`--${name}`) + 1];
  const repo = opt('repo');
  const sha = opt('sha');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
    console.error('prod-plan: --repo owner/name and a full 40-character --sha are required');
    process.exit(2);
  }

  const { base, note } = lastDeployedSha(repo, sha);
  let migrations;
  let functions;
  if (base) {
    migrations = parseNameStatus(
      git('diff', '--name-status', base, sha, '--', 'supabase/migrations'),
    );
    functions = changedFunctions(
      git('diff', '--name-only', base, sha, '--', 'supabase/functions').split('\n'),
    );
  } else {
    migrations = git('ls-tree', '--name-only', sha, 'supabase/migrations/')
      .split('\n')
      .filter(Boolean)
      .map((f) => ['A', f]);
    functions = changedFunctions(
      git('ls-tree', '-r', '--name-only', sha, 'supabase/functions/').split('\n'),
    );
  }

  const rows = migrations
    .filter(([, file]) => file.endsWith('.sql'))
    .map(([status, file]) => ({
      file: file.replace(/^supabase\/migrations\//, ''),
      status: { A: 'new', M: '**edited after it was applied**', D: 'deleted' }[status] ?? status,
      transactional: status === 'D' ? true : isTransactional(readFileSync(file, 'utf8')),
    }));

  const out = render({ base, sha, migrations: rows, functions, note });
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
