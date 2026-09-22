// Export the web app pointed at the local stack, then serve it (S1-24).
//
// `playwright.live.config.ts` runs this as its web server. The smoke suite
// exports with no backend at all, which is what keeps its fixture journey
// honest; this one needs the opposite, so it reads the local URL and
// publishable key from `supabase status` and hands them to `expo export` as
// the `EXPO_PUBLIC_*` variables a deploy would set.
//
// Both suites export into `apps/app/dist`, which `expo serve` reads. They run
// one after the other in `pnpm check`, and each exports before it serves, so
// neither ever serves the other's build.
//
// A *dev* server is the case that broke: it keeps serving that directory while
// a check replaces it underneath, and the smoke export has no backend in it —
// so the app in the browser silently becomes the fixture app, membership gate
// and all. This stamps the build it exported and stops the moment something
// else takes the directory, because a server that has exited is a server you
// can see has exited (`scripts/build-mode.mjs`).
//
//   node scripts/e2e-live-serve.mjs 8082
import { execFileSync, spawn } from 'node:child_process';
import { watchFile } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MARKER, readMode, writeMode } from './build-mode.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.argv[2] ?? '8082';

const raw = execFileSync(join(root, 'node_modules/.bin/supabase'), ['status', '-o', 'json'], {
  cwd: root,
  encoding: 'utf8',
});
const status = JSON.parse(raw.slice(raw.indexOf('{')));
if (!status.API_URL || !status.ANON_KEY) {
  console.error('e2e-live-serve: the local stack is not up — run `pnpm db:start`');
  process.exit(1);
}

const env = {
  ...process.env,
  EXPO_PUBLIC_SUPABASE_URL: status.API_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  EXPO_PUBLIC_APP_ORIGIN: `http://localhost:${port}`,
  // No Turnstile site key: the widget is absent, the client sends no token, and
  // `redeem-invite` skips verification off a hosted project (§14).
  EXPO_PUBLIC_TURNSTILE_SITE_KEY: '',
};

// `--clear`, in both suites. Metro caches transformed modules with the
// `EXPO_PUBLIC_*` values already inlined, and does not key the cache on them —
// so without it, whichever suite exported second served the first one's
// backend (or lack of one). The smoke suite's fixture journey found it.
execFileSync(
  'corepack',
  ['pnpm', '--filter', 'app', 'exec', 'expo', 'export', '--platform', 'web', '--clear'],
  {
    cwd: root,
    env,
    stdio: 'inherit',
  },
);

writeMode('live');

const server = spawn(
  'corepack',
  ['pnpm', '--filter', 'app', 'exec', 'expo', 'serve', '--port', String(port)],
  { cwd: root, env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));

// Polled rather than `fs.watch`: an export replaces the whole directory, and a
// watch on a file inside one that is deleted and rebuilt stops reporting.
watchFile(MARKER, { interval: 1000 }, () => {
  const mode = readMode();
  if (mode === 'live') return;
  console.error(
    `\ne2e-live-serve: apps/app/dist now holds the ${mode} build — something else exported over it.\n` +
      'That build has no backend, so this server would be serving the fixture app.\n' +
      'Stopping. Run `make dev-live` again once the check has finished.\n',
  );
  server.kill('SIGTERM');
  process.exit(1);
});
server.on('exit', (code) => process.exit(code ?? 0));
