/**
 * Three rules about what a workflow lets in from outside (SUS-120). Pure
 * functions over a parsed workflow, so each is tested on its own
 * (`workflow-hygiene.test.mjs`) and `check-workflows.mjs` only applies them.
 *
 * 1. Every `uses:` is a full commit SHA. A tag moves; a moved tag runs in the
 *    job before the steps that put `EXPO_TOKEN` and `SUPABASE_ACCESS_TOKEN` in
 *    the environment. Dependabot keeps the pins current (`.github/dependabot.yml`).
 * 2. A `run:` block holds no `${{ }}` expression outside a short allow-list.
 *    The expression is substituted into the script before the shell parses it
 *    (docs/runbooks/ci.md, "Never interpolate the event payload"). Anything
 *    else goes through `env:`, where the shell receives it as data.
 * 3. `pull_request_target`, which runs with secrets on a PR's behalf, is
 *    allowed only in workflows on an explicit list, and those never check out
 *    or run the PR's head.
 */

const SHA_PIN = /^[^\s@]+@[0-9a-f]{40}$/;
const DOCKER_DIGEST = /^docker:\/\/[^\s@]+@sha256:[0-9a-f]{64}$/;

/** Every `uses:` of every step and every job (a reusable workflow) in the doc. */
const usesIn = (doc) =>
  Object.entries(doc?.jobs ?? {}).flatMap(([jobName, job]) => [
    ...(typeof job?.uses === 'string' ? [{ jobName, uses: job.uses }] : []),
    ...(Array.isArray(job?.steps) ? job.steps : []).flatMap((step) =>
      typeof step?.uses === 'string' ? [{ jobName, uses: step.uses }] : [],
    ),
  ]);

/** The `uses:` values that are not pinned by commit. Local `./` actions are exempt. */
export const unpinnedUses = (doc) =>
  usesIn(doc)
    .filter(
      ({ uses }) => !uses.startsWith('./') && !SHA_PIN.test(uses) && !DOCKER_DIGEST.test(uses),
    )
    .map(({ jobName, uses }) => `${jobName}: \`${uses}\``);

/** Each `${{ … }}` expression (trimmed) inside a `run:`, with the job it is in. */
const runExpressions = (doc) =>
  Object.values(doc?.jobs ?? {}).flatMap((job) =>
    (Array.isArray(job?.steps) ? job.steps : []).flatMap((step) =>
      typeof step?.run === 'string'
        ? [...step.run.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => ({ expr: m[1].trim(), job }))
        : [],
    ),
  );

/** The expressions (trimmed) inside every `run:` of the doc. */
export const expressionsInRun = (doc) => runExpressions(doc).map(({ expr }) => expr);

/**
 * The expressions a script may contain, each matched whole. What they have in
 * common is that no outsider chooses the value:
 *
 * - run identity and counters, the repository, the commit SHA, the event name,
 *   the runner, the job status: set by GitHub, in a fixed alphabet;
 * - the pull request's number: an integer. Its title, branch, body and head
 *   ref are the opposite and are not here;
 * - `matrix.NAME`, when the job's matrix is written in the file and so reviewed
 *   like the script (a matrix built with `fromJSON(…)` at run time is not);
 * - the runner's paths and the server URL;
 * - `secrets.NAME`: set by an admin, never by the event. (The better habit is
 *   `env:` for these too, since a quote in the value would break the script;
 *   it is allowed because an admin sets it and the diff is smaller.)
 *
 * Not here, because somebody else controls them: `inputs.*`, `github.event.*`
 * (other than the PR number), `github.head_ref`, `ref`, `ref_name`, `base_ref`,
 * `actor`, and every `steps.*.outputs` and `needs.*.outputs`, which can carry
 * any of those on.
 */
const SAFE_EXPRESSIONS = [
  /^github\.(event_name|sha|run_id|run_number|run_attempt|repository|repository_owner|job|workspace|server_url|token)$/,
  /^github\.event\.(pull_request\.)?number$/,
  /^runner\.(os|arch|temp)$/,
  /^job\.status$/,
  /^strategy\.job-index$/,
  /^secrets\.[A-Za-z_]\w*$/,
];

const MATRIX = /^matrix\.[A-Za-z_][\w-]*$/;

/** The expressions in a `run:` that are not on the allow-list. */
export const unsafeRunExpressions = (doc) =>
  runExpressions(doc)
    .filter(
      ({ expr, job }) =>
        !SAFE_EXPRESSIONS.some((re) => re.test(expr)) &&
        !(MATRIX.test(expr) && !JSON.stringify(job?.strategy?.matrix ?? '').includes('${{')),
    )
    .map(({ expr }) => expr);

/**
 * Pinned `uses:` lines with no version in a trailing comment. Reads the file's
 * text, since the parsed YAML has dropped its comments. Without the comment a
 * reviewer cannot tell what is pinned, and Dependabot cannot bump it.
 */
export const unversionedPins = (text) =>
  String(text)
    .split('\n')
    .filter((line) => /\buses:\s*[^\s#@]+@[0-9a-f]{40}\b/.test(line) && !/#\s*v?\d/.test(line))
    .map((line) => line.trim());

/** Workflows that may use `pull_request_target`. Add one only with a reason. */
export const PULL_REQUEST_TARGET_ALLOWED = ['preview-cleanup.yml'];

/**
 * Anything in an `env:` or `with:` that names the PR's head, merge ref or fork,
 * or reaches the event by a route this cannot read (index syntax, `fromJSON`).
 * Case-insensitive, because GitHub reads context names without regard to case.
 * The PR number is the one thing the clean-up needs and is not matched.
 */
const PR_HEAD =
  /head_ref|pull_request\s*[\].]\s*(head|merge)|\[\s*['"]pull_request|event\.(after|before)|refs\/pull\/|workflow_run\.head|fromjson/i;

/** A script that fetches code: a `pull_request_target` job has none to fetch. */
const FETCHES_CODE =
  /\bgh\s+pr\s+checkout\b|\bgit\s+(fetch|checkout|clone|pull|switch|merge)\b|\bpull\/\S+\/(head|merge)|refs\/pull\//;

/** The only expressions a checkout in a `pull_request_target` workflow may use. */
const CHECKOUT_EXPRESSIONS = ['github.event.repository.default_branch', 'github.sha'];

const triggersOf = (doc) => {
  const on = doc?.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return on && typeof on === 'object' ? Object.keys(on) : [];
};

const valuesOf = (value) =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(valuesOf)
      : [];

/** Problems with how `file` uses `pull_request_target`; none if it does not. */
export const pullRequestTargetProblems = (file, doc) => {
  if (!triggersOf(doc).includes('pull_request_target')) return [];
  if (!PULL_REQUEST_TARGET_ALLOWED.includes(file)) {
    return [
      `uses \`pull_request_target\`, which runs the base repository's secrets on a pull request's behalf; only ${PULL_REQUEST_TARGET_ALLOWED.join(', ')} may, and a new one needs a reason written into workflow-hygiene.mjs`,
    ];
  }
  const problems = [];
  const touches = (where, values) => {
    for (const value of values) {
      if (PR_HEAD.test(value)) {
        problems.push(
          `${where}: a \`pull_request_target\` workflow reaches the pull request's code or head (\`${value.trim()}\`); it must stay on the default branch`,
        );
      }
    }
  };
  touches('workflow env', valuesOf(doc?.env));
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    if (typeof job?.uses === 'string') {
      problems.push(
        `${jobName}: a \`pull_request_target\` workflow calls a reusable workflow (\`${job.uses}\`), whose code this check cannot read`,
      );
    }
    touches(`${jobName} env`, valuesOf(job?.env));
    for (const step of Array.isArray(job?.steps) ? job.steps : []) {
      touches(jobName, [...valuesOf(step?.env), ...valuesOf(step?.with)]);
      if (typeof step?.uses === 'string' && /checkout/i.test(step.uses)) {
        if (!step.uses.startsWith('actions/checkout@')) {
          problems.push(
            `${jobName}: a \`pull_request_target\` workflow uses \`${step.uses}\`; only actions/checkout, on the default branch`,
          );
        }
        for (const key of ['ref', 'repository']) {
          const value = String(step.with?.[key] ?? '');
          const exprs = [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1].trim());
          const literal = value.replace(/\$\{\{[\s\S]*?\}\}/g, '');
          if (
            exprs.some((e) => !CHECKOUT_EXPRESSIONS.includes(e)) ||
            (key === 'repository' && value)
          ) {
            problems.push(
              `${jobName}: a \`pull_request_target\` checkout sets \`${key}: ${value}\`; it must check out the default branch (${CHECKOUT_EXPRESSIONS.join(' or ')})`,
            );
          } else if (key === 'ref' && literal.trim() !== '' && exprs.length === 0) {
            problems.push(
              `${jobName}: a \`pull_request_target\` checkout sets \`ref: ${value}\`; name the default branch by expression, not by a literal a PR can match`,
            );
          }
        }
      }
      if (typeof step?.run === 'string' && FETCHES_CODE.test(step.run)) {
        problems.push(
          `${jobName}: a \`pull_request_target\` workflow fetches code in a script, which could be the pull request's`,
        );
      }
    }
  }
  return problems;
};
