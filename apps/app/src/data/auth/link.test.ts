import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SavePlaceError, savePlace } from './link';

/**
 * Saving a place, and the one ordering the whole endpoint depends on.
 *
 * `claim-identity` takes the **access token of the session being left behind**,
 * not its user id — a user id is an unchecked parameter naming somebody else's
 * guest membership, so the function verifies the token and reads the id out of
 * it. Which means the token has to be read before anything replaces it. Get
 * that wrong and nothing throws: the claim is made with the *new* token, the
 * server says `source_is_permanent`, and a guest silently loses the membership
 * they were trying to keep.
 */

// Real UUIDs: `ClaimIdentityResponse.user_id` is a branded `z.uuid()`, and a
// fixture that is merely a readable string fails the parse rather than the
// assertion it was written for.
const ANON_ID = '11111111-1111-4111-8111-111111111111';
const SAVED_ID = '22222222-2222-4222-8222-222222222222';

const ANON = { access_token: 'anon.token', user: { id: ANON_ID, is_anonymous: true } };
const SAVED = { access_token: 'saved.token', user: { id: SAVED_ID, is_anonymous: false } };

const state = vi.hoisted(() => ({
  session: null as unknown,
  invocations: [] as { name: string; body: Record<string, unknown> }[],
  answers: [] as { data?: unknown; error?: unknown }[],
}));

vi.mock('./client', () => ({
  authClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
    },
    functions: {
      invoke: async (name: string, options: { body: Record<string, unknown> }) => {
        state.invocations.push({ name, body: options.body });
        const answer = state.answers.shift() ?? {
          data: { user_id: SAVED_ID, merged_memberships: 0, duplicates_removed: 0 },
          error: null,
        };
        return { data: answer.data ?? null, error: answer.error ?? null };
      },
    },
  }),
}));

/** What `functions.invoke` rejects with: the body is on a `Response` in `context`. */
function problemResponse(status: number, body: unknown): { context: Response } {
  return { context: new Response(JSON.stringify(body), { status }) };
}

beforeEach(() => {
  state.session = ANON;
  state.invocations = [];
  state.answers = [];
});

describe('the token it claims with', () => {
  it('is the anonymous one, read before the session is replaced', async () => {
    await savePlace({
      moment: 'after_answer',
      signIn: async () => {
        // The provider replaces the session. Anything reading it after this
        // point sees the permanent identity.
        state.session = SAVED;
        return { session: SAVED as never };
      },
    });

    expect(state.invocations).toHaveLength(1);
    expect(state.invocations[0]?.body.anonymous_session).toBe('anon.token');
  });

  it('sends a moment, which is what the conversion funnel is measured by', async () => {
    await savePlace({
      moment: 'after_confirmed',
      signIn: async () => ({ session: SAVED as never }),
    });

    expect(state.invocations[0]?.body.moment).toBe('after_confirmed');
  });
});

describe('when there is nothing to claim', () => {
  it('does not call the endpoint for a first-run sign-in with no guest session', async () => {
    state.session = null;

    const result = await savePlace({
      moment: 'settings',
      signIn: async () => ({ session: SAVED as never }),
    });

    expect(state.invocations).toEqual([]);
    expect(result.mergedMemberships).toBe(0);
  });

  it('does not call it when the previous session was already permanent', async () => {
    // It would be refused with `source_is_permanent`, so asking is a round trip
    // whose only possible answer is an error.
    state.session = SAVED;

    await savePlace({ moment: 'settings', signIn: async () => ({ session: SAVED as never }) });

    expect(state.invocations).toEqual([]);
  });
});

describe('retrying', () => {
  it('retries an unavailable auth server with the same key, so it cannot double-claim', async () => {
    state.answers = [
      {
        error: problemResponse(503, {
          error: 'unavailable',
          message: 'Something went wrong at our end.',
          reference: 'ref-1',
        }),
      },
    ];

    const result = await savePlace({
      moment: 'after_answer',
      signIn: async () => ({ session: SAVED as never }),
    });

    expect(state.invocations).toHaveLength(2);
    // The same key across both: that is what makes the second attempt a resume
    // rather than a second claim (ADR 0016).
    expect(state.invocations[0]?.body.idempotency_key).toBe(
      state.invocations[1]?.body.idempotency_key,
    );
    expect(result.mergedMemberships).toBe(0);
  });

  it('does not retry a token that verified and belongs to another account', async () => {
    state.answers = [
      {
        error: problemResponse(403, {
          error: 'forbidden',
          reason: 'source_is_permanent',
          message: 'That session cannot be merged.',
          reference: 'ref-2',
        }),
      },
    ];

    await expect(
      savePlace({ moment: 'after_answer', signIn: async () => ({ session: SAVED as never }) }),
    ).rejects.toBeInstanceOf(SavePlaceError);

    // Asking again is asking the same question and getting the same no.
    expect(state.invocations).toHaveLength(1);
  });

  it('keeps the reason, so a screen can turn on it rather than on the message text', async () => {
    state.answers = [
      {
        error: problemResponse(409, {
          error: 'conflict',
          reason: 'in_progress',
          message: 'Still working on that.',
          reference: 'ref-3',
        }),
      },
    ];

    await expect(
      savePlace({ moment: 'after_answer', signIn: async () => ({ session: SAVED as never }) }),
    ).rejects.toMatchObject({ problem: { reason: 'in_progress' } });
  });
});

describe('what it reports back', () => {
  it('passes the duplicate count through, which nothing else can tell the client', async () => {
    state.answers = [
      {
        data: { user_id: SAVED_ID, merged_memberships: 2, duplicates_removed: 1 },
        error: null,
      },
    ];

    const result = await savePlace({
      moment: 'after_attendance',
      signIn: async () => ({ session: SAVED as never }),
    });

    // `duplicate_member_removed` is emitted from this: the removal itself emits
    // the ordinary `circles.member_removed`, which does not say why.
    expect(result).toMatchObject({ mergedMemberships: 2, duplicatesRemoved: 1 });
  });
});
