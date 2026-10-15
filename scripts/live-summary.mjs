#!/usr/bin/env node
/**
 * The live suite's size and time, for the job summary (SUS-179).
 *
 *   node scripts/live-summary.mjs playwright-report/live-results.json "1/2"
 *
 * The live step was 3.4 minutes at 100 runs and 15.6 at 556 before anyone saw
 * it growing. Writing the run count and the duration on every run is how the
 * next creep is seen: the number is on the run's page, and the median is in
 * `docs/runbooks/ci.md`.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Every test result under a Playwright JSON report's suites, with its project and its spec's name. */
export function testsIn(suites, out = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        out.push({ ...test, title: test.title ?? spec.title, file: spec.file ?? suite.file });
      }
    }
    testsIn(suite.suites, out);
  }
  return out;
}

export function summarise(report) {
  const tests = testsIn(report?.suites);
  const byProject = new Map();
  for (const t of tests) {
    const name = t.projectName ?? 'unknown';
    const row = byProject.get(name) ?? { runs: 0, skipped: 0 };
    row.runs += 1;
    if (t.status === 'skipped') row.skipped += 1;
    byProject.set(name, row);
  }
  // Retried and then passed: the run is green and a flake is hiding in it.
  // Retries exist to survive a bad minute, not to hide a test that fails one
  // time in ten, so each is named here, where the next person reads the run.
  const flakyTests = tests
    .filter((t) => t.status === 'flaky')
    .map(
      (t) =>
        `${t.projectName ?? 'unknown'}: ${t.file ? `${t.file} › ` : ''}${t.title ?? '(untitled)'}`,
    )
    .sort();
  const stats = report?.stats ?? {};
  return {
    runs: tests.length,
    passed: stats.expected ?? 0,
    failed: stats.unexpected ?? 0,
    flaky: stats.flaky ?? 0,
    skipped: stats.skipped ?? 0,
    seconds: Math.round((stats.duration ?? 0) / 1000),
    flakyTests,
    byProject: [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
}

export function markdown(s, shard, suite = 'Live suite') {
  const minutes = (s.seconds / 60).toFixed(1);
  return [
    `### ${suite}${shard ? `, shard ${shard}` : ''}: ${s.runs} runs in ${minutes} min`,
    '',
    `${s.passed} passed, ${s.failed} failed, ${s.flaky} flaky (passed on retry), ${s.skipped} skipped.`,
    '',
    ...(s.flakyTests.length
      ? [
          `**${s.flakyTests.length} passed only on a retry** (a flake the green run would otherwise hide):`,
          '',
          ...s.flakyTests.map((name) => `- ${name}`),
          '',
        ]
      : []),
    '| Project | Runs | Skipped by the spec |',
    '| --- | --- | --- |',
    ...s.byProject.map(([name, r]) => `| ${name} | ${r.runs} | ${r.skipped} |`),
    '',
  ].join('\n');
}

function main() {
  // The suite's name is the third argument, for the smoke suite's use; the
  // shard may be empty (`""`) where there is none.
  const [file, shard, suite] = process.argv.slice(2);
  let report;
  try {
    report = JSON.parse(readFileSync(file ?? '', 'utf8'));
  } catch {
    // The run died before it wrote a report (a timeout, a stack that never
    // started). The job already failed; the summary says why there is no table.
    console.log('live-summary: no report was written, so there is nothing to summarise');
    return;
  }
  const summary = summarise(report);
  const text = markdown(summary, shard, suite || undefined);
  console.log(text);
  // A warning on the run, so a flake is on the pull request and not only in a
  // summary nobody opens.
  for (const name of summary.flakyTests) console.log(`::warning title=Flaky test::${name}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
