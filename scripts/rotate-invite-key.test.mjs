import assert from 'node:assert/strict';
import { test } from 'node:test';

import { derivedInviteSecret } from '../supabase/functions/_shared/secret.ts';
import { sha256Hex } from '../supabase/functions/_shared/hash.ts';
import { deriveInviteSecret, digestHex, isLocal, planFor, run } from './rotate-invite-key.mjs';

const ID = '48000000-0000-4000-8000-0000000000a1';

test('derives exactly what the Edge Functions derive', async () => {
  for (const key of ['local', 'a-much-longer-key-with-unicode-é']) {
    assert.equal(deriveInviteSecret(key, ID), await derivedInviteSecret(key, ID));
  }
});

test('digests the way the Edge Functions do, in the form PostgREST reads', async () => {
  const secret = deriveInviteSecret('local', ID);
  assert.equal(digestHex(secret), await sha256Hex(secret));
});

test('leaves an invite that is already under the new key, and replaces one that is not', () => {
  const current = {
    id: ID,
    circle_id: 'c1',
    secret_hash: digestHex(deriveInviteSecret('new', ID)),
  };
  assert.equal(planFor(current, 'new'), null);

  const stale = { ...current, secret_hash: digestHex(deriveInviteSecret('old', ID)) };
  const step = planFor(stale, 'new', '48000000-0000-4000-8000-0000000000a2');
  assert.equal(step.p_circle_id, 'c1');
  assert.equal(step.p_invite_id, '48000000-0000-4000-8000-0000000000a2');
  assert.equal(
    step.p_secret_hash,
    digestHex(deriveInviteSecret('new', '48000000-0000-4000-8000-0000000000a2')),
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
  };
  await assert.rejects(run({ env, argv: ['--apply'], out: () => {} }), /not this machine/);
  await assert.rejects(run({ env: {}, argv: [], out: () => {} }), /set SUPABASE_URL/);
});

test('sweeps again until nothing is left, so a link made mid-run is caught', async () => {
  const live = new Map([
    ['c1', { id: 'i1', circle_id: 'c1', secret_hash: digestHex(deriveInviteSecret('old', 'i1')) }],
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
          secret_hash: digestHex(deriveInviteSecret('old', 'i2')),
        });
      }
      return new Response('null', { status: 200 });
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
      },
      argv: ['--apply'],
      out: (line) => lines.push(line),
    });
    assert.equal(result.remaining, 0);
    assert.equal(result.reissued, 2);
    for (const invite of live.values()) {
      assert.equal(invite.secret_hash, digestHex(deriveInviteSecret('new', invite.id)));
    }
    assert.ok(lines.join('\n').includes('Pass 3'));
  } finally {
    globalThis.fetch = realFetch;
  }
});
