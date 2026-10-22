/**
 * The secret scan in check.yml's `scope` job runs on every event, before
 * anything else, and on a dispatch it scans the branch's own commits.
 *
 * It is two steps. On a push or a pull request, `gitleaks/gitleaks-action`
 * scans that push's or that pull request's commits. On a dispatch the action
 * scans every ref the checkout fetched (every branch in the repository), so a
 * fixture on an old branch that was never merged failed the content bots'
 * pull request (#261, ADR 0089). A dispatch is judged against `main`, as a pull
 * request is, so there the gitleaks CLI scans `origin/main..HEAD`.
 *
 * Splitting the scan by event puts an `if` on it, and an `if` is a way for it to
 * stop running. So this holds the pair: the action's condition and the CLI's
 * are exact complements, the CLI checks what it downloaded, scans the range
 * and cannot hide its exit status, and both come straight after the checkout.
 * Pure: it takes the parsed workflow and returns the problems.
 */

const ACTION = /^gitleaks\/gitleaks-action@/;
const NOT_DISPATCH = "github.event_name != 'workflow_dispatch'";
const DISPATCH = "github.event_name == 'workflow_dispatch'";
const RANGE = '--log-opts="origin/main..HEAD"';

/** `${{ a }}` and `a` are the same condition; whitespace and quote style are not significant. */
const cond = (value) =>
  typeof value === 'string'
    ? value
        .replace(/^\s*\$\{\{\s*([\s\S]*?)\s*\}\}\s*$/, '$1')
        .replace(/\s+/g, ' ')
        .replace(/"/g, "'")
        .trim()
    : value;

export const secretScanProblems = (doc) => {
  const problems = [];
  const scope = doc?.jobs?.scope;
  if (!scope) return ['has no `scope` job, so nothing scans for secrets'];
  const steps = scope.steps ?? [];
  if (scope.if !== undefined)
    problems.push('the `scope` job has an `if`: the secret scan could be skipped');

  const actionAt = steps.findIndex((s) => ACTION.test(String(s?.uses ?? '')));
  if (actionAt === -1)
    return [...problems, 'the `scope` job does not run gitleaks/gitleaks-action'];
  const action = steps[actionAt];
  const actionIf = cond(action.if);

  const checkout = steps.findIndex((s) => /^actions\/checkout@/.test(String(s?.uses ?? '')));
  if (checkout === -1 || String(steps[checkout].with?.['fetch-depth']) !== '0') {
    problems.push('the `scope` checkout needs `fetch-depth: 0`: gitleaks reads the history');
  }

  if (actionIf === undefined) {
    if (actionAt !== checkout + 1)
      problems.push('the secret scan is not the first step after the checkout');
    return problems;
  }
  if (actionIf !== NOT_DISPATCH) {
    return [
      ...problems,
      `gitleaks/gitleaks-action runs under \`${actionIf}\`; the only condition it may have is \`${NOT_DISPATCH}\`, with the CLI step covering the dispatch`,
    ];
  }

  const cliAt = steps.findIndex(
    (s) => cond(s?.if) === DISPATCH && /\bgitleaks\b/.test(String(s?.run ?? '')),
  );
  if (cliAt === -1) {
    return [
      ...problems,
      `gitleaks/gitleaks-action skips a dispatch and no step under \`${DISPATCH}\` runs gitleaks: a dispatch would scan nothing`,
    ];
  }
  const cli = steps[cliAt];
  const run = String(cli.run);
  if (!/\bgitleaks"? git /.test(run)) {
    problems.push('the dispatch step does not run `gitleaks git`');
  }
  if (!run.includes(RANGE)) {
    problems.push(
      `the dispatch step does not scan \`${RANGE}\`: with no range gitleaks scans every branch in the repository`,
    );
  }
  if (
    !/sha256sum --check/.test(run) ||
    !/^[0-9a-f]{64}$/.test(String(cli.env?.GITLEAKS_SHA256 ?? ''))
  ) {
    problems.push(
      'the dispatch step does not check the gitleaks download against a pinned GITLEAKS_SHA256',
    );
  }
  if (/\|\||set \+e|;\s*true\b|\bexit 0\b|--exit-code[= ]0\b/.test(run)) {
    problems.push('the dispatch step could hide gitleaks exiting non-zero');
  }
  if (Math.min(actionAt, cliAt) !== checkout + 1 || Math.abs(actionAt - cliAt) !== 1) {
    problems.push('the two secret-scan steps are not the first two steps after the checkout');
  }
  return problems;
};
