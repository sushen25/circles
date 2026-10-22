import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BRANCH, attempts, begin, clear, openPr, save, sync, unresolved, type Ctx } from './databranch.ts';
import { git, makeOrigin, refuse } from './gitrepo.fixture.ts';

const quiet = () => {};
const ctxOf = (cwd: string, extra: Partial<Ctx> = {}): Ctx => ({ cwd, log: quiet, ...extra });
const row = (n: number) => JSON.stringify({ n }) + '\n';
const mainHead = (o: { path: string }) => git(o.path, 'rev-parse', 'main').trim();

test('a first run starts from main and its rows go to content-data, never to main', () => {
  const o = makeOrigin();
  const before = mainHead(o);
  const a = o.clone();
  assert.equal(sync(ctxOf(a)), 'fresh');
  appendFileSync(join(a, 'analytics/posts.jsonl'), row(1));
  assert.deepEqual(save(ctxOf(a), 'rows', ['analytics']), { pushed: true });
  assert.equal(mainHead(o), before, 'main did not move');
  assert.match(git(o.path, 'show', `${BRANCH}:analytics/posts.jsonl`), /"n":1/);
});

test('nothing to commit is not a push', () => {
  const o = makeOrigin();
  const a = o.clone();
  sync(ctxOf(a));
  assert.deepEqual(save(ctxOf(a), 'rows', ['analytics', 'analytics/series.jsonl']), { pushed: false });
  assert.equal(git(o.path, 'branch', '--list', BRANCH).trim(), '');
});

test('a later run starts from the unmerged data, so it sees the earlier rows and ledger', () => {
  const o = makeOrigin();
  const a = o.clone();
  sync(ctxOf(a));
  writeFileSync(join(a, 'publish/ledger.jsonl'), row(1));
  save(ctxOf(a), 'ledger', ['publish']);

  const b = o.clone();
  assert.equal(sync(ctxOf(b)), 'continued');
  assert.equal(readFileSync(join(b, 'publish/ledger.jsonl'), 'utf8'), row(1));
});

test('main moving on (a merged queue file) is merged into the data branch', () => {
  const o = makeOrigin();
  const a = o.clone();
  sync(ctxOf(a));
  appendFileSync(join(a, 'analytics/posts.jsonl'), row(1));
  save(ctxOf(a), 'rows', ['analytics']);

  const human = o.clone();
  writeFileSync(join(human, 'queue/2026-10-23-new.md'), 'x');
  git(human, 'add', '-A');
  git(human, '-c', 'user.name=h', '-c', 'user.email=h@example.com', 'commit', '-q', '-m', 'new piece');
  git(human, 'push', '-q', 'origin', 'main');

  const b = o.clone();
  assert.equal(sync(ctxOf(b)), 'continued');
  assert.ok(existsSync(join(b, 'queue/2026-10-23-new.md')));
  assert.match(readFileSync(join(b, 'analytics/posts.jsonl'), 'utf8'), /"n":1/);
});

test('once the data pull request is merged, the next run starts again from main', () => {
  const o = makeOrigin();
  const a = o.clone();
  sync(ctxOf(a));
  appendFileSync(join(a, 'analytics/posts.jsonl'), row(1));
  save(ctxOf(a), 'rows', ['analytics']);

  const founder = o.clone();
  git(founder, 'fetch', '-q', 'origin', BRANCH);
  git(founder, '-c', 'user.name=f', '-c', 'user.email=f@example.com', 'merge', '--no-ff', '-q', '-m', 'merge data', `origin/${BRANCH}`);
  git(founder, 'push', '-q', 'origin', 'main');

  const b = o.clone();
  assert.equal(sync(ctxOf(b)), 'merged');
  assert.equal(git(b, 'rev-parse', 'HEAD').trim(), mainHead(o));
  appendFileSync(join(b, 'analytics/posts.jsonl'), row(2));
  assert.deepEqual(save(ctxOf(b), 'rows', ['analytics']), { pushed: true });
});

test('a main that cannot merge into the data branch stops the run and says how to recover', () => {
  const o = makeOrigin();
  const q = 'queue/2026-10-22-test-piece.md';
  const a = o.clone();
  sync(ctxOf(a));
  writeFileSync(join(a, q), 'ours\n');
  save(ctxOf(a), 'move', ['queue']);
  const human = o.clone();
  writeFileSync(join(human, q), 'theirs\n');
  git(human, '-c', 'user.name=h', '-c', 'user.email=h@example.com', 'commit', '-qam', 'edit');
  git(human, 'push', '-q', 'origin', 'main');
  const b = o.clone();
  assert.throws(() => sync(ctxOf(b)), /Nothing was posted/);
});

test('an unreachable remote is an error, not an empty branch', () => {
  const o = makeOrigin();
  const a = o.clone();
  git(a, 'remote', 'set-url', 'origin', join(o.path, 'does-not-exist'));
  assert.throws(() => sync(ctxOf(a)), /cannot reach/);
  assert.throws(() => attempts(ctxOf(a)), /cannot list the attempts/);
});

test('a push that is not a fast-forward fails the run instead of overwriting what is there', () => {
  const o = makeOrigin();
  const a = o.clone();
  const b = o.clone();
  sync(ctxOf(a));
  sync(ctxOf(b));
  appendFileSync(join(a, 'analytics/posts.jsonl'), row(1));
  save(ctxOf(a), 'a', ['analytics']);
  appendFileSync(join(b, 'publish/ledger.jsonl'), row(2));
  assert.throws(() => save(ctxOf(b), 'b', ['publish']), /rejected/);
  assert.match(git(o.path, 'show', `${BRANCH}:analytics/posts.jsonl`), /"n":1/);
});

test('a remote that refuses the branch fails the run', () => {
  const o = makeOrigin();
  const c = o.clone();
  sync(ctxOf(c));
  refuse(o, `refs/heads/${BRANCH}`);
  writeFileSync(join(c, 'publish/ledger.jsonl'), row(3));
  assert.throws(() => save(ctxOf(c), 'c', ['publish']), /rejected/);
});

test('main changing a workflow file never puts it in a data push (GITHUB_TOKEN may not push those)', () => {
  const o = makeOrigin();
  const a = o.clone();
  sync(ctxOf(a));
  appendFileSync(join(a, 'analytics/posts.jsonl'), row(1));
  save(ctxOf(a), 'rows', ['analytics']);
  const tipBefore = git(o.path, 'rev-parse', BRANCH).trim();

  const human = o.clone();
  mkdirSync(join(human, '.github/workflows'), { recursive: true });
  writeFileSync(join(human, '.github/workflows/x.yml'), 'name: x\n');
  git(human, 'add', '-A');
  git(human, '-c', 'user.name=h', '-c', 'user.email=h@example.com', 'commit', '-q', '-m', 'workflow');
  git(human, 'push', '-q', 'origin', 'main');

  const b = o.clone();
  assert.equal(sync(ctxOf(b)), 'continued');
  assert.ok(existsSync(join(b, '.github/workflows/x.yml')), 'the run itself has main\'s files');
  appendFileSync(join(b, 'analytics/posts.jsonl'), row(2));
  assert.deepEqual(save(ctxOf(b), 'rows', ['analytics']), { pushed: true });
  assert.equal(git(o.path, 'diff', '--name-only', tipBefore, BRANCH).trim(), 'analytics/posts.jsonl');
  assert.match(git(o.path, 'show', `${BRANCH}:analytics/posts.jsonl`), /"n":1[\s\S]*"n":2/);
});

test('the bot never changes the clone\'s own git identity', () => {
  const o = makeOrigin();
  const a = o.clone();
  sync(ctxOf(a));
  appendFileSync(join(a, 'analytics/posts.jsonl'), row(1));
  save(ctxOf(a), 'rows', ['analytics']);
  begin(ctxOf(a), 'bluesky', 'test-piece');
  assert.equal(spawnSync('git', ['config', '--local', '--get', 'user.name'], { cwd: a }).stdout.toString().trim(), '');
  assert.equal(git(o.path, 'log', '-1', '--format=%an', BRANCH).trim(), 'wenna-content bot');
});

test('a human and a bot appending to the same ledger do not conflict', () => {
  const o = makeOrigin();
  const a = o.clone();
  sync(ctxOf(a));
  appendFileSync(join(a, 'publish/ledger.jsonl'), row(1));
  save(ctxOf(a), 'bot', ['publish']);
  const human = o.clone();
  appendFileSync(join(human, 'publish/ledger.jsonl'), row(2));
  git(human, 'add', '-A');
  git(human, '-c', 'user.name=h', '-c', 'user.email=h@example.com', 'commit', '-q', '-m', 'claim');
  git(human, 'push', '-q', 'origin', 'main');
  const b = o.clone();
  assert.equal(sync(ctxOf(b)), 'continued');
  assert.match(readFileSync(join(b, 'publish/ledger.jsonl'), 'utf8'), /"n":1[\s\S]*"n":2|"n":2[\s\S]*"n":1/);
});

test('pushed says whether the branch moved during the run, even when the last save had nothing to add', () => {
  const o = makeOrigin();
  const a = o.clone();
  sync(ctxOf(a));
  assert.deepEqual(save(ctxOf(a), 'none', ['analytics']), { pushed: false });
  appendFileSync(join(a, 'analytics/posts.jsonl'), row(1));
  save(ctxOf(a), 'one', ['analytics']);
  assert.deepEqual(save(ctxOf(a), 'again', ['analytics']), { pushed: true });
});

test('save refuses to run anywhere but the data branch', () => {
  const o = makeOrigin();
  const a = o.clone();
  sync(ctxOf(a));
  git(a, 'checkout', '-q', 'main');
  appendFileSync(join(a, 'analytics/posts.jsonl'), row(1));
  assert.throws(() => save(ctxOf(a), 'rows', ['analytics']), /run sync first/);
  assert.equal(git(o.path, 'rev-parse', 'main').trim(), mainHead(o));
});

test('an attempt can be recorded once, and only once, on the remote', () => {
  const o = makeOrigin();
  const a = o.clone();
  const b = o.clone();
  begin(ctxOf(a), 'bluesky', 'test-piece');
  assert.throws(() => begin(ctxOf(b), 'bluesky', 'test-piece'), /posting nothing/);
  begin(ctxOf(b), 'threads', 'test-piece');
  assert.deepEqual(attempts(ctxOf(b)).map((x) => `${x.platform}/${x.slug}`).sort(), ['bluesky/test-piece', 'threads/test-piece']);
});

test('an attempt the ledger has no row for is unresolved, until it is cleared', () => {
  const o = makeOrigin();
  const a = o.clone();
  begin(ctxOf(a), 'bluesky', 'test-piece');
  const open = unresolved(attempts(ctxOf(a)), []);
  assert.equal(open.length, 1);
  assert.equal(unresolved(attempts(ctxOf(a)), [{ platform: 'bluesky', slug: 'test-piece' }]).length, 0);
  clear(ctxOf(a), 'bluesky', 'test-piece');
  assert.equal(attempts(ctxOf(a)).length, 0);
});

test('a name that is not a plain slug cannot be recorded, so it cannot be posted', () => {
  const o = makeOrigin();
  const a = o.clone();
  assert.throws(() => begin(ctxOf(a), 'bluesky', 'a b'), /refusing to post/);
  assert.throws(() => begin(ctxOf(a), 'bluesky', '../x'), /refusing to post/);
});

test('open-pr opens the pull request when there is none and starts check on its head', () => {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    calls.push(args);
    return args[0] === 'pr' && args[1] === 'list' ? { status: 0, stdout: '0\n', stderr: '' } : { status: 0, stdout: 'https://example/pr/1\n', stderr: '' };
  };
  openPr(ctxOf('.', { gh }), 'o/r');
  assert.deepEqual(calls.map((c) => c.slice(0, 2).join(' ')), ['pr list', 'pr create', 'workflow run']);
  assert.deepEqual(calls[2], ['workflow', 'run', 'check.yml', '--ref', BRANCH]);
  assert.ok(calls[1].includes('main') && calls[1].includes(BRANCH));
});

test('open-pr does not open a second pull request', () => {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    calls.push(args);
    return { status: 0, stdout: args[1] === 'list' ? '1\n' : '', stderr: '' };
  };
  openPr(ctxOf('.', { gh }), 'o/r');
  assert.deepEqual(calls.map((c) => c[1]), ['list', 'run']);
});

test('when Actions may not open pull requests it warns with the link and the setting, and does not fail', () => {
  const lines: string[] = [];
  const gh = (args: string[]) =>
    args[1] === 'list'
      ? { status: 0, stdout: '0\n', stderr: '' }
      : args[1] === 'create'
        ? { status: 1, stdout: '', stderr: 'GitHub Actions is not permitted to create or approve pull requests' }
        : { status: 0, stdout: '', stderr: '' };
  openPr({ cwd: '.', gh, log: (l) => lines.push(l) }, 'o/r');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^::warning::/);
  assert.match(lines[0], /Allow GitHub Actions to create and approve pull requests/);
  assert.match(lines[0], /github\.com\/o\/r\/compare\/main\.\.\.content-data/);
});
