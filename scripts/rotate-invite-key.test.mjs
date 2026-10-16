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
