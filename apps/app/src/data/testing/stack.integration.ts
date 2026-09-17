import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * The running local stack, for the integration suites (`*.integration.test.ts`).
 *
 * Shared because there are two suites now, and a second copy of "how to read
 * the stack's keys" and "how to wait for a code in Mailpit" is a second copy of
 * the race each comment below describes.
 */

export interface Stack {
  url: string;
  anonKey: string;
  mailpit: string;
  dbUrl: string;
}

/**
 * Read from the running stack, never written down.
 *
 * The local anon key is a published demo value, not a secret — and it is still
 * a JWT, which is why gitleaks refused every commit on a branch once it was
 * pasted into a test. The scan is right to be blunt: a rule that lets a
 * *shaped* credential through because this one happens to be harmless is a
 * rule that lets the next one through too, and the fix for a failing secret
 * scan is never an allowlist. So the values come from `supabase status`, which
 * also means this keeps working if the local keys ever change.
 */
export function readStackConfig(): Stack {
  // The binary directly, not through `pnpm exec`: pnpm runs via corepack here
  // and is not itself on PATH, so spawning it fails with ENOENT. And from
  // `process.cwd()` rather than `import.meta.url`, which Vite rewrites to a
  // `/@fs/...` URL that is not a filesystem path.
  // Assumes the vitest cwd is `apps/app`, which is what `pnpm --filter app exec`
  // gives it — the only way these suites are run, locally and in CI.
  const repoRoot = resolve(process.cwd(), '../..');
  const raw = execFileSync(
    resolve(repoRoot, 'node_modules/.bin/supabase'),
    ['status', '-o', 'json'],
    { encoding: 'utf8', cwd: repoRoot },
  );
  const status = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, string>;
  const stack = {
    url: status.API_URL ?? '',
    anonKey: status.ANON_KEY ?? '',
    mailpit: status.MAILPIT_URL ?? status.INBUCKET_URL ?? '',
    dbUrl: status.DB_URL ?? '',
  };
  if (stack.url === '' || stack.anonKey === '' || stack.dbUrl === '') {
    throw new Error('could not read the local stack config — is it up? `pnpm db:start`');
  }
  // The app's modules read these at first use, and the suites import them lazily.
  process.env.EXPO_PUBLIC_SUPABASE_URL = stack.url;
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  return stack;
}

/** A fresh address per run, so "the newest message to this address" is unambiguous. */
export function someone(role: string): string {
  return `${role}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.test`;
}

/**
 * The six-digit code out of Mailpit, the same way `pnpm mail` reads it.
 *
 * Polled rather than read once: the auth server returns before the message has
 * been delivered, and a single read is a race that fails on a loaded machine
 * and passes on a quiet one.
 */
export async function codeFor(mailpit: string, address: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const list = (await (await fetch(`${mailpit}/api/v1/messages?limit=50`)).json()) as {
      messages?: { ID: string; To?: { Address: string }[] }[];
    };
    const match = list.messages?.find((m) => m.To?.some((t) => t.Address === address));
    if (match !== undefined) {
      const full = (await (await fetch(`${mailpit}/api/v1/message/${match.ID}`)).json()) as {
        Text?: string;
        HTML?: string;
      };
      const code = /\b\d{6}\b/.exec(`${full.Text ?? ''}${full.HTML ?? ''}`)?.[0];
      if (code !== undefined) return code;
      throw new Error(
        `No six-digit code for ${address}. If the mail holds a link instead, the ` +
          'magic_link override in supabase/config.toml is not being applied.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No mail for ${address} after 10s. Is the stack up? \`pnpm db:start\``);
}

/**
 * Run a statement as `postgres`, for what no client can see: `private`, `jobs`,
 * and rows RLS hides from everybody in the test.
 */
export function sql(stack: Stack, statement: string): string {
  return execFileSync('psql', [stack.dbUrl, '-tAc', statement], { encoding: 'utf8' }).trim();
}
