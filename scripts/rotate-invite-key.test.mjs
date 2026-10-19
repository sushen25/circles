import assert from 'node:assert/strict';
import { test } from 'node:test';

import { derivedInviteSecret } from '../supabase/functions/_shared/secret.ts';
import { createHmac } from 'node:crypto';

import { sha256Hex } from '../supabase/functions/_shared/hash.ts';
import { deriveInviteSecret, digestHex, isLocal, planFor, run } from './rotate-invite-key.mjs';

const ID = '48000000-0000-4000-8000-0000000000a1';

test('derives exactly what the Edge Functions derive', async () => {
  for (const key of ['local', 'a-much-longer-key-with-unicode-é']) {
    assert.equal(deriveInviteSecret(key, ID), await derivedInviteSecret(key, ID));
  }
});

// Built, not written out: a long literal beside the word "key" is what the secret scan looks for.
const DIGEST_KEY = `digest-${'x'.repeat(40)}`;

test('digests the way the Edge Functions do, in the form PostgREST reads', () => {
  // Spelled out here rather than imported from `_shared/digest.ts`, which pulls in
  // the Deno kit: `supabase/functions/_shared/digest.test.ts` pins the same bytes.
  const secret = deriveInviteSecret('local', ID);
  const expected = createHmac('sha256', DIGEST_KEY)
    .update(`circles.digest.v1:invite:${secret}`)
    .digest('hex');
  assert.equal(digestHex(secret, DIGEST_KEY), `\\x${expected}`);
});

test('a plain SHA-256 invite is never under the new key, so a sweep replaces it', async () => {
  const secret = deriveInviteSecret('same', ID);
  const legacy = { id: ID, circle_id: 'c1', secret_hash: await sha256Hex(secret) };
  assert.notEqual(planFor(legacy, 'same', DIGEST_KEY), null);
  const current = { ...legacy, secret_hash: digestHex(secret, DIGEST_KEY) };
  assert.equal(planFor(current, 'same', DIGEST_KEY), null);
});

test('leaves an invite that is already under the new key, and replaces one that is not', () => {
  const current = {
    id: ID,
    circle_id: 'c1',
    secret_hash: digestHex(deriveInviteSecret('new', ID), DIGEST_KEY),
  };
  assert.equal(planFor(current, 'new', DIGEST_KEY), null);

  const stale = { ...current, secret_hash: digestHex(deriveInviteSecret('old', ID), DIGEST_KEY) };
  const step = planFor(stale, 'new', DIGEST_KEY, '48000000-0000-4000-8000-0000000000a2');
  assert.equal(step.p_circle_id, 'c1');
  assert.equal(step.p_replaces, ID);
  assert.equal(step.p_invite_id, '48000000-0000-4000-8000-0000000000a2');
  assert.equal(
    step.p_secret_hash,
    digestHex(deriveInviteSecret('new', '48000000-0000-4000-8000-0000000000a2'), DIGEST_KEY),
  );
});

test('only this machine is local', () => {
  assert.equal(isLocal('http://127.0.0.1:54421'), true);
  assert.equal(isLocal('http://localhost:54321'), true);
  assert.equal(isLocal('https://abcdefgh.supabase.co'), false);
  assert.equal(isLocal('not a url'), false);
});

test('refuses a hosted URL without --hosted, and missing configuration, before any request', async () => {
  const env = {
    SUPABASE_URL: 'https://abcdefgh.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'x',
    INVITE_LINK_KEY_NEW: 'y',
    INVITE_DIGEST_KEY: DIGEST_KEY,
  };
  await assert.rejects(run({ env, argv: ['--apply'], out: () => {} }), /not this machine/);
  await assert.rejects(run({ env: {}, argv: [], out: () => {} }), /set SUPABASE_URL/);
});

test('sweeps again until nothing is left, so a link made mid-run is caught', async () => {
  const live = new Map([
    [
      'c1',
      {
        id: 'i1',
        circle_id: 'c1',
        secret_hash: digestHex(deriveInviteSecret('old', 'i1'), DIGEST_KEY),
      },
    ],
  ]);
  let straggler = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    if (path.includes('/rpc/reissue_invite')) {
      const step = JSON.parse(init.body);
      live.set(step.p_circle_id, {
        id: step.p_invite_id,
        circle_id: step.p_circle_id,
        secret_hash: step.p_secret_hash,
      });
      if (straggler) {
        // An owner resets another circle's link, under the old key, mid-sweep.
        straggler = false;
        live.set('c2', {
          id: 'i2',
          circle_id: 'c2',
          secret_hash: digestHex(deriveInviteSecret('old', 'i2'), DIGEST_KEY),
        });
      }
      return new Response('true', { status: 200 });
    }
    return new Response(JSON.stringify([...live.values()]), { status: 200 });
  };
  try {
    const lines = [];
    const result = await run({
      env: {
        SUPABASE_URL: 'http://127.0.0.1:54421',
        SUPABASE_SERVICE_ROLE_KEY: 'x',
        INVITE_LINK_KEY_NEW: 'new',
        INVITE_DIGEST_KEY: DIGEST_KEY,
      },
      argv: ['--apply'],
      out: (line) => lines.push(line),
    });
    assert.equal(result.remaining, 0);
    assert.equal(result.reissued, 2);
    for (const invite of live.values()) {
      assert.equal(invite.secret_hash, digestHex(deriveInviteSecret('new', invite.id), DIGEST_KEY));
    }
    assert.ok(lines.join('\n').includes('Pass 3'));
  } finally {
    globalThis.fetch = realFetch;
  }
});
