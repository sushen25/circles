#!/usr/bin/env node
/**
 * The local mail catcher. `pnpm db:start` runs Mailpit alongside Postgres and
 * Auth, so nothing local ever sends a real email — every message the stack
 * produces is captured at http://127.0.0.1:54324.
 *
 *   pnpm mail              list what has been caught
 *   pnpm mail <address>    print the newest sign-in code for that address
 *
 * Sign-in is a six-digit code, not a magic link, so the local template is
 * overridden in supabase/config.toml. Without that override this prints
 * nothing, because the stock template sends a URL instead.
 */

const BASE = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const address = process.argv[2];

async function api(path) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`);
  } catch {
    console.error(`No mail catcher at ${BASE}. Is the stack up? \`pnpm db:start\``);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`${BASE}${path} -> ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  return res.json();
}

const { messages = [] } = await api('/api/v1/messages?limit=25');

if (messages.length === 0) {
  console.log('No mail captured yet.');
  process.exit(0);
}

if (!address) {
  console.log(`${messages.length} message(s) at ${BASE}\n`);
  for (const m of messages) {
    console.log(`  ${m.Created?.slice(11, 19) ?? ''}  ${m.To?.[0]?.Address ?? '?'}  ${m.Subject}`);
  }
  console.log(`\nPass an address to pull its newest code: pnpm mail someone@example.com`);
  process.exit(0);
}

const match = messages.find((m) => m.To?.some((t) => t.Address === address));
if (!match) {
  console.error(
    `Nothing addressed to ${address}. Caught: ${messages.map((m) => m.To?.[0]?.Address).join(', ')}`,
  );
  process.exit(1);
}

const full = await api(`/api/v1/message/${match.ID}`);
const body = `${full.Text ?? ''}${full.HTML ?? ''}`;
const code = /\b\d{6}\b/.exec(body)?.[0];

if (!code) {
  console.error(
    `No six-digit code in "${match.Subject}". If it contains a link instead, the\n` +
      'magic_link template override in supabase/config.toml is not being applied.',
  );
  process.exit(1);
}

console.log(code);
