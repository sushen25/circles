#!/usr/bin/env node
/**
 * Refuses a commit whose `check` run is not a success (SUS-105).
 *
 *   node scripts/green-check.mjs --repo owner/name --sha <sha> [--wait <seconds>] [--grace <seconds>]
 *
 * Reads the `check` job's run for the commit through the checks API
 * (`GH_TOKEN` or `GITHUB_TOKEN` in the environment, `gh` on the PATH) and
 * decides from the latest one. "Not green" is everything that is not a
 * completed `success`: no run at all, queued, in progress, cancelled, timed
 * out, skipped, neutral and failure. Production deployed three commits in a row
 * on 3, 5 and 9 October that a check refusing only `failure` would have let
 * through, because two of the three were cancelled or still running.
 *
 * Without `--wait` the answer is immediate. `deploy-prod` uses that: a person
 * dispatches it, and "still running" is a reason to try again later. `deploy-dev`
 * uses `--wait`, because it starts in the same second as the `check` for the
 * same push: it polls while the run is queued or in progress, and gives a commit
 * with no run at all `--grace` seconds to get one before it counts as none.
 * A run that has finished and is not a success never waits.
 *
 * Only runs named `check` that GitHub Actions itself created count. Any app can
 * create a check run with any name, and a gate that believed one named `check`
 * would be one an app can satisfy.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CHECK_NAME = 'check';

/**
 * @param {Array<{name?: string, status?: string, conclusion?: string | null, started_at?: string | null, id?: number, app?: {slug?: string} | null}>} runs
 * @returns {{state: 'green' | 'pending' | 'none' | 'red', message: string}}
 *   `pending` can become green by waiting; `none` might (the run may not have
 *   been created yet); `red` cannot.
 */
export function judge(runs) {
  const ours = (runs ?? []).filter(
    (r) => r?.name === CHECK_NAME && r?.app?.slug === 'github-actions',
  );
  if (ours.length === 0) {
    return { state: 'none', message: `no \`${CHECK_NAME}\` run exists for this commit` };
  }
  // A re-run creates a new check run for the same job. The latest one is the
  // verdict, so a cancelled run that was superseded by a green one does not
  // block, and a green one that was superseded by a red one does.
  const latest = [...ours].sort(
    (a, b) =>
      String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')) ||
      (b.id ?? 0) - (a.id ?? 0),
  )[0];
  if (latest.status !== 'completed') {
    return {
      state: 'pending',
      message: `the \`${CHECK_NAME}\` run is ${latest.status ?? 'in an unknown state'}, not finished`,
    };
  }
  if (latest.conclusion === 'success') {
    return { state: 'green', message: `the \`${CHECK_NAME}\` run succeeded` };
  }
  return {
    state: 'red',
    message: `the \`${CHECK_NAME}\` run finished as \`${latest.conclusion ?? 'unknown'}\`, not \`success\``,
  };
}

/** What to do after one look: `done` (pass), `fail`, or `retry`. */
export function decide(verdict, { waiting, noRunForSeconds, graceSeconds }) {
  if (verdict.state === 'green') return 'done';
  if (verdict.state === 'red') return 'fail';
  if (!waiting) return 'fail';
  if (verdict.state === 'none' && noRunForSeconds >= graceSeconds) return 'fail';
  return 'retry';
}

const args = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) {
      throw new Error(`unexpected argument ${argv[i]}`);
    }
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
};

const fetchRuns = (repo, sha) => {
  // `--jq` runs per page, so pagination needs no `--slurp` (a newer gh than
  // some runner images carry): one run per line.
  const body = execFileSync(
    'gh',
    [
      'api',
      '--paginate',
      `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
      '--jq',
      '.check_runs[]',
    ],
    { encoding: 'utf8' },
  );
  return body
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const summary = (text) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
};

async function main() {
  const { repo, sha, wait = '0', grace = '300' } = args(process.argv.slice(2));
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
    console.error('green-check: --repo owner/name and a full 40-character --sha are required');
    process.exit(2);
  }
  const waitSeconds = Number(wait);
  const graceSeconds = Number(grace);
  const waiting = waitSeconds > 0;
  const startedAt = Date.now();
  const POLL_MS = 30_000;

  for (;;) {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const verdict = judge(fetchRuns(repo, sha));
    const action = decide(verdict, {
      waiting,
      noRunForSeconds: elapsed,
      graceSeconds,
    });
    if (action === 'done') {
      console.log(`green-check: ${verdict.message} (${sha})`);
      summary(`### Check\n\n\`${sha}\`: ${verdict.message}.`);
      return;
    }
    if (action === 'fail' || elapsed >= waitSeconds) {
      console.error(`green-check: refusing ${sha}: ${verdict.message}`);
      summary(
        `### Check\n\n**Refused.** \`${sha}\`: ${verdict.message}. ` +
          'Only a commit whose `check` run succeeded is deployed; see docs/runbooks/ci.md.',
      );
      process.exit(1);
    }
    console.log(
      `green-check: ${verdict.message}; looking again in ${POLL_MS / 1000}s (${elapsed}s so far)`,
    );
    await sleep(POLL_MS);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`green-check: ${error?.message ?? error}`);
    process.exit(1);
  });
}
