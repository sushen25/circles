/** Real git for the tests: a bare origin, and clones of it that stand in for the runner's checkout. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

export const QUEUE_FILE = `---
slug: test-piece
date: 2026-10-22
family: x
hook: "A hook"
status: approved
platforms: [bluesky]
publish_at: 2026-10-22T08:00:00Z
publish_window_minutes: 0
media: none
---

## bluesky

> A plain caption for the test.
`;

export type Origin = { path: string; clone: () => string };

/** A bare origin whose `main` holds one approved queue file and an empty ledger. */
export function makeOrigin(): Origin {
  const root = mkdtempSync(join(tmpdir(), 'databranch-'));
  const path = join(root, 'origin.git');
  git(root, 'init', '--bare', '-q', '-b', 'main', path);
  const seed = join(root, 'seed');
  git(root, 'clone', '-q', path, seed);
  git(seed, 'config', 'user.name', 'seed');
  git(seed, 'config', 'user.email', 'seed@example.com');
  mkdirSync(join(seed, 'queue'));
  mkdirSync(join(seed, 'publish'));
  mkdirSync(join(seed, 'analytics'));
  writeFileSync(join(seed, 'queue', '2026-10-22-test-piece.md'), QUEUE_FILE);
  writeFileSync(join(seed, 'publish', 'ledger.jsonl'), '');
  writeFileSync(join(seed, 'analytics', 'posts.jsonl'), '');
  writeFileSync(join(seed, '.gitattributes'), '*.jsonl merge=union\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'push', '-q', 'origin', 'main');
  let n = 0;
  return {
    path,
    clone: () => {
      const dir = join(root, `clone-${++n}`);
      git(root, 'clone', '-q', path, dir);
      return dir;
    },
  };
}

/** Make the origin refuse a ref pattern, the way a protected branch or an outage would. */
export function refuse(origin: Origin, pattern: string) {
  const hook = join(origin.path, 'hooks', 'pre-receive');
  writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do case "$ref" in ${pattern}) echo "refused $ref" >&2; exit 1;; esac; done\n`, { mode: 0o755 });
}
