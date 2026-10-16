// Rotate every live invite under a new `INVITE_LINK_KEY` (SUS-125).
//
// For when the key has leaked: see "The invite key has leaked" in
// docs/runbooks/environments.md. Invite secrets are HMAC(key, invite id)
// (ADR 0028), and the database holds only their SHA-256, so a new key on its
// own makes existing links unshowable while they keep working. This gives every
// circle with a live link a *new* invite id, a secret derived from it under the
// new key, and revokes the old one, through `public.reissue_invite`, which only
// the service role can call.
//
//   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  INVITE_LINK_KEY_NEW=...  \
//     node scripts/rotate-invite-key.mjs [--apply] [--hosted]
//
// - Dry run unless `--apply`: it reads, counts and reports, and changes nothing.
// - The service role key and the new key come from the environment, never from
//   an argument, so neither lands in shell history or a process listing.
// - A URL that is not this machine needs `--hosted` as well. It is one more
//   thing to type on purpose before the production database is touched.
// - Idempotent: a live invite already derived under the new key is left alone,
//   so a run that stopped half way is finished by running it again.
// - Prints counts only. No secret, digest, id or circle is ever printed.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Mirrors `INVITE_CONTEXT` in supabase/functions/_shared/secret.ts. */
const INVITE_CONTEXT = 'circles.invite.v1:';

/** `derivedInviteSecret` in supabase/functions/_shared/secret.ts, in Node. */
export function deriveInviteSecret(key, inviteId) {
  return createHmac('sha256', key).update(`${INVITE_CONTEXT}${inviteId}`).digest('base64url');
}

/** `\x…`, which is how PostgREST accepts a `bytea` (`sha256Hex` in _shared/hash.ts). */
export function digestHex(secret) {
  return `\\x${createHash('sha256').update(secret).digest('hex')}`;
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const PAGE = 500;

export function isLocal(url) {
  try {
    return LOCAL.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The plan for one live invite: `null` when it is already under the new key,
 * otherwise the replacement. Pure, so the case that matters is tested without
 * a database.
 */
export function planFor(live, newKey, newId = randomUUID()) {
  if (digestHex(deriveInviteSecret(newKey, live.id)) === live.secret_hash) return null;
  return {
    p_circle_id: live.circle_id,
    p_invite_id: newId,
    p_secret_hash: digestHex(deriveInviteSecret(newKey, newId)),
  };
}

async function rest(base, serviceKey, path, init = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // The status and PostgREST's code, never the body: it can echo a digest.
    let code = '';
    try {
      code = (await response.json()).code ?? '';
    } catch {
      /* no body */
    }
    throw new Error(`${path.split('?')[0]} answered ${response.status} ${code}`.trim());
  }
  return response;
}

async function liveInvites(base, serviceKey) {
  const found = [];
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const page = await (
      await rest(
        base,
        serviceKey,
        `circle_invites?select=id,circle_id,secret_hash&revoked_at=is.null&id=gt.${after}&order=id.asc&limit=${PAGE}`,
      )
    ).json();
    found.push(...page);
    if (page.length < PAGE) return found;
    after = page.at(-1).id;
  }
}

export async function run({
  env = process.env,
  argv = process.argv.slice(2),
  out = console.log,
} = {}) {
  const base = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const newKey = env.INVITE_LINK_KEY_NEW ?? '';
  const apply = argv.includes('--apply');

  if (base === '' || serviceKey === '' || newKey === '') {
    throw new Error(
      'set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and INVITE_LINK_KEY_NEW in the environment',
    );
  }
  if (!isLocal(base) && !argv.includes('--hosted')) {
    throw new Error(`${new URL(base).hostname} is not this machine; add --hosted if you mean it`);
  }

  const live = await liveInvites(base, serviceKey);
  const todo = live.map((invite) => planFor(invite, newKey)).filter((step) => step !== null);
  out(
    `${live.length} live invite(s); ${live.length - todo.length} already under the new key; ` +
      `${todo.length} to reissue.`,
  );

  if (!apply) {
    out('Dry run: nothing changed. Add --apply to reissue.');
    return { live: live.length, reissued: 0 };
  }

  let reissued = 0;
  for (const step of todo) {
    await rest(base, serviceKey, 'rpc/reissue_invite', {
      method: 'POST',
      body: JSON.stringify(step),
    });
    reissued += 1;
  }
  out(`Reissued ${reissued}. Now set INVITE_LINK_KEY to the new key on the project.`);
  return { live: live.length, reissued };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(`rotate-invite-key: ${error.message}`);
    process.exit(1);
  });
}
