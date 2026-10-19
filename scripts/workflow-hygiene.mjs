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

/** Each `${{ … }}` expression (trimmed) inside a step's `run:`, with its job. */
export const expressionsInRun = (doc) =>
  Object.entries(doc?.jobs ?? {}).flatMap(([, job]) =>
    (Array.isArray(job?.steps) ? job.steps : []).flatMap((step) =>
      typeof step?.run === 'string'
        ? [...step.run.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1].trim())
        : [],
    ),
  );

/**
 * The expressions a script may contain, each matched whole. What they have in
 * common is that no outsider chooses the value:
 *
 * - run identity and counters, the repository, the commit SHA, the event name,
 *   the runner, the job status: set by GitHub, in a fixed alphabet;
 * - the pull request's number: an integer. Its title, branch, body and head
 *   ref are the opposite and are not here;
 * - `matrix.NAME`: written in the workflow file, so reviewed like the script;
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
  /^github\.(event_name|sha|run_id|run_number|run_attempt|repository|repository_owner|job)$/,
  /^github\.event\.(pull_request\.)?number$/,
  /^runner\.(os|arch)$/,
  /^job\.status$/,
  /^strategy\.job-index$/,
  /^matrix\.[A-Za-z_][\w-]*$/,
  /^secrets\.[A-Za-z_]\w*$/,
];

/** The expressions in a `run:` that are not on the allow-list. */
export const unsafeRunExpressions = (doc) =>
  expressionsInRun(doc).filter((expr) => !SAFE_EXPRESSIONS.some((re) => re.test(expr)));

/** Workflows that may use `pull_request_target`. Add one only with a reason. */
export const PULL_REQUEST_TARGET_ALLOWED = ['preview-cleanup.yml'];

/** Anything that names the PR's head, merge ref or fork. */
const PR_HEAD =
  /github\.(head_ref|event\.pull_request|event\.number|event\.workflow_run\.head)|refs\/pull\/|refs\/heads\/\$\{\{/;

const triggersOf = (doc) => {
  const on = doc?.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return on && typeof on === 'object' ? Object.keys(on) : [];
};

/** Problems with how `file` uses `pull_request_target`; none if it does not. */
export const pullRequestTargetProblems = (file, doc) => {
  if (!triggersOf(doc).includes('pull_request_target')) return [];
  if (!PULL_REQUEST_TARGET_ALLOWED.includes(file)) {
    return [
      `uses \`pull_request_target\`, which runs the base repository's secrets on a pull request's behalf; only ${PULL_REQUEST_TARGET_ALLOWED.join(', ')} may, and a new one needs a reason written into check-workflows`,
    ];
  }
  const problems = [];
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    for (const step of Array.isArray(job?.steps) ? job.steps : []) {
      if (typeof step?.uses === 'string' && step.uses.startsWith('actions/checkout')) {
        for (const key of ['ref', 'repository']) {
          if (PR_HEAD.test(String(step.with?.[key] ?? ''))) {
            problems.push(
              `${jobName}: a \`pull_request_target\` workflow checks out the pull request (\`${key}: ${step.with[key]}\`); it must check out the default branch`,
            );
          }
        }
      }
      if (typeof step?.run === 'string' && /\bgh\s+pr\s+checkout\b|refs\/pull\//.test(step.run)) {
        problems.push(
          `${jobName}: a \`pull_request_target\` workflow fetches the pull request's code in a script`,
        );
      }
    }
  }
  return problems;
};
