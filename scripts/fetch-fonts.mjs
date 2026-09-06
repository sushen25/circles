/**
 * Downloads the two bundled typefaces into `packages/tokens/assets/fonts/`.
 *
 * Run rarely — only to add a weight or take a font upgrade. The files are
 * committed, because the app must render correctly offline and in an export
 * (design manifesto §5.2), and because a build should not depend on Google
 * being reachable.
 *
 * Why it looks like this: `github.com/google/fonts` now ships only variable
 * fonts, and React Native does not select variable axes reliably — 500 and 600
 * would render at 400. The CSS API still serves per-weight static TTFs, but
 * only to a user agent old enough to predate woff, hence the legacy UA below.
 * The modern `css2` endpoint returns woff subsetted by unicode-range, which
 * native cannot load at all.
 *
 * Run: node scripts/fetch-fonts.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/tokens/assets/fonts');

// Android 2.3: no woff support, so the API answers with plain TrueType.
const LEGACY_UA =
  'Mozilla/5.0 (Linux; U; Android 2.3.7; en-us; Nexus One Build/FRF91) ' +
  'AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1';

/** Weight → file name. The names match what `fonts.ts` registers. */
const FAMILIES = [
  {
    family: 'Figtree',
    query: 'Figtree:400,500,600',
    weights: { 400: 'Regular', 500: 'Medium', 600: 'SemiBold' },
  },
  { family: 'Newsreader', query: 'Newsreader:400', weights: { 400: 'Regular' } },
];

async function get(url, accept) {
  const response = await fetch(url, { headers: { 'User-Agent': LEGACY_UA, Accept: accept } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response;
}

mkdirSync(OUT, { recursive: true });

for (const { family, query, weights } of FAMILIES) {
  const css = await (
    await get(`https://fonts.googleapis.com/css?family=${query}`, 'text/css')
  ).text();

  // Each @font-face block carries one weight and one .ttf url.
  const faces = [...css.matchAll(/font-weight:\s*(\d+);\s*src:\s*url\((https:[^)]+\.ttf)\)/g)];
  const expected = Object.keys(weights).length;
  if (faces.length !== expected) {
    throw new Error(
      `fetch-fonts: expected ${expected} static TTF face(s) for ${family}, got ${faces.length}. ` +
        'The Fonts API changed what it serves — check the CSS by hand before trusting this script.',
    );
  }

  for (const [, weight, url] of faces) {
    const style = weights[weight];
    if (!style) throw new Error(`fetch-fonts: unexpected weight ${weight} for ${family}`);
    const bytes = Buffer.from(await (await get(url, 'font/ttf')).arrayBuffer());
    // A TrueType file starts with 0x00010000; anything else means we were
    // served woff/woff2 despite the user agent.
    if (bytes.readUInt32BE(0) !== 0x00010000) {
      throw new Error(`fetch-fonts: ${url} is not a TrueType file (bad magic number)`);
    }
    const name = `${family}-${style}.ttf`;
    writeFileSync(join(OUT, name), bytes);
    console.log(`  ${name.padEnd(26)} ${String(Math.round(bytes.length / 1024)).padStart(4)} KB`);
  }

  const licence = await (
    await get(
      `https://raw.githubusercontent.com/google/fonts/main/ofl/${family.toLowerCase()}/OFL.txt`,
      'text/plain',
    )
  ).text();
  writeFileSync(join(OUT, `OFL-${family}.txt`), licence);
  console.log(`  OFL-${family}.txt`);
}

console.log('fetch-fonts: done — files are committed, see packages/tokens/assets/fonts/');
