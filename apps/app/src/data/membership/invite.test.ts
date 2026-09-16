import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureInviteFragment,
  heldInvite,
  inviteSecretFromHash,
  redeemInvite,
  releaseInvite,
  secretDigest,
} from './invite';

/**
 * The invite secret's path through the client, which is short on purpose: out
 * of the fragment, into memory, hashed for the preview, and sent once in a body.
 */

const invoke = vi.fn();
vi.mock('../auth/client', () => ({
  authClient: () => ({ functions: { invoke } }),
}));
vi.mock('../auth/guest', () => ({ ensureGuestSession: vi.fn(async () => ({})) }));
const turnstile = vi.fn<() => Promise<string | undefined>>();
vi.mock('../auth/turnstile', () => ({ getTurnstileToken: () => turnstile() }));

// Built, not written out: a long literal beside the word "secret" is exactly what
// the secret scan in CI looks for, and it is right not to care that this one is fake.
const SECRET = 'sunday-crew-'.repeat(4);
const KEY = globalThis.crypto.randomUUID();

beforeEach(() => {
  releaseInvite();
  invoke.mockReset();
  turnstile.mockReset();
  window.history.replaceState(null, '', '/');
});

describe('inviteSecretFromHash', () => {
  it('reads the secret out of a fragment', () => {
    expect(inviteSecretFromHash(`#${SECRET}`)).toBe(SECRET);
  });

  it.each([
    ['no fragment', ''],
    ['an empty fragment', '#'],
    ['a truncated paste', '#q1w2e3'],
    ['broken percent-encoding', '#%E0%A4%A'],
  ])('answers null for %s rather than throwing', (_, hash) => {
    expect(inviteSecretFromHash(hash)).toBeNull();
  });
});

describe('secretDigest', () => {
  it('is SHA-256, hex, in the form PostgREST takes a bytea in', async () => {
    // The published test vector. `extensions.digest('abc', 'sha256')` in
    // Postgres gives the same bytes, which is the whole point: the preview only
    // finds the invite if the browser and `redeem_invite` hash alike.
    expect(await secretDigest('abc')).toBe(
      '\\xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('captureInviteFragment', () => {
  it('holds the secret and takes it out of the address bar on /join', () => {
    window.history.replaceState(null, '', `/join#${SECRET}`);

    captureInviteFragment();

    expect(heldInvite()).toBe(SECRET);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/join');
  });

  it('strips a mangled fragment too, and holds nothing', () => {
    window.history.replaceState(null, '', '/join/#q1w2');

    captureInviteFragment();

    expect(heldInvite()).toBeUndefined();
    expect(window.location.hash).toBe('');
  });

  it('leaves every other route’s fragment alone', () => {
    window.history.replaceState(null, '', `/p/pnsundaycr#${SECRET}`);

    captureInviteFragment();

    expect(heldInvite()).toBeUndefined();
    expect(window.location.hash).toBe(`#${SECRET}`);
  });
});

describe('redeemInvite', () => {
  const answer = {
    circle: {
      id: '00000000-0000-4000-8000-000000000a01',
      name: 'Sunday Crew',
      color: 'sky',
      time_zone: 'Australia/Melbourne',
      cadence: 'monthly',
      short_code: 'sundaycrew',
      status: 'active',
      last_met_at: null,
    },
    member_user_id: '00000000-0000-4000-8000-000000000102',
  };

  it('sends no Turnstile field when there is no token, rather than an undefined one', async () => {
    turnstile.mockResolvedValue(undefined);
    invoke.mockResolvedValue({ data: answer, error: null });

    await redeemInvite({ secret: SECRET, displayName: 'Priya', idempotencyKey: KEY as never });

    const [name, { body }] = invoke.mock.calls[0]!;
    expect(name).toBe('redeem-invite');
    expect(body).toEqual({ idempotency_key: KEY, secret: SECRET, display_name: 'Priya' });
    expect('turnstile_token' in body).toBe(false);
  });

  it('sends a token it minted for itself when there is one', async () => {
    turnstile.mockResolvedValue('fresh-token');
    invoke.mockResolvedValue({ data: answer, error: null });

    await redeemInvite({ secret: SECRET, displayName: 'Priya', idempotencyKey: KEY as never });

    expect(invoke.mock.calls[0]![1].body.turnstile_token).toBe('fresh-token');
  });

  it('never puts the secret in an error, which is a thing that gets logged', async () => {
    turnstile.mockResolvedValue(undefined);
    invoke.mockResolvedValue({ data: null, error: new Error(`boom ${SECRET}`) });

    const failure = await redeemInvite({
      secret: SECRET,
      displayName: 'Priya',
      idempotencyKey: KEY as never,
    }).then(
      () => new Error('redeemInvite resolved when it should have thrown'),
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).not.toContain(SECRET);
    expect(String(failure.stack)).not.toContain(SECRET);
  });
});
