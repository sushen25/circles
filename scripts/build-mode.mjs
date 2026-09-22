// Which build is in `apps/app/dist`, written next to it and served with it.
//
// One export directory serves three masters: `make dev-live`, the live e2e
// suite, and the smoke suite — and the smoke suite exports with the Supabase
// variables deliberately blank, because a fixture journey that could reach a
// backend is not a fixture journey. So whichever ran last owns the directory,
// and nothing on screen says which.
//
// That is not a theoretical collision. It has now cost two afternoons: a plan
// link that "let anybody straight into the editor without asking for a name"
// (the fixture build, no backend, so no membership gate), and a check whose
// ninety live tests all failed against a server Playwright had reused from a
// dev session (the same fixture build again).
//
// A marker cannot stop the overwrite — `expo serve` needs a real project root,
// so the two builds cannot live in separate directories without a second
// project — but it makes the overwrite *loud*: the dev server exits when its
// build is taken, and a suite refuses to run against somebody else's.
//
//   node scripts/build-mode.mjs write live
//   node scripts/build-mode.mjs read            → prints `live`, or `none`
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Inside `client/`, so `expo serve` serves it and a suite can fetch it. */
export const MARKER = join(root, 'apps/app/dist/client/build-mode.json');

export const MODES = ['live', 'smoke'];

export function writeMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`build-mode: not a mode: ${mode}`);
  mkdirSync(dirname(MARKER), { recursive: true });
  writeFileSync(MARKER, `${JSON.stringify({ mode, at: new Date().toISOString() })}\n`);
  return mode;
}

/** The mode on disk, or `none` when nothing has been exported yet. */
export function readMode() {
  try {
    return JSON.parse(readFileSync(MARKER, 'utf8')).mode ?? 'none';
  } catch {
    return 'none';
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, mode] = process.argv.slice(2);
  if (command === 'write') writeMode(mode);
  else if (command === 'read') console.log(readMode());
  else {
    console.error('usage: build-mode.mjs write <live|smoke> | read');
    process.exit(2);
  }
}
