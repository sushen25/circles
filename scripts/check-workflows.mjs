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
 *
 * It also holds the line between the two sets of deploy credentials (SUS-104).
 * The production ones are secrets of the `production` environment, which only a
 * job that has passed its required reviewer can read, so:
 *
 * - a production-only name is read only by a job in the `production`
 *   environment. Anywhere else it is either empty or, if somebody has put it
 *   back at repository scope, exactly the leak this exists to stop;
 * - a `production` job never reads the dev names. GitHub resolves a missing
 *   environment secret to the repository secret of the same name, so that
 *   would deploy production with whatever token previews hold.
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

/**
 * Any pnpm invocation at all, then the ones that are themselves the install.
 *
 * An earlier version listed the forms it knew — `exec`, `run`, `--filter` — and
 * so did not recognise `pnpm check`, which is the single most important step in
 * `check.yml`. A checker that enumerates what it expects will miss whatever it
 * did not think of; enumerate the exception instead.
 */
const ANY_PNPM = /\bpnpm\b/;
const IS_INSTALL = /\bpnpm\s+(install|add|remove|update|import|dlx)\b/;

const PROD_ONLY = ['SUPABASE_PROD_ACCESS_TOKEN', 'SUPABASE_PROD_PROJECT_REF', 'EXPO_PROD_TOKEN'];
const DEV_TOKENS = ['SUPABASE_ACCESS_TOKEN', 'EXPO_TOKEN'];

/** Every `secrets.NAME` the value mentions, however deeply it is nested. */
const secretsIn = (value) =>
  new Set(
    [...JSON.stringify(value ?? null).matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]),
  );

/** `environment: production` and `environment: { name: production }` both count. */
const environmentOf = (job) =>
  typeof job?.environment === 'string' ? job.environment : job?.environment?.name;

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

      // A workflow-level `env` reaches every job, so it counts as the job's own.
      const secrets = secretsIn([doc?.env, job]);
      const production = environmentOf(job) === 'production';
      for (const name of PROD_ONLY) {
        if (secrets.has(name) && !production) {
          problems.push(
            `${path} · ${jobName}: reads \`${name}\`, which only a job in the \`production\` environment may read`,
          );
        }
      }
      for (const name of DEV_TOKENS) {
        if (secrets.has(name) && production) {
          problems.push(
            `${path} · ${jobName}: a \`production\` job reads \`${name}\`, the dev and preview token; use its production name`,
          );
        }
      }

      // Flattened to lines in order, so a step that installs and then uses pnpm
      // in the same script is judged on the order within it rather than treated
      // as doing both at once.
      const lines = steps.flatMap((step, index) =>
        (typeof step?.run === 'string' ? step.run.split('\n') : []).map((text) => ({
          text,
          step: index + 1,
        })),
      );

      const installAt = lines.findIndex((l) => IS_INSTALL.test(l.text));
      const firstUseAt = lines.findIndex((l) => ANY_PNPM.test(l.text) && !IS_INSTALL.test(l.text));

      if (firstUseAt === -1) continue;
      const use = lines[firstUseAt];

      if (installAt === -1) {
        problems.push(
          `${path} · ${jobName}: step ${use.step} runs \`${use.text.trim()}\`, but the job never installs`,
        );
      } else if (installAt > firstUseAt) {
        problems.push(
          `${path} · ${jobName}: step ${use.step} runs \`${use.text.trim()}\` before the install at step ${lines[installAt].step}`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`check:workflows: ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\nA job must install before it builds, deploys or runs the Supabase CLI, and production credentials stay in production jobs (docs/runbooks/ci.md).',
  );
  process.exit(1);
}

console.log(
  'check:workflows: every job installs before it uses pnpm, and only production jobs read production credentials',
);
