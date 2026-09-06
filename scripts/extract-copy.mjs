/**
 * Seeds `apps/app/src/copy/en.ts` from the design canvas.
 *
 * Run once per batch of new artboards, then edit the result by hand — this is
 * a starting point, not a generator. The canvas is the authority for *what the
 * product says*; `en.ts` becomes the authority for the strings themselves the
 * moment a screen is built against it, because copy gets revised in code
 * review long before the artboards catch up.
 *
 * It therefore refuses to overwrite the file once it exists, unless forced.
 *
 * Run: node scripts/extract-copy.mjs
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';

const DESIGN = 'docs/design';
const TARGET = 'apps/app/src/copy/en.ts';

/**
 * The canvas writes the product's name and domain out in full. Copy must not:
 * §5.4 promises that renaming is a change to `brand.ts` plus store
 * submissions, and a thousand hard-coded display names would make that a lie.
 * They become placeholders that `t()` fills from `@circles/config`.
 */
const BRAND_SUBSTITUTIONS = [
  [/\bcircles\.app\b/g, '{domain}'],
  [/\bCircles\b/g, '{brand}'],
];

function deBrand(text) {
  return BRAND_SUBSTITUTIONS.reduce((out, [pattern, token]) => out.replace(pattern, token), text);
}

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&mdash;': '—',
  '&ndash;': '–',
  '&nbsp;': ' ',
  '&times;': '×',
  '&hellip;': '…',
};

function textNodes(html) {
  const body = html
    .replace(/<helmet>[\s\S]*?<\/helmet>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ');

  return body
    .split(/<[^>]*>/)
    .map((raw) =>
      raw
        .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e)
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

/** A key that reads like the string it holds, so a diff is legible. */
function slug(text) {
  const base = text
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .split('_')
    .slice(0, 7)
    .join('_');
  return base || 'text';
}

const screens = {};
for (const file of readdirSync(DESIGN)
  .filter((f) => f.endsWith('.dc.html'))
  .sort()) {
  const screen = file.replace(/\.dc\.html$/, '');
  const seen = new Map();
  for (const text of textNodes(readFileSync(`${DESIGN}/${file}`, 'utf8'))) {
    // Bare punctuation and lone digits are layout, not copy; a single letter
    // is a member's initial on a mark, which is data.
    if (!/[a-z]/i.test(text)) continue;
    if (text.length < 2) continue;
    const copy = deBrand(text);
    if (seen.has(copy)) continue;
    let key = slug(copy);
    let n = 2;
    while ([...seen.values()].includes(key)) key = `${slug(copy)}_${n++}`;
    seen.set(copy, key);
  }
  if (seen.size > 0) screens[screen] = seen;
}

// Copy is revised in code review long after the artboards are drawn, so
// re-running must never silently discard those edits.
if (existsSync(TARGET) && !process.argv.includes('--force')) {
  console.error(
    `extract-copy: ${TARGET} already exists.\n` +
      'Re-seeding would discard any copy revised since. Pass --force if that is what you want,\n' +
      "or add the new screen's strings by hand.",
  );
  process.exit(1);
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** Times and dates make keys that start with a digit, which need quoting. */
const propertyName = (k) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : quote(k));
const camel = (s) => s[0].toLowerCase() + s.slice(1);

const blocks = Object.entries(screens).map(([screen, strings]) => {
  const lines = [...strings.entries()].map(
    ([text, key]) => `    ${propertyName(key)}: ${quote(text)},`,
  );
  return `  ${camel(screen)}: {\n${lines.join('\n')}\n  },`;
});

const total = Object.values(screens).reduce((n, s) => n + s.size, 0);

writeFileSync(
  TARGET,
  `/**
 * Every user-facing string, keyed by screen.
 *
 * No literal ever goes in a component: \`no-literal-jsx-strings\` fails the
 * build for one (architecture §11). Seeded from the design canvas by
 * \`node scripts/extract-copy.mjs\`, then revised here — once a screen is built
 * against a key, this file is the authority for the words, not the artboard.
 *
 * The voice rules are linted, not just documented: no exclamation marks outside
 * the confirmation, and none of the scoreboard vocabulary the manifesto rules
 * out (\`copy-voice\`, design manifesto §4).
 *
 * Seeded with ${total} strings across ${Object.keys(screens).length} screens.
 * Some are still fixture text from the artboards — names, venues, circle names.
 * Those move to \`tests/fixtures\` as S0-08 builds the screens that use them.
 */
export const en = {
${blocks.join('\n')}
} as const;

export type Copy = typeof en;
export type Screen = keyof Copy;
`,
);

console.log(`extract-copy: ${total} strings across ${Object.keys(screens).length} screens`);
