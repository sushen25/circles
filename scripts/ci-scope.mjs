#!/usr/bin/env node
/**
 * Decides whether a set of changed files can affect anything `pnpm check`
 * tests. Reads paths on stdin, one per line; prints `prose` or `code`.
 *
 * `prose` is deliberately narrow: Markdown anywhere, and `.claude/`. It is
 * tempting to add `docs/`, and wrong — `docs/design/gen.py` is the source the
 * design tokens are generated from, and the `.dc.html` artboards are generated
 * from it, so `check:tokens` reads both. A path is only prose if no check
 * opens it.
 *
 * Root Markdown is prose but not exempt from everything: `AGENTS.md`,
 * `README.md` and `CLAUDE.md` are formatted by Prettier (`docs/` is not), so
 * the caller still runs `format:check` on a prose change. Prose skips the
 * suites, not the gate.
 *
 * Anything unrecognised is `code`. The cost of being wrong that way is a slow
 * run; the other way it is a broken main.
 */

const PROSE = [/\.md$/i, /^\.claude\//];

const input = await new Promise((resolve) => {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (buffer += chunk));
  process.stdin.on('end', () => resolve(buffer));
});

const files = input
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

// No diff at all means we could not work out what changed — a re-run, a merge
// commit, a shallow clone. Run everything rather than guess.
if (files.length === 0) {
  console.log('code');
  process.exit(0);
}

const codeFiles = files.filter((file) => !PROSE.some((pattern) => pattern.test(file)));

if (codeFiles.length > 0) {
  console.error(
    `ci-scope: ${codeFiles.length} non-prose file(s), e.g. ${codeFiles.slice(0, 3).join(', ')}`,
  );
  console.log('code');
} else {
  console.error(`ci-scope: ${files.length} file(s), all prose`);
  console.log('prose');
}
