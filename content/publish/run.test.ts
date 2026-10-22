/**
 * The publisher never posts twice (ADR 0089). Every test drives the real loop
 * and the real journal against real git (a bare origin and clones of it as the
 * runner's checkouts), with a fake adapter that counts the posts it is asked
 * for. Nothing here touches the network, and nothing is posted anywhere.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { sync, clear, type Ctx } from '../lib/databranch.ts';
import { git, makeOrigin, refuse, type Origin } from '../lib/gitrepo.fixture.ts';
import { gitJournal, runPublish, type Journal } from './run.ts';

const here = process.cwd();
after(() => process.chdir(here));
const NOW = new Date('2026-10-22T09:00:00Z');

function counter(fail = false) {
  const c = { posts: 0, adapters: { bluesky: async () => (c.posts++, fail ? Promise.reject(new Error('503 from the platform')) : 'at://post/1') } };
  return c;
}

/** One run, the way the workflow does it: a fresh checkout, `sync`, then the publisher. */
async function run(o: Origin, adapters: Record<string, never> | object, wrap: (j: Journal) => Journal = (j) => j) {
  const dir = o.clone();
  const ctx: Ctx = { cwd: dir, log: () => {} };
  sync(ctx);
  process.chdir(dir);
  const lines: string[] = [];
  const code = await runPublish(
    { dry: false, now: false },
    { adapters: adapters as never, journal: wrap(gitJournal(ctx)), now: NOW, log: (l) => lines.push(l), error: (l) => lines.push(l) },
  );
  return { code, lines: lines.join('\n'), dir, ctx };
}

test('a piece is posted once, and the run after it posts nothing', async () => {
  const o = makeOrigin();
  const c = counter();
  const first = await run(o, c.adapters);
  assert.equal(first.code, 0);
  assert.equal(c.posts, 1);
  const again = await run(o, c.adapters);
  assert.equal(again.code, 0);
  assert.equal(c.posts, 1, 'the ledger on the data branch, not main, kept the second run from posting');
  assert.match(git(o.path, 'show', 'content-data:publish/ledger.jsonl'), /"slug":"test-piece"/);
  assert.equal(git(o.path, 'rev-parse', 'main').trim(), git(first.dir, 'rev-parse', 'origin/main').trim(), 'main was never pushed to');
});

test('the push of the ledger is rejected after a real post: the next run, from a clean checkout, posts nothing and goes red', async () => {
  const o = makeOrigin();
  const c = counter();
  refuse(o, 'refs/heads/content-data');
  const first = await run(o, c.adapters);
  assert.equal(c.posts, 1);
  assert.match(first.lines, /post {2}2026-10-22-test-piece\.md → bluesky/);

  const second = await run(o, c.adapters);
  assert.equal(c.posts, 1, 'no second post');
  assert.equal(second.code, 1, 'red');
  assert.match(second.lines, /BLOCKED bluesky test-piece/);
});

test('the data branch cannot be reached: nothing is posted and the run fails', async () => {
  const o = makeOrigin();
  const c = counter();
  const dir = o.clone();
  sync({ cwd: dir, log: () => {} });
  process.chdir(dir);
  git(dir, 'remote', 'set-url', 'origin', join(o.path, 'gone'));
  await assert.rejects(
    runPublish({ dry: false, now: false }, { adapters: c.adapters as never, journal: gitJournal({ cwd: dir }), now: NOW, log: () => {}, error: () => {} }),
    /cannot list the attempts/,
  );
  assert.equal(c.posts, 0);
});

test('the attempt cannot be recorded (tags refused): nothing is posted and the run fails', async () => {
  const o = makeOrigin();
  const c = counter();
  refuse(o, 'refs/tags/*');
  await assert.rejects(run(o, c.adapters), /cannot record the attempt/);
  assert.equal(c.posts, 0);
});

test('the previous run went red mid-post: the next run posts nothing until a person has looked', async () => {
  const o = makeOrigin();
  const c = counter(true);
  const first = await run(o, c.adapters);
  assert.equal(first.code, 1);
  assert.equal(c.posts, 1);
  const second = await run(o, c.adapters);
  assert.equal(second.code, 1);
  assert.equal(c.posts, 1, 'the platform may have taken it; no retry');
  assert.match(second.lines, /BLOCKED bluesky test-piece[\s\S]*npm run attempt -- clear bluesky test-piece/);
});

test('after a person clears an attempt that did not go out, the piece is tried again', async () => {
  const o = makeOrigin();
  const c = counter(true);
  const first = await run(o, c.adapters);
  clear({ cwd: first.dir, log: () => {} }, 'bluesky', 'test-piece');
  const ok = counter();
  const third = await run(o, ok.adapters);
  assert.equal(third.code, 0);
  assert.equal(ok.posts, 1);
});

test('two runs at once: the one that is second to record its attempt posts nothing', async () => {
  const o = makeOrigin();
  const c = counter();
  // B starts from a checkout made before A did anything, and its listing of attempts is taken before A records one.
  const b = o.clone();
  sync({ cwd: b, log: () => {} });
  const staleView = (j: Journal): Journal => ({ ...j, attempts: () => [] });

  const a = await run(o, c.adapters);
  assert.equal(a.code, 0);
  assert.equal(c.posts, 1);

  process.chdir(b);
  await assert.rejects(
    runPublish({ dry: false, now: false }, { adapters: c.adapters as never, journal: staleView(gitJournal({ cwd: b })), now: NOW, log: () => {}, error: () => {} }),
    /cannot record the attempt/,
  );
  assert.equal(c.posts, 1, 'one post in all');
});

test('while A is mid-post, a run that starts then posts nothing', async () => {
  const o = makeOrigin();
  let inner: { code: number; lines: string } | undefined;
  const c = { posts: 0 };
  const adapters = {
    bluesky: async () => {
      c.posts++;
      const cwd = process.cwd();
      const other = counter();
      inner = await run(o, other.adapters);
      assert.equal(other.posts, 0);
      process.chdir(cwd);
      return 'at://post/1';
    },
  };
  await run(o, adapters);
  assert.equal(c.posts, 1);
  assert.equal(inner?.code, 1);
  assert.match(inner?.lines ?? '', /BLOCKED/);
});

test('a ledger row without an attempt, or an attempt with a ledger row, is not blocked: only the gap is', async () => {
  const o = makeOrigin();
  const c = counter();
  await run(o, c.adapters);
  const after = await run(o, c.adapters);
  assert.equal(after.code, 0);
  assert.doesNotMatch(after.lines, /BLOCKED/);
  assert.match(readFileSync(join(after.dir, 'publish/ledger.jsonl'), 'utf8'), /test-piece/);
});

test('a dry run needs no remote and records nothing', async () => {
  const o = makeOrigin();
  const dir = o.clone();
  process.chdir(dir);
  git(dir, 'remote', 'remove', 'origin');
  const c = counter();
  const lines: string[] = [];
  const code = await runPublish(
    { dry: true, now: false },
    {
      adapters: c.adapters as never,
      journal: { attempts: () => assert.fail('dry run listed attempts'), begin: () => assert.fail('dry run recorded an attempt'), record: () => assert.fail('dry run saved') },
      now: NOW,
      log: (l) => lines.push(l),
      error: (l) => lines.push(l),
    },
  );
  assert.equal(code, 0);
  assert.equal(c.posts, 0);
  assert.match(lines.join('\n'), /would 2026-10-22-test-piece\.md → bluesky/);
});
