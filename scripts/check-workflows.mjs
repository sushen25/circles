#!/usr/bin/env node
/**
 * Asserts that a workflow job installs dependencies before it uses them.
 *
 * Written because this went wrong twice in workflows nothing had ever run.
 * `deploy-prod` invoked `pnpm run build` and `pnpm exec supabase` before
 * `pnpm install`, and would have failed on its first production deploy — the
 * one run where a late failure costs the most.
 *
 * A workflow that has only ever skipped is unexecuted code (working-process
 * rule 2.13). CI cannot exercise the deploy paths on a pull request, so this is
 * the next best thing: a check that reads them.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// `yaml` is a transitive dependency rather than a direct one, so resolve it the
// way Node would from the workspace root rather than assuming a path.
const require = createRequire(import.meta.url);
let parse;
try {
  ({ parse } = require('yaml'));
} catch {
  console.error('check:workflows: the `yaml` package is not resolvable — run `pnpm install`');
  process.exit(1);
}

const DIRS = ['.github/workflows', '.eas/workflows'];
const USES_PNPM = /\bpnpm\s+(exec|run|--filter)\b/;
const INSTALLS = /\bpnpm\s+install\b/;

const problems = [];

for (const dir of DIRS) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    continue; // the directory is optional
  }

  for (const file of files) {
    const path = join(dir, file);
    let doc;
    try {
      doc = parse(readFileSync(path, 'utf8'));
    } catch (error) {
      problems.push(`${path}: not valid YAML — ${error?.message ?? error}`);
      continue;
    }

    for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      const run = (step) => (typeof step?.run === 'string' ? step.run : '');

      const installAt = steps.findIndex((s) => INSTALLS.test(run(s)));
      const firstUseAt = steps.findIndex((s) => USES_PNPM.test(run(s)));

      if (firstUseAt === -1) continue;

      if (installAt === -1) {
        problems.push(
          `${path} · ${jobName}: step ${firstUseAt + 1} uses pnpm, but the job never runs \`pnpm install\``,
        );
      } else if (installAt > firstUseAt) {
        problems.push(
          `${path} · ${jobName}: step ${firstUseAt + 1} uses pnpm before \`pnpm install\` at step ${installAt + 1}`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`check:workflows: ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nA job must install before it builds, deploys or runs the Supabase CLI.');
  process.exit(1);
}

console.log('check:workflows: every job installs before it uses pnpm');
