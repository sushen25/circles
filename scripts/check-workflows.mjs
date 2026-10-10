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
 *
 * And it holds the shape SUS-105 gave the deploys, because each piece is a line
 * somebody can delete without any test failing (see `ciRules`):
 *
 * - `deploy-prod` has a `plan` job outside any environment that runs the
 *   green-check and the migration plan, and every `production` job needs it, so
 *   the approval prompt comes after a readable plan and a green commit;
 * - nothing in a `production` job is skipped or allowed to fail quietly;
 * - `deploy-prod` deploys the commit `plan` resolved (the dispatched one, or a
 *   rollback's tag), and the green-check and the plan judge that same commit
 *   (SUS-144);
 * - a rollback skips the migrations inside the script, not with an `if`, and
 *   the run ends with the smoke test of the live site, after the web deploy;
 * - the release is tagged by one job that needs every production job, holds the
 *   only `contents: write` and reads no secret;
 * - `deploy-dev` waits for the commit's `check` before it deploys;
 * - `check` never cancels a run on `main`;
 * - `check.yml` is several jobs and one verdict (SUS-179): the job named
 *   `check` needs all the others, runs `if: always()` and judges them with
 *   `scripts/check-verdict.mjs`; the jobs run exactly the parts `pnpm check`
 *   is made of (no more, no fewer); the live suite's shards cover the whole
 *   suite. The commit's `check` is what `scripts/green-check.mjs`, the branch
 *   protection and `deploy-dev` read, so a unit-test job that went green under
 *   that name while the live suite was red would deploy a broken commit.
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

/**
 * Every expression in a parsed YAML value: each `${{ … }}`, and every `if:`,
 * which is an expression without the braces. Prose in a `run:` script that
 * happens to say "secrets" is neither.
 */
const expressionsIn = (value, key) => {
  if (typeof value === 'string') {
    return key === 'if' ? [value] : [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => expressionsIn(v, k));
  }
  return [];
};

/**
 * Every secret the value reads, upper-cased, because GitHub matches names
 * without regard to case. `secrets.NAME`, `secrets['NAME']` and
 * `secrets["NAME"]` are resolved. Any other use of `secrets` — an index computed
 * from `env`, `toJSON(secrets)`, `secrets.*` — cannot be, and is reported as
 * `?`: enumerating the readable forms and ignoring the rest would be the
 * checker this file warns against above.
 */
const secretsIn = (value) => {
  const found = new Set();
  for (const text of expressionsIn(value)) {
    for (const m of text.matchAll(
      /\bsecrets\b(\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*[.[(])|\s*\[\s*(['"])([A-Za-z0-9_]+)\3\s*\])?/gi,
    )) {
      found.add(m[1] === undefined ? '?' : (m[2] ?? m[4]).toUpperCase());
    }
  }
  return found;
};

/** `environment: production` and `environment: { name: production }` both count. */
const environmentOf = (job) =>
  typeof job?.environment === 'string' ? job.environment : job?.environment?.name;

const problems = [];

/** The job names a job `needs`, however it is written. */
const needsOf = (job) => [job?.needs ?? []].flat();

/** Every `run:` line of a job, joined. */
const runText = (job) =>
  (Array.isArray(job?.steps) ? job.steps : [])
    .map((step) => (typeof step?.run === 'string' ? step.run : ''))
    .join('\n');

/** Jobs reached from `name` through `needs`, `name` included. */
const needsClosure = (jobs, name, seen = new Set()) => {
  if (seen.has(name)) return seen;
  seen.add(name);
  for (const dep of needsOf(jobs[name])) needsClosure(jobs, dep, seen);
  return seen;
};

/**
 * A step that has to run, or the job has to fail: no `if`, no
 * `continue-on-error`, on the step or on its job.
 */
const unconditional = (job, step) =>
  step.if === undefined &&
  job.if === undefined &&
  step['continue-on-error'] === undefined &&
  job['continue-on-error'] === undefined;

/**
 * What `pnpm check` is made of: the `pnpm run NAME` parts of the root
 * `package.json` script of that name, in order.
 */
export const partsOf = (scripts, name = 'check') =>
  String(scripts?.[name] ?? '')
    .split('&&')
    .map((part) => /^\s*pnpm run ([\w:.-]+)\s*$/.exec(part)?.[1])
    .filter((part) => part !== undefined);

/** Every `pnpm run NAME [args]` in a run script, with whatever follows the name. */
export const pnpmRunsIn = (text) =>
  [...String(text ?? '').matchAll(/\bpnpm run ([\w:.-]+)([^\n&;|]*)/g)].map((m) => ({
    name: m[1],
    args: m[2].trim(),
  }));

/** Scripts a job may run that are not a part of `pnpm check`. */
const SETUP_RUNS = ['build', 'format:check', 'check:docs'];

/** The only conditions on a step or a job: the change is code, or it is prose. */
const KIND_IF = /^(\$\{\{\s*)?needs\.scope\.outputs\.kind == '(code|prose)'(\s*\}\})?$/;

/** `1/2`, `2/2`: every shard of one total, and no other. */
export const coversAllShards = (shards) => {
  const parsed = (shards ?? []).map((s) => /^(\d+)\/(\d+)$/.exec(String(s)));
  if (parsed.length === 0 || parsed.some((m) => m === null)) return false;
  const totals = new Set(parsed.map((m) => m[2]));
  if (totals.size !== 1) return false;
  const total = Number([...totals][0]);
  const indexes = parsed.map((m) => Number(m[1])).sort((a, b) => a - b);
  return indexes.length === total && indexes.every((n, i) => n === i + 1);
};

const checkYamlRules = (doc, fail, scripts) => {
  const jobs = doc?.jobs ?? {};
  const norm = (value) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').replace(/"/g, "'").trim() : value;

  // 1. One verdict, named `check`.
  const verdict = jobs.check;
  if (!verdict) {
    fail(
      'has no job `check`: the commit would have no check run of that name, and nothing can deploy',
    );
    return;
  }
  if (verdict.name !== 'check') {
    fail('the job `check` must have `name: check`: the check run is named after the job name');
  }
  for (const [id, job] of Object.entries(jobs)) {
    if (id !== 'check' && job?.name === 'check') {
      fail(
        `\`${id}\` is also named \`check\`: two verdicts under one name, and the latest decides`,
      );
    }
  }

  // 2. It needs every other job, and runs whatever they did.
  const others = Object.keys(jobs).filter((id) => id !== 'check');
  const needed = needsOf(verdict);
  for (const id of others) {
    if (!needed.includes(id)) {
      fail(
        `\`check\` does not \`needs\` \`${id}\`: that job could fail and \`check\` would still go green`,
      );
    }
  }
  const verdictIf = norm(verdict.if);
  if (verdictIf !== '${{ always() }}' && verdictIf !== 'always()') {
    fail(
      '`check` must run `if: ${{ always() }}`: when a job it needs fails it is otherwise skipped, and a skipped required check counts as passing',
    );
  }
  if (verdict['continue-on-error'] !== undefined) {
    fail('`check` has `continue-on-error`: a red verdict must be red');
  }
  const judging = (verdict.steps ?? []).filter(
    (s) => typeof s?.run === 'string' && s.run.includes('check-verdict.mjs'),
  );
  if (judging.length === 0) {
    fail('`check` does not run scripts/check-verdict.mjs, so nothing judges the other jobs');
  }
  for (const step of judging) {
    if (step.if !== undefined || step['continue-on-error'] !== undefined) {
      fail('the step that runs scripts/check-verdict.mjs is conditional or may fail quietly');
    }
    if (!/toJSON\(\s*needs\s*\)/.test(JSON.stringify(step.env ?? {}))) {
      fail('check-verdict.mjs is not given `toJSON(needs)`, so it has nothing to judge');
    }
  }

  // 3. No suite job can fail quietly or hang for ever.
  for (const id of others) {
    const job = jobs[id];
    if (job?.['continue-on-error'] !== undefined) {
      fail(`\`${id}\` has \`continue-on-error\`: it could fail and \`check\` would go green`);
    }
    for (const step of job?.steps ?? []) {
      if (step?.['continue-on-error'] !== undefined && /\bpnpm\b/.test(step.run ?? '')) {
        fail(`a step of \`${id}\` that runs pnpm has \`continue-on-error\``);
      }
    }
  }
  for (const [id, job] of Object.entries(jobs)) {
    const minutes = Number(job?.['timeout-minutes']);
    if (!(minutes > 0 && minutes <= 20)) {
      fail(
        `\`${id}\` needs a \`timeout-minutes\` of 20 or less (30 was one job, and it was 27 minutes long)`,
      );
    }
  }

  // 4. The jobs run what `pnpm check` is made of: every part, and nothing more.
  const parts = partsOf(scripts);
  if (parts.length === 0) {
    fail(
      'package.json `check` is not a chain of `pnpm run …` parts, so what CI must run cannot be read',
    );
    return;
  }
  const seen = new Map(); // part -> [{job, step, args}]
  for (const [id, job] of Object.entries(jobs)) {
    for (const step of job?.steps ?? []) {
      for (const { name, args } of pnpmRunsIn(step?.run)) {
        if (parts.includes(name)) {
          seen.set(name, [...(seen.get(name) ?? []), { id, job, step, args }]);
        } else if (!SETUP_RUNS.includes(name)) {
          fail(
            `\`${id}\` runs \`pnpm run ${name}\`, which is not a part of \`pnpm check\` (${parts.join(', ')}): CI would run more than the local gate`,
          );
        }
      }
      if (/\bpnpm check\b/.test(step?.run ?? '')) {
        fail(`\`${id}\` runs \`pnpm check\`; the jobs run its parts, one each`);
      }
    }
  }
  for (const part of parts) {
    const uses = seen.get(part) ?? [];
    if (uses.length === 0) {
      fail(
        `no job runs \`pnpm run ${part}\`, a part of \`pnpm check\`: CI would run less than the local gate`,
      );
      continue;
    }
    for (const { id, job, step } of uses) {
      const jobIf = norm(job.if);
      const stepIf = norm(step.if);
      const fine = (cond) => cond === undefined || KIND_IF.test(cond);
      if (!fine(jobIf) || !fine(stepIf) || step['continue-on-error'] !== undefined) {
        fail(
          `\`${id}\` runs \`pnpm run ${part}\` under a condition other than the change being code (\`${jobIf ?? stepIf}\`)`,
        );
      }
      if (/'prose'/.test(`${jobIf ?? ''}${stepIf ?? ''}`)) {
        fail(`\`${id}\` runs \`pnpm run ${part}\` only for prose changes`);
      }
    }
  }

  // 5. A sharded part runs every shard.
  for (const part of parts) {
    for (const { id, job, args } of seen.get(part) ?? []) {
      const matrix = job?.strategy?.matrix?.shard;
      if (args.includes('--shard')) {
        if (!coversAllShards(matrix)) {
          fail(
            `\`${id}\` shards \`${part}\` but its matrix is \`${JSON.stringify(matrix)}\`, not every shard of one total (1/2 and 2/2): part of the suite would never run`,
          );
        }
        if (job?.strategy?.['fail-fast'] === true) {
          fail(`\`${id}\` is \`fail-fast\`: the other shard's result would be lost`);
        }
      } else if (matrix !== undefined) {
        fail(
          `\`${id}\` has a shard matrix but runs \`${part}\` without --shard: every runner would run all of it`,
        );
      }
    }
  }
};

const ciRules = (path, file, doc) => {
  const jobs = doc?.jobs ?? {};
  const fail = (message) => problems.push(`${path}: ${message}`);

  if (file === 'deploy-prod.yml') {
    const plan = jobs.plan;
    if (!plan) {
      fail('has no `plan` job, so the migration plan cannot be read before the approval prompt');
    } else {
      if (environmentOf(plan) !== undefined) {
        fail('the `plan` job is in an environment, which puts the approval prompt before the plan');
      }
      for (const [script, why] of [
        ['green-check.mjs', 'a red or unfinished commit would reach the approval prompt'],
        ['prod-plan.mjs', 'the pending migrations would not be in the run summary'],
      ]) {
        const step = (plan.steps ?? []).find(
          (s) => typeof s?.run === 'string' && s.run.includes(script),
        );
        if (!step) fail(`the \`plan\` job never runs scripts/${script}: ${why}`);
        else if (!unconditional(plan, step)) {
          fail(`scripts/${script} is conditional or may fail quietly in \`plan\`: ${why}`);
        }
      }
    }

    // The commit that is judged is the commit that is deployed (SUS-144).
    const resolver = (plan?.steps ?? []).find(
      (s) =>
        typeof s?.run === 'string' && s.run.includes('release.mjs') && s.run.includes('resolve'),
    );
    if (!resolver?.id) {
      fail(
        'the `plan` job has no `id`-ed step running `release.mjs resolve`, so a rollback target is never resolved',
      );
    } else {
      if (!unconditional(plan, resolver))
        fail('`release.mjs resolve` is conditional or may fail quietly in `plan`');
      const output = `steps.${resolver.id}.outputs.sha`;
      for (const script of ['green-check.mjs', 'prod-plan.mjs']) {
        const step = (plan.steps ?? []).find(
          (s) => typeof s?.run === 'string' && s.run.includes(script),
        );
        if (step && !JSON.stringify(step.env ?? {}).includes(output)) {
          fail(
            `scripts/${script} must judge \`${output}\`, the commit that will be deployed, not \`github.sha\``,
          );
        }
      }
    }

    const production = Object.entries(jobs).filter(
      ([, job]) => environmentOf(job) === 'production',
    );
    if (production.length === 0) fail('has no job in the `production` environment');

    // Tagging needs `contents: write`. Exactly one job has it: it needs every
    // production job (so it only runs after a deploy and its smoke test passed),
    // is in no environment, and reads no secret.
    if (doc?.permissions?.contents !== 'read')
      fail('the workflow-level `permissions` must be `contents: read`');
    const writers = Object.entries(jobs).filter(
      ([, job]) => job?.permissions?.contents === 'write',
    );
    const taggers = writers.filter(([, job]) => runText(job).includes('release.mjs'));
    if (writers.length !== 1 || taggers.length !== 1) {
      fail('exactly one job, the one that runs `release.mjs tag`, may have `contents: write`');
    }
    for (const [name, job] of taggers) {
      for (const [other] of production) {
        if (!needsClosure(jobs, name).has(other))
          fail(
            `\`${name}\` tags without needing \`${other}\`, so a failed deploy or smoke test could still be tagged`,
          );
      }
      if (environmentOf(job) !== undefined)
        fail(`\`${name}\` is in an environment; tagging would ask for the approval a second time`);
      if (secretsIn(job).size > 0) fail(`\`${name}\` holds \`contents: write\` and reads a secret`);
      const step = (job.steps ?? []).find(
        (s) => typeof s?.run === 'string' && /release\.mjs\s+tag\b/.test(s.run),
      );
      if (!step) fail(`\`${name}\` never runs \`release.mjs tag\`, so a release is not tagged`);
      else if (!unconditional(job, step))
        fail(`\`release.mjs tag\` is conditional or may fail quietly in \`${name}\``);
    }
    for (const [name, job] of production) {
      if (name !== 'plan' && !needsClosure(jobs, name).has('plan')) {
        fail(`\`${name}\` is in \`production\` but does not need \`plan\``);
      }
      // A missing secret is a failure, not a skip: an `if` on a step or a
      // `continue-on-error` is how a production deploy goes green having done
      // nothing.
      for (const step of job.steps ?? []) {
        const label = step.name ?? step.uses ?? step.run?.split('\n')[0] ?? 'a step';
        if (step.if !== undefined)
          fail(
            `\`${name}\` step "${label}" has an \`if\`; a production step runs or the job fails`,
          );
        if (step['continue-on-error'] !== undefined) {
          fail(`\`${name}\` step "${label}" has \`continue-on-error\``);
        }
      }
      if (job.if !== undefined)
        fail(`\`${name}\` has an \`if\`; a skipped production job reports success`);
      const checkout = (job.steps ?? []).find((s) =>
        String(s?.uses ?? '').startsWith('actions/checkout'),
      );
      if (!JSON.stringify(checkout?.with?.ref ?? '').includes('needs.plan.outputs.sha')) {
        fail(
          `\`${name}\` does not check out \`needs.plan.outputs.sha\`, so a rollback would deploy the wrong code`,
        );
      }
      // Migrations are forward-only. A step that pushes them must read the
      // rollback flag, in the script, because the step itself may not have an `if`.
      for (const step of job.steps ?? []) {
        if (
          typeof step?.run === 'string' &&
          /\bdb push\b/.test(step.run) &&
          !/\$\{?ROLLBACK\b/.test(step.run)
        ) {
          fail(
            `\`${name}\` step "${step.name ?? 'db push'}" pushes migrations without reading ROLLBACK`,
          );
        }
      }
      // After the web deploy, so it looks at what was just put live.
      const steps = job.steps ?? [];
      const deployAt = steps.findIndex(
        (s) => typeof s?.run === 'string' && /\beas deploy\b/.test(s.run),
      );
      const smokeAt = steps.findIndex(
        (s) =>
          typeof s?.run === 'string' &&
          s.run.includes('smoke-web.mjs') &&
          /\bcheck:env\b/.test(s.run),
      );
      if (deployAt !== -1 && (smokeAt === -1 || smokeAt < deployAt)) {
        fail(
          `\`${name}\` deploys the web build but does not smoke test it afterwards (scripts/smoke-web.mjs and pnpm check:env)`,
        );
      }
      const guard = (job.steps ?? []).find(
        (s) =>
          typeof s?.run === 'string' &&
          /\bexit 1\b/.test(s.run) &&
          PROD_ONLY.every((n) => secretsIn(s.env).has(n)),
      );
      if (!guard) {
        fail(`\`${name}\` has no step that fails when ${PROD_ONLY.join(', ')} is missing`);
      }
    }
  }

  if (file === 'deploy-dev.yml') {
    const waiters = Object.entries(jobs).filter(
      ([, job]) =>
        environmentOf(job) === undefined &&
        runText(job).includes('green-check.mjs') &&
        /--wait\s+\d+/.test(runText(job)),
    );
    if (waiters.length === 0) {
      fail(
        'no job waits for `check` (scripts/green-check.mjs --wait): a commit whose check fails would be deployed to dev',
      );
    }
    for (const [name, job] of waiters) {
      const step = (job.steps ?? []).find(
        (s) => typeof s?.run === 'string' && s.run.includes('green-check.mjs'),
      );
      if (!unconditional(job, step))
        fail(`the green-check in \`${name}\` is conditional or may fail quietly`);
    }
    for (const [name, job] of Object.entries(jobs)) {
      if (environmentOf(job) === undefined) continue;
      const reached = needsClosure(jobs, name);
      if (!waiters.some(([waiter]) => reached.has(waiter) && waiter !== name)) {
        fail(`\`${name}\` deploys without needing a job that waits for \`check\``);
      }
    }
  }

  if (file === 'check.yml') {
    // Known-safe forms only. Matching on the words "main" and `github.sha`
    // accepted `github.ref == 'refs/heads/main'` (cancels exactly the runs to
    // protect) and a reversed group condition, so the two expressions are
    // compared whole, after whitespace and quote style are normalised.
    const norm = (value) =>
      typeof value === 'string' ? value.replace(/\s+/g, ' ').replace(/"/g, "'").trim() : value;
    const cancel = norm(doc?.concurrency?.['cancel-in-progress']);
    if (cancel !== "${{ github.ref != 'refs/heads/main' }}") {
      fail(
        "`cancel-in-progress` must be exactly `${{ github.ref != 'refs/heads/main' }}`: a cancelled `main` check is a commit deployed without a verdict",
      );
    }
    const group = norm(doc?.concurrency?.group);
    if (group !== "check-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}") {
      fail(
        "the concurrency group must be exactly `check-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}`: a group holds one pending run, and a third push on `main` would cancel it",
      );
    }
    let scripts;
    try {
      scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    } catch {
      fail(
        'package.json cannot be read from the working directory, so what CI must run is unknown',
      );
    }
    checkYamlRules(doc, fail, scripts);
  }
};

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

    ciRules(path, file, doc);

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
      if (secrets.has('?')) {
        problems.push(
          `${path} · ${jobName}: reads secrets in a form this check cannot resolve (a computed index, \`toJSON(secrets)\`, \`secrets.*\`); name each one as \`secrets.NAME\``,
        );
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
  'check:workflows: every job installs before it uses pnpm, only production jobs read production credentials, production waits for a green plan, dev waits for check',
);
