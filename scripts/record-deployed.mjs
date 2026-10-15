#!/usr/bin/env node
/**
 * Records which commit a rollback actually deployed (SUS-212).
 *
 *   node scripts/record-deployed.mjs --repo owner/name --head <sha> --deployed <sha> --rollback true|false --run <run id>
 *
 * GitHub's `production` deployment records the commit the workflow was
 * dispatched on. A rollback deploys an older tag's commit, so the next
 * `prod-plan.mjs` would take the dispatched commit as the baseline and
 * under-list what the next deploy changes. This adds one status to that
 * deployment, whose description is `deployed:<sha>`; `prod-plan.mjs` reads it
 * back. A normal deploy already deployed the dispatched commit, so there is
 * nothing to record. It runs in the `tag` job, after `apply` succeeded, so the
 * new status is the latest one.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { RECORDED } from './prod-plan.mjs';

/** The status description for a deployed commit, in the form `prod-plan.mjs` reads. */
export function descriptionFor(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('a full 40-character sha is required');
  const description = `deployed:${sha}`;
  if (!RECORDED.test(description)) throw new Error('description does not round-trip');
  return description;
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) =>
    argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined;
  const repo = opt('repo');
  const head = opt('head');
  const deployed = opt('deployed');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[0-9a-f]{40}$/.test(head ?? '')) {
    throw new Error('--repo owner/name and a full 40-character --head are required');
  }
  if (opt('rollback') !== 'true') {
    console.log('Not a rollback: the deployment already names the commit that was deployed.');
    return;
  }
  const run = opt('run');
  if (!/^\d+$/.test(run ?? '')) throw new Error('--run <this workflow run id> is required');
  const description = descriptionFor(deployed);
  const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' });
  const id = deploymentOfRun({ repo, head, run, gh });
  if (!id) throw new Error(`no production deployment of ${head} belongs to run ${run}`);
  // `auto_inactive=false`: by default a new success status marks every earlier
  // deployment in the environment inactive, which would hide the last forward
  // deploy that `prod-plan.mjs` takes as the schema baseline.
  gh(
    'api',
    '-X',
    'POST',
    `repos/${repo}/deployments/${id}/statuses`,
    '-f',
    'state=success',
    '-f',
    `description=${description}`,
    '-F',
    'auto_inactive=false',
  );
  console.log(`Recorded ${description} on deployment ${id}.`);
}

/**
 * The production deployment of `head` that this workflow run created. Actions
 * puts the run id in each status's `log_url`, so a re-run of an old `tag` job
 * after a later deploy of the same commit still finds its own deployment.
 */
export function deploymentOfRun({ repo, head, run, gh }) {
  const ids = JSON.parse(
    gh(
      'api',
      `repos/${repo}/deployments?environment=production&sha=${head}&per_page=20`,
      '--jq',
      '[.[].id]',
    ),
  );
  for (const id of ids) {
    const urls = JSON.parse(
      gh(
        'api',
        `repos/${repo}/deployments/${id}/statuses?per_page=100`,
        '--jq',
        '[.[] | (.log_url // ""), (.target_url // "")]',
      ),
    );
    if (urls.some((u) => u.includes(`/actions/runs/${run}/`) || u.endsWith(`/actions/runs/${run}`)))
      return id;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`record-deployed: ${error?.message ?? error}`);
    process.exit(1);
  }
}
