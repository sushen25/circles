// `docs/` is read in three places that cannot see each other break: GitHub,
// Obsidian and whoever greps it. This checks the two things only a reader
// would notice — a link to a file that is not there, and an ADR whose
// frontmatter, status line and README row have stopped agreeing. `docs/Home.md`
// has the writing rules; this enforces the ones a script can.
//
// Not checked: `audits/` (git-excluded, so CI never sees it), `_templates/`
// (placeholders by design) and `design/` (generated). Links that leave `docs/`
// are resolved against the repository, so a runbook pointing into `packages/`
// fails here when that file moves, even though Obsidian only ever shows it as
// unresolved. The root Markdown files are checked for links only: the
// Obsidian-specific rules are for the vault.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { INDEX, frontmatter, indexRows, renderIndex } from './adrs.mjs';

const ROOT = process.cwd();
const DOCS = join(ROOT, 'docs');
const ROOT_FILES = ['AGENTS.md', 'README.md', 'CLAUDE.md'];
const SKIP = new Set(['.obsidian', '.trash', 'audits', '_templates', 'design']);
const STATUSES = new Set(['proposed', 'accepted', 'superseded']);
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const problems = [];
const fail = (file, message) => problems.push(`${relative(ROOT, file)}: ${message}`);

function* markdownFiles(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* markdownFiles(path);
    else if (name.endsWith('.md')) yield path;
  }
}

// Fenced and inline code are not prose: a link or a `[[` there is an example.
const withoutCode = (text) => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

function checkLinks(file, text, { vault }) {
  const prose = withoutCode(text);
  let links = 0;
  if (vault && /\[\[[^\]]+\]\]/.test(prose)) {
    fail(file, 'wikilink: GitHub shows it as text (docs/Home.md)');
  }
  if (vault && /^> \[![a-z]+\]/m.test(prose)) {
    fail(file, 'callout: GitHub shows it as a plain quote (docs/Home.md)');
  }
  for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, obsidian:
    const [pathPart, fragment] = target.split('#');
    if (vault && fragment !== undefined) {
      fail(
        file,
        `heading link \`${target}\`: Obsidian and GitHub anchor headings differently (docs/Home.md)`,
      );
    }
    if (!pathPart) continue;
    links += 1;
    const resolved = resolve(dirname(file), decodeURIComponent(pathPart.split('?')[0]));
    if (!existsSync(resolved)) fail(file, `link \`${target}\` points at nothing`);
  }
  return links;
}

const pad = (n) => String(n).padStart(2, '0');

function checkAdrs() {
  const dir = join(DOCS, 'decisions');
  const files = readdirSync(dir)
    .filter((name) => /^\d{4}-.*\.md$/.test(name))
    .sort();
  const numbers = new Set(files.map((name) => Number(name.slice(0, 4))));
  for (const name of files) {
    const file = join(dir, name);
    const text = readFileSync(file, 'utf8');
    const number = Number(name.slice(0, 4));
    const fm = frontmatter(text);
    if (!fm) {
      fail(file, 'no frontmatter; start from docs/_templates/adr.md');
      continue;
    }
    const heading = /^# ADR (\d{4}): (.+)$/m.exec(text);
    const statusLine = /^_Status: (.+)_$/m.exec(text);
    if (!heading) fail(file, 'heading is not `# ADR NNNN: Title`');
    if (!statusLine) fail(file, 'no `_Status: …_` line under the heading');
    if (Number(fm.adr) !== number) fail(file, `frontmatter adr: ${fm.adr}, the file is ${number}`);
    if (heading && fm.title !== heading[2].trim())
      fail(file, 'frontmatter title differs from the heading');
    if (!STATUSES.has(fm.status)) {
      fail(file, `status \`${fm.status}\` is not proposed, accepted or superseded`);
    }
    if (statusLine) {
      const word = statusLine[1].split(/[\s(·]/)[0];
      if (word !== fm.status)
        fail(file, `frontmatter status ${fm.status}, the status line says ${word}`);
      const date =
        /(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/.exec(
          statusLine[1],
        );
      const iso = date ? `${date[3]}-${pad(MONTHS.indexOf(date[2]) + 1)}-${pad(date[1])}` : null;
      if (iso !== fm.date)
        fail(file, `frontmatter date ${fm.date}, the status line says ${iso ?? 'no date'}`);
    }
    for (const key of ['amends', 'amended_by', 'builds_on']) {
      if (fm[key] === undefined) continue;
      if (!Array.isArray(fm[key]) || fm[key].some((n) => !Number.isInteger(n))) {
        fail(file, `${key} must be a list of ADR numbers`);
        continue;
      }
      for (const n of fm[key]) {
        if (!numbers.has(n)) fail(file, `${key} names ADR ${n}, which does not exist`);
      }
    }
  }
  // The index is generated (SUS-228). Rows are compared as a set, in any order:
  // the file merges with `merge=union`, so two branches that each add an ADR
  // meet without a conflict but may leave the rows out of order until the next
  // `pnpm gen:adrs`. A missing, extra or different row is stale.
  const have = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : '';
  const want = renderIndex();
  const sameRows = (a, b) =>
    indexRows(a).slice().sort().join('\n') === indexRows(b).slice().sort().join('\n');
  const header = (text) =>
    text
      .split('\n')
      .filter((line) => !line.startsWith('| ['))
      .join('\n');
  if (!sameRows(have, want) || header(have) !== header(want)) {
    fail(INDEX, 'is stale: run `pnpm gen:adrs` (or `pnpm gen`) and commit the result');
  }
  return files.length;
}

let notes = 0;
let links = 0;
for (const file of markdownFiles(DOCS)) {
  notes += 1;
  links += checkLinks(file, readFileSync(file, 'utf8'), { vault: true });
}
for (const name of ROOT_FILES) {
  const file = join(ROOT, name);
  if (existsSync(file)) links += checkLinks(file, readFileSync(file, 'utf8'), { vault: false });
}
const adrs = checkAdrs();

if (problems.length > 0) {
  for (const problem of problems) console.error(`check:docs: ${problem}`);
  console.error(`check:docs: ${problems.length} problem(s) — docs/Home.md has the rules`);
  process.exit(1);
}
console.log(
  `check:docs: ${notes} notes and ${ROOT_FILES.length} root files, ${links} links resolve, ${adrs} ADRs agree with their status line, and the generated index is current`,
);
