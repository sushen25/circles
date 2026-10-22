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
import { appendFileSync, existsSync, rmSync } from 'node:fs';
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

/** The bot's name on the commits it makes, passed per command so a clone's own git config (the founder's) is never touched. */
const WHO = {
  GIT_AUTHOR_NAME: 'wenna-content bot',
  GIT_AUTHOR_EMAIL: 'bot@wenna.app',
  GIT_COMMITTER_NAME: 'wenna-content bot',
  GIT_COMMITTER_EMAIL: 'bot@wenna.app',
};

function exec(cmd: string, args: string[], cwd: string, extra: Record<string, string> = {}): Out {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no', LC_ALL: 'C', ...extra },
  });
  if (r.error) throw new DataBranchError(`${cmd} ${args.join(' ')}: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: (r.stderr ?? '').trim() };
}

const remoteOf = (c: Ctx) => c.remote ?? 'origin';
const say = (c: Ctx, line: string) => (c.log ?? console.log)(line);

function git(c: Ctx, args: string[], extra?: Record<string, string>): Out {
  return exec('git', args, c.cwd, extra);
}

/** A git command that has to succeed; the message says which one did not. */
function must(c: Ctx, args: string[]): string {
  const r = git(c, args);
  if (r.status !== 0) throw new DataBranchError(`git ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout.trim()}`);
  return r.stdout;
}

const isAncestor = (c: Ctx, a: string, b: string) => git(c, ['merge-base', '--is-ancestor', a, b]).status === 0;

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
 * `main` merged in locally, so a run sees every row and ledger line the earlier
 * runs wrote that are not on `main` yet, and every queue file that is. The
 * merge is never pushed: see `save`.
 */
export function sync(c: Ctx): 'fresh' | 'merged' | 'continued' {
  const hasBranch = remoteHasBranch(c);
  const r = remoteOf(c);
  const refs = [`+refs/heads/${MAIN}:refs/remotes/${r}/${MAIN}`];
  if (hasBranch) refs.push(`+refs/heads/${BRANCH}:refs/remotes/${r}/${BRANCH}`);
  must(c, ['fetch', '--quiet', r, ...refs]);
  // Where the branch stood when this run began, so `save` can say whether the run moved it.
  must(c, ['update-ref', SYNCED, must(c, ['rev-parse', hasBranch ? `${r}/${BRANCH}` : `${r}/${MAIN}`]).trim()]);
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
  const m = git(c, ['merge', '--no-edit', '-m', `content: merge ${MAIN} into ${BRANCH}`, `${r}/${MAIN}`], WHO);
  if (m.status !== 0) {
    git(c, ['merge', '--abort']);
    throw new DataBranchError(
      `${MAIN} cannot be merged into ${BRANCH} (${m.stderr || m.stdout.trim()}). If its pull request was squash-merged, merge or delete the ${BRANCH} branch only after checking it holds no rows you still need (hand-claimed ones have no attempt tag), then the next run starts again from ${MAIN}. Nothing was posted.`,
    );
  }
  say(c, `continuing from ${BRANCH} (${must(c, ['rev-list', '--count', `${r}/${MAIN}..HEAD`]).trim()} commits not on ${MAIN})`);
  return 'continued';
}

const SYNCED = 'refs/databranch/synced';
const ZERO = '0'.repeat(40);
const tracked = (c: Ctx, p: string) => existsSync(`${c.cwd}/${p}`) || must(c, ['ls-files', '--', p]).trim() !== '';

/**
 * Commit what changed under `paths` onto the data branch's tip and push it.
 *
 * The commit is built on the remote tip (or on `main` when the branch is new or
 * merged), from that tree plus the working tree's version of `paths` and nothing
 * else, in a temporary index. So what is pushed never contains anything from
 * `main` that the branch did not already have: GitHub refuses a push made with
 * GITHUB_TOKEN that changes `.github/workflows/`, and `main` changes those most
 * weeks. A push that is not a fast-forward is an error: the run's rows are not
 * saved and the job is red (a publish is still held back by its tag).
 * `pushed` says whether the branch is ahead of where this run found it.
 */
export function save(c: Ctx, message: string, paths: string[]): { pushed: boolean } {
  const here = must(c, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (here !== BRANCH) throw new DataBranchError(`save runs on ${BRANCH}, not ${here}; run sync first`);
  const r = remoteOf(c);
  const main = must(c, ['rev-parse', `refs/remotes/${r}/${MAIN}`]).trim();
  const tipRef = `refs/remotes/${r}/${BRANCH}`;
  const tipNow = () => {
    const t = git(c, ['rev-parse', '--verify', '--quiet', tipRef]);
    return t.status === 0 ? t.stdout.trim() : ZERO;
  };
  const moved = () => tipNow() !== ZERO && tipNow() !== must(c, ['rev-parse', SYNCED]).trim();
  const tip = tipNow();
  const parent = tip !== ZERO && !isAncestor(c, tip, main) ? tip : main;

  const index = `${must(c, ['rev-parse', '--git-dir']).trim()}/databranch-index-${process.pid}`;
  const env = { GIT_INDEX_FILE: index.startsWith('/') ? index : `${c.cwd}/${index}`, ...WHO };
  try {
    must2(c, ['read-tree', parent], env);
    const wanted = paths.filter((p) => tracked(c, p));
    if (wanted.length) must2(c, ['add', '-A', '--', ...wanted], env);
    const tree = must2(c, ['write-tree'], env).trim();
    if (tree === must(c, ['rev-parse', `${parent}^{tree}`]).trim()) return { pushed: moved() };
    const commit = must2(c, ['commit-tree', tree, '-p', parent, '-m', message], env).trim();
    const p = git(c, ['push', '--quiet', r, `${commit}:refs/heads/${BRANCH}`]);
    if (p.status !== 0) throw new DataBranchError(`push to ${BRANCH} was rejected (${p.stderr}); this run's rows are not saved`);
    must(c, ['update-ref', tipRef, commit]);
    return { pushed: moved() };
  } finally {
    rmSync(env.GIT_INDEX_FILE, { force: true });
  }
}

function must2(c: Ctx, args: string[], env: Record<string, string>): string {
  const r = git(c, args, env);
  if (r.status !== 0) throw new DataBranchError(`git ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout.trim()}`);
  return r.stdout;
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const tagFor = (platform: string, slug: string) => {
  if (!SAFE.test(platform) || !SAFE.test(slug)) throw new DataBranchError(`"${platform}/${slug}" cannot be recorded as an attempt; refusing to post it`);
  return `${ATTEMPT_PREFIX}/${platform}/${slug}`;
};

/** Record that a post is about to be made. Throws unless the record is on the remote and this run created it. */
export function begin(c: Ctx, platform: string, slug: string) {
  const tag = tagFor(platform, slug);
  // A commit of its own for every attempt: pushing the commit that is already the tag is "up to date" and succeeds, so
  // two runs on the same HEAD would both think they had made it. A different object cannot replace an existing tag.
  const nonce = `${new Date().toISOString()} ${process.pid} ${Math.random()}`;
  // On origin/main, which the remote already has: a commit that is new to it with workflow files in its history is
  // what GITHUB_TOKEN may not push. It has main's own tree, so it changes nothing.
  const main = `refs/remotes/${remoteOf(c)}/${MAIN}`;
  const made = git(c, ['commit-tree', `${main}^{tree}`, '-p', main, '-m', `attempt ${tag} ${nonce}`], WHO);
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
  return all.filter((a) => !ledger.some((l) => String(l.platform) === a.platform && String(l.slug) === a.slug));
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
  // A pull request from a fork whose branch is also called content-data is not ours.
  const list = gh(['pr', 'list', '--head', BRANCH, '--base', MAIN, '--state', 'open', '--json', 'number,isCrossRepository', '--jq', '[.[] | select(.isCrossRepository | not)] | length']);
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
        say(c, pushed ? `${BRANCH} is ahead of where this run found it` : `${BRANCH} did not move`);
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
