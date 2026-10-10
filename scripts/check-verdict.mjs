#!/usr/bin/env node
/**
 * The one verdict named `check` (SUS-179).
 *
 *   NEEDS='<toJSON(needs)>' node scripts/check-verdict.mjs
 *
 * `check.yml` is several jobs that run side by side (scope, static, database,
 * live), and `deploy-dev`, `deploy-prod` (`scripts/green-check.mjs`) and the
 * branch protection on `main` all ask one question of a commit: is its `check`
 * green? The last job of the workflow is named `check`, `needs` all of the
 * others and runs `if: always()`, and this decides what it reports. Green means
 * every suite job succeeded: not "none of them failed". A job that was
 * cancelled, timed out, was skipped or never appears is not a success, because
 * a skipped job is what GitHub reports for a job whose dependency failed, and
 * a required check that is skipped counts as passing.
 *
 * The one skip that is right: a change to Markdown only (`scripts/ci-scope.mjs`
 * says `prose`) runs the static job and nothing else, so `database` and `live`
 * are skipped on purpose.
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Every job `check` stands for. A job missing from `needs` is a failure, not a pass. */
export const SUITE_JOBS = ['scope', 'static', 'database', 'live'];
/** The jobs a prose-only change skips on purpose. */
export const SKIPPED_FOR_PROSE = ['database', 'live'];

/**
 * @param {Record<string, {result?: string, outputs?: Record<string, string>}> | null | undefined} needs
 * @returns {{ok: boolean, kind: string, rows: Array<{job: string, result: string, fine: boolean, why: string}>}}
 */
export function judgeNeeds(needs) {
  const kind = needs?.scope?.outputs?.kind ?? 'unknown';
  const rows = SUITE_JOBS.map((job) => {
    const result = needs?.[job]?.result ?? 'missing';
    if (result === 'success') return { job, result, fine: true, why: '' };
    if (result === 'skipped' && kind === 'prose' && SKIPPED_FOR_PROSE.includes(job)) {
      return { job, result, fine: true, why: 'skipped on purpose: only Markdown changed' };
    }
    return { job, result, fine: false, why: `\`${job}\` did not succeed` };
  });
  // Anything else in `needs` is judged the same way, so a job added to the
  // workflow and to `needs` but not to the list above cannot slip through.
  for (const job of Object.keys(needs ?? {})) {
    if (SUITE_JOBS.includes(job)) continue;
    const result = needs[job]?.result ?? 'missing';
    rows.push({
      job,
      result,
      fine: result === 'success',
      why: result === 'success' ? '' : `\`${job}\` did not succeed`,
    });
  }
  return { ok: rows.every((r) => r.fine), kind, rows };
}

function main() {
  let needs;
  try {
    needs = JSON.parse(process.env.NEEDS ?? '');
  } catch {
    console.error('check-verdict: NEEDS is not JSON, so there is nothing to judge: failing');
    process.exit(1);
  }
  const verdict = judgeNeeds(needs);
  const lines = [
    `### check: ${verdict.ok ? 'green' : 'RED'} (${verdict.kind} change)`,
    '',
    '| Job | Result | |',
    '| --- | --- | --- |',
    ...verdict.rows.map((r) => `| ${r.job} | ${r.result} | ${r.why} |`),
  ];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
  process.exit(verdict.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
