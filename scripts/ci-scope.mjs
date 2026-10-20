#!/usr/bin/env node
/**
 * Decides whether a set of changed files can affect anything `pnpm check`
 * tests. Reads paths on stdin, one per line; prints `prose` or `code`.
 *
 * `prose` is deliberately narrow: Markdown anywhere, and nothing else. That
 * includes `.claude/`: the Markdown in it is prose, but `.claude/skills/**\/*.sh`
 * and the JSON beside them run on the founder's machine with `gh` and Supabase
 * credentials, so a change to one is code and gets the suites. It is also
 * tempting to add `docs/`, and wrong — `docs/design/gen.py` is the source the
 * design tokens are generated from, and the `.dc.html` artboards are generated
 * from it, so `check:tokens` reads both. A path is only prose if no check
 * opens it.
 *
 * Root Markdown is prose but not exempt from everything: `AGENTS.md`,
 * `README.md` and `CLAUDE.md` are formatted by Prettier (`docs/` is not), and
 * `check:docs` reads every link, and `check-unimported` reads them for the
 * scripts they name, so the caller still runs all three on a prose change.
 * Prose skips the suites, not the gate. `content/` is prose for the same
 * reason `.md` is: no check opens it (see the note above `PROSE`).
 *
 * Anything unrecognised is `code`. The cost of being wrong that way is a slow
 * run; the other way it is a broken main.
 */

// `content/` is the content loop (content/CLAUDE.md): its own npm project
// outside the pnpm workspace, with its own `npm run check`, ignored by
// Prettier, ESLint and `check:brand`, so nothing `pnpm check` opens lives
// there. Its bot commits a ledger line most evenings; the gate for each would
// be thirty minutes to verify nothing. Its two workflows are still read by
// `check:workflows`, which runs on every change.
const PROSE = [/\.md$/i, /^content\//];

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
