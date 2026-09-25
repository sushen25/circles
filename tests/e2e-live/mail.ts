import { mint, stackConfig } from './stack';

/**
 * What the stack actually sent, read back from the mail catcher.
 *
 * Every local stack sends through `EMAIL_CAPTURE_URL` (`supabase/config.toml`),
 * so a message the dispatcher sends lands in Mailpit exactly as Resend would
 * have been handed it (`_shared/email/resend.ts`) — there is no interceptor to
 * write and no table to read. The dispatcher itself runs every minute under
 * `pg_cron` on a deployed project and never locally, so a test that wants the
 * email *now* runs it once (`runDispatcher`).
 */

export type Letter = { id: string; subject: string; text: string; html: string };

type Listed = { ID: string; Subject: string };

async function search(address: string): Promise<Listed[]> {
  const base = stackConfig().mailUrl;
  const response = await fetch(
    `${base}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  if (!response.ok) throw new Error(`the mail catcher answered ${response.status}`);
  return ((await response.json()) as { messages?: Listed[] }).messages ?? [];
}

async function read(id: string): Promise<Letter> {
  const base = stackConfig().mailUrl;
  const message = (await (await fetch(`${base}/api/v1/message/${id}`)).json()) as {
    ID: string;
    Subject?: string;
    Text?: string;
    HTML?: string;
  };
  return {
    id: message.ID,
    subject: message.Subject ?? '',
    text: message.Text ?? '',
    html: message.HTML ?? '',
  };
}

/** Every letter to `address`, newest first. */
export async function lettersTo(address: string): Promise<Letter[]> {
  return await Promise.all((await search(address)).map((listed) => read(listed.ID)));
}

/**
 * Runs the one background worker once, as `pg_cron` would: drains the outbox
 * into jobs and sends what is due. `CRON_SECRET` is the local stack's
 * published bearer (`supabase/config.toml`), not a credential.
 */
export async function runDispatcher(): Promise<void> {
  const { apiUrl } = stackConfig();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${apiUrl}/functions/v1/process-scheduled-jobs`, {
      method: 'POST',
      headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw new Error(`process-scheduled-jobs answered ${response.status}`);
    // A run that could not take the lease did nothing — another test's run
    // holds it, and gives it back when it ends — so this one tries again.
    if (((await response.json()) as { ran?: boolean }).ran !== false) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('the dispatcher never took its lease');
}

/**
 * Runs the dispatcher until a letter to `address` matching `subject` arrives,
 * and returns it. Polls, because the capture is an HTTP hop behind the send.
 */
export async function letterTo(address: string, subject: RegExp): Promise<Letter> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await runDispatcher();
    const found = (await lettersTo(address)).find((letter) => subject.test(letter.subject));
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no letter matching ${subject} reached ${address}`);
}

/**
 * The link in `letter` whose path is `path` (`/v`, `/e`, `/a`, `/p/<code>/…`),
 * on the served build's origin rather than the one the email names.
 *
 * Locally the Edge Functions have no `EXPO_PUBLIC_APP_ORIGIN`, so the letters
 * link to the brand's host (S1-29's note); the path and the fragment are the
 * letter's own. A token found in the fragment is registered with the guard in
 * `fixtures.ts`, so no request may carry it from here on.
 */
export function linkIn(letter: Letter, path: string | RegExp, baseURL: string): string {
  const hrefs = [...letter.html.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1]!.replaceAll('&amp;', '&'),
  );
  const matches = (pathname: string) =>
    typeof path === 'string' ? pathname === path : path.test(pathname);
  const found = hrefs.map((href) => new URL(href)).find((url) => matches(url.pathname));
  if (found === undefined) throw new Error(`no ${String(path)} link in "${letter.subject}"`);
  const token = found.hash.slice(1);
  if (token !== '') mint(token, 'token');
  return new URL(`${found.pathname}${found.search}${found.hash}`, baseURL).toString();
}
