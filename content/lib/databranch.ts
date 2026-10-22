/**
 * Where the bots' commits go (ADR 0089). `main` is protected, so nothing the
 * content workflows write is pushed to it. It is pushed to one long-lived
 * branch, `content-data`, and one pull request from that branch to `main` is
 * what the founder merges. This file is the only place a workflow runs
 * `git push`, so the rules about it are kept (and tested) in one spot:
 *
 *   sync              start a run from the data branch: main, plus whatever
 *                     the bots have written that is not merged yet.
 *   save <msg> <paths> commit those paths and push them to the data branch.
 *   open-pr           make sure the pull request exists, and ask for `check`
 *                     on its head (a push by GITHUB_TOKEN triggers nothing).
 *   attempts          the posts started and not yet in the ledger.
 *   clear <p> <slug>  forget one attempt, after looking at the platform.
 *
 * The publisher also uses `begin`: before it calls a platform it pushes a tag
 * `content-attempt/<platform>/<slug>`. A tag cannot be pushed twice, so this
 * is the lock that makes a second post impossible: two runs that both mean to
 * post the same piece cannot both create it, and a run that finds a tag with no
 * ledger row behind it posts nothing at all. The tag outlives the branch, the
 * pull request and the checkout, which the ledger does not.
 *
 * Every command here fails closed: a git command that cannot be answered is an
 * error, never "nothing there".
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BRANCH = 'content-data';
export const MAIN = 'main';
export const ATTEMPT_PREFIX = 'content-attempt';

export class DataBranchError extends Error {}

export type Ctx = {
  /** the checkout: `content/` in a workflow, a temporary clone in a test */
  cwd: string;
  remote?: string;
  /** replaces `gh`, for tests */
  gh?: (args: string[]) => { status: number; stdout: string; stderr: string };
  log?: (line: string) => void;
};

type Out = { status: number; stdout: string; stderr: string };

function exec(cmd: string, args: string[], cwd: string, input?: string): Out {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    input,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no', LC_ALL: 'C' },
  });
  if (r.error) throw new DataBranchError(`${cmd} ${args.join(' ')}: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: (r.stderr ?? '').trim() };
}

const remoteOf = (c: Ctx) => c.remote ?? 'origin';
const say = (c: Ctx, line: string) => (c.log ?? console.log)(line);

function git(c: Ctx, args: string[]): Out {
  return exec('git', args, c.cwd);
}

/** A git command that has to succeed; the message says which one did not. */
function must(c: Ctx, args: string[]): string {
  const r = git(c, args);
  if (r.status !== 0) throw new DataBranchError(`git ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout.trim()}`);
  return r.stdout;
}

const isAncestor = (c: Ctx, a: string, b: string) => git(c, ['merge-base', '--is-ancestor', a, b]).status === 0;

function identify(c: Ctx) {
  must(c, ['config', 'user.name', 'wenna-content bot']);
  must(c, ['config', 'user.email', 'bot@wenna.app']);
}

/** Whether the data branch exists on the remote. An unreachable remote is an error, never "no". */
function remoteHasBranch(c: Ctx): boolean {
  const r = git(c, ['ls-remote', '--exit-code', '--heads', remoteOf(c), BRANCH]);
  if (r.status === 0) return true;
  if (r.status === 2) return false;
  throw new DataBranchError(`cannot reach ${remoteOf(c)} to read ${BRANCH}: ${r.stderr}`);
}

/**
 * Check out `content-data` as this run's starting point. It is `main` when the
 * branch does not exist or has been merged, and otherwise the branch with
 * `main` merged in, so a run sees every row and ledger line the earlier runs
 * wrote that are not on `main` yet, and every queue file that is.
 */
export function sync(c: Ctx): 'fresh' | 'merged' | 'continued' {
  identify(c);
  const hasBranch = remoteHasBranch(c);
  const r = remoteOf(c);
  const refs = [`+refs/heads/${MAIN}:refs/remotes/${r}/${MAIN}`];
  if (hasBranch) refs.push(`+refs/heads/${BRANCH}:refs/remotes/${r}/${BRANCH}`);
  must(c, ['fetch', '--quiet', r, ...refs]);
  if (!hasBranch) {
    must(c, ['checkout', '--quiet', '-B', BRANCH, `${r}/${MAIN}`]);
    say(c, `${BRANCH} does not exist yet; starting from ${MAIN}`);
    return 'fresh';
  }
  if (isAncestor(c, `${r}/${BRANCH}`, `${r}/${MAIN}`)) {
    must(c, ['checkout', '--quiet', '-B', BRANCH, `${r}/${MAIN}`]);
    say(c, `${BRANCH} is merged into ${MAIN}; starting again from ${MAIN}`);
    return 'merged';
  }
  must(c, ['checkout', '--quiet', '-B', BRANCH, `${r}/${BRANCH}`]);
  const m = git(c, ['merge', '--no-edit', '-m', `content: merge ${MAIN} into ${BRANCH}`, `${r}/${MAIN}`]);
  if (m.status !== 0) {
    git(c, ['merge', '--abort']);
    throw new DataBranchError(
      `${MAIN} cannot be merged into ${BRANCH} (${m.stderr || m.stdout.trim()}). If its pull request was squash-merged, delete the ${BRANCH} branch and the next run starts again from ${MAIN}; otherwise resolve it by hand. Nothing was posted.`,
    );
  }
  say(c, `continuing from ${BRANCH} (${must(c, ['rev-list', '--count', `${r}/${MAIN}..HEAD`]).trim()} commits not on ${MAIN})`);
  return 'continued';
}

const tracked = (c: Ctx, p: string) => existsSync(`${c.cwd}/${p}`) || must(c, ['ls-files', '--', p]).trim() !== '';

/** Push HEAD to the data branch; once, a rejected push is rebased onto what is there. Never to `main`. */
function push(c: Ctx) {
  const r = remoteOf(c);
  const dest = `HEAD:refs/heads/${BRANCH}`;
  if (git(c, ['push', '--quiet', r, dest]).status === 0) return;
  const f = git(c, ['fetch', '--quiet', r, `+refs/heads/${BRANCH}:refs/remotes/${r}/${BRANCH}`]);
  if (f.status !== 0) throw new DataBranchError(`push to ${BRANCH} was rejected and ${BRANCH} cannot be fetched: ${f.stderr}`);
  const b = git(c, ['rebase', `${r}/${BRANCH}`]);
  if (b.status !== 0) {
    git(c, ['rebase', '--abort']);
    throw new DataBranchError(`push to ${BRANCH} was rejected and the rows do not rebase onto it: ${b.stderr}`);
  }
  const p = git(c, ['push', '--quiet', r, dest]);
  if (p.status !== 0) throw new DataBranchError(`push to ${BRANCH} was rejected twice: ${p.stderr}`);
}

/** Commit what changed under `paths` and push it. `pushed` is false when there was nothing to commit. */
export function save(c: Ctx, message: string, paths: string[]): { pushed: boolean } {
  identify(c);
  const here = must(c, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (here !== BRANCH) throw new DataBranchError(`save runs on ${BRANCH}, not ${here}; run sync first`);
  const wanted = paths.filter((p) => tracked(c, p));
  if (wanted.length) must(c, ['add', '-A', '--', ...wanted]);
  if (git(c, ['diff', '--cached', '--quiet']).status === 0) return { pushed: false };
  must(c, ['commit', '--quiet', '-m', message]);
  push(c);
  return { pushed: true };
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const tagFor = (platform: string, slug: string) => {
  if (!SAFE.test(platform) || !SAFE.test(slug)) throw new DataBranchError(`"${platform}/${slug}" cannot be recorded as an attempt; refusing to post it`);
  return `${ATTEMPT_PREFIX}/${platform}/${slug}`;
};

/** Record that a post is about to be made. Throws unless the record is on the remote and this run created it. */
export function begin(c: Ctx, platform: string, slug: string) {
  const tag = tagFor(platform, slug);
  identify(c);
  // A commit of its own for every attempt: pushing the commit that is already the tag is "up to date" and succeeds, so
  // two runs on the same HEAD would both think they had made it. A different object cannot replace an existing tag.
  const nonce = `${new Date().toISOString()} ${process.pid} ${Math.random()}`;
  const made = git(c, ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', `attempt ${tag} ${nonce}`]);
  if (made.status !== 0) throw new DataBranchError(`cannot record the attempt ${tag} (${made.stderr}); posting nothing`);
  const p = git(c, ['push', '--quiet', remoteOf(c), `${made.stdout.trim()}:refs/tags/${tag}`]);
  if (p.status !== 0) throw new DataBranchError(`cannot record the attempt ${tag} (${p.stderr}); posting nothing`);
}

export type Attempt = { platform: string; slug: string };

/** Every attempt on the remote, finished or not. An unreachable remote is an error. */
export function attempts(c: Ctx): Attempt[] {
  const r = git(c, ['ls-remote', '--tags', remoteOf(c), `refs/tags/${ATTEMPT_PREFIX}/*`]);
  if (r.status !== 0) throw new DataBranchError(`cannot list the attempts on ${remoteOf(c)}: ${r.stderr}; posting nothing`);
  const out: Attempt[] = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.match(new RegExp(`refs/tags/${ATTEMPT_PREFIX}/([^/]+)/([^/^]+)(\\^\\{\\})?$`));
    if (m && !m[3]) out.push({ platform: m[1], slug: m[2] });
  }
  return out;
}

/** The attempts the ledger does not account for: a post may have gone out and nothing says so. */
export function unresolved(all: Attempt[], ledger: { platform: string; slug: string }[]): Attempt[] {
  return all.filter((a) => !ledger.some((l) => l.platform === a.platform && l.slug === a.slug));
}

/** Forget an attempt. Only after looking at the platform: this is what lets the publisher try the piece again. */
export function clear(c: Ctx, platform: string, slug: string) {
  const tag = tagFor(platform, slug);
  must(c, ['push', '--quiet', remoteOf(c), `:refs/tags/${tag}`]);
}

const PR_BODY = `The content bots' work since the last merge: analytics rows, series rows, the scorecard, the learned brief, publisher ledger lines and moved queue files. Opened and kept current by the content workflows (ADR 0089); merge it with a merge commit, then delete the branch.

Merging this never posts anything. The publisher reads these files from this branch whether or not it is merged.`;

/** Make sure one pull request from the data branch to main is open, and run `check` on its head. A failure is a warning: the data is already on the branch. */
export function openPr(c: Ctx, repo = process.env.GITHUB_REPOSITORY ?? '<owner>/<repo>'): void {
  const gh = c.gh ?? ((args: string[]) => exec('gh', args, c.cwd));
  const warn = (msg: string) => say(c, `::warning::${msg}`);
  const compare = `https://github.com/${repo}/compare/${MAIN}...${BRANCH}?expand=1`;
  const list = gh(['pr', 'list', '--head', BRANCH, '--base', MAIN, '--state', 'open', '--json', 'number', '--jq', 'length']);
  if (list.status !== 0) return warn(`could not look for the data pull request (${list.stderr}); open it from ${compare}`);
  if (list.stdout.trim() === '0') {
    const made = gh(['pr', 'create', '--head', BRANCH, '--base', MAIN, '--title', 'content: data from the bots', '--body', PR_BODY]);
    if (made.status !== 0) {
      return warn(
        `the data is on ${BRANCH}, but a pull request could not be opened (${made.stderr}). Turn on "Allow GitHub Actions to create and approve pull requests" in Settings, Actions, General, or open it yourself: ${compare}`,
      );
    }
    say(c, `opened ${made.stdout.trim()}`);
  }
  // A push made with GITHUB_TOKEN starts no workflow, and the required `check` has to be on the pull request's head.
  const run = gh(['workflow', 'run', 'check.yml', '--ref', BRANCH]);
  if (run.status !== 0) warn(`could not start \`check\` on ${BRANCH} (${run.stderr}); run it from the Actions tab (check, Run workflow, branch ${BRANCH})`);
}

/** The command line: `node lib/databranch.ts <command> …`, run from content/. Exit 1 on any error. */
function main(argv: string[]): number {
  const c: Ctx = { cwd: process.cwd() };
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case 'sync':
        sync(c);
        return 0;
      case 'save': {
        const [message, ...paths] = rest;
        if (!message || !paths.length) throw new DataBranchError('usage: save <message> <path>…');
        const { pushed } = save(c, message, paths);
        say(c, pushed ? `pushed to ${BRANCH}` : 'nothing to commit');
        if (process.env.GITHUB_OUTPUT) {
          appendFileSync(process.env.GITHUB_OUTPUT, `pushed=${pushed}\n`);
        }
        return 0;
      }
      case 'open-pr':
        openPr(c);
        return 0;
      case 'attempts':
        for (const a of attempts(c)) say(c, `${a.platform} ${a.slug}`);
        return 0;
      case 'clear':
        if (rest.length !== 2) throw new DataBranchError('usage: clear <platform> <slug>');
        clear(c, rest[0], rest[1]);
        say(c, `cleared ${rest[0]} ${rest[1]}`);
        return 0;
      default:
        throw new DataBranchError('usage: databranch.ts sync | save <message> <path>… | open-pr | attempts | clear <platform> <slug>');
    }
  } catch (e) {
    console.error(`::error::${(e as Error).message}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
