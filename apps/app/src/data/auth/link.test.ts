import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SavePlaceError, resumePendingClaim, savePlace } from './link';

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

const ANON = {
  access_token: 'anon.token',
  refresh_token: 'anon.refresh.v1',
  user: { id: ANON_ID, is_anonymous: true },
};
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
        const next = state.answers.shift();
        // A call that has not come back yet, so a test can look at storage
        // while it is still out.
        if (next !== undefined && 'hang' in next) await (next as { hang: Promise<void> }).hang;
        const answer = (next as { data?: unknown; error?: unknown } | undefined) ?? {
          data: { user_id: SAVED_ID, merged_memberships: 0, duplicates_removed: 0 },
          error: null,
        };
        return { data: answer?.data ?? null, error: answer?.error ?? null };
      },
    },
  }),
}));

/** What `functions.invoke` rejects with: the body is on a `Response` in `context`. */
function problemResponse(status: number, body: unknown): { context: Response } {
  return { context: new Response(JSON.stringify(body), { status }) };
}

beforeEach(() => {
  // `freshAnonymousToken` exchanges the stored refresh token against these.
  // Without them it returns the stale access token without calling out, which
  // silently skipped the exchange in the first draft of these tests.
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://stack.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  state.session = ANON;
  state.invocations = [];
  state.answers = [];
  // The pending-claim record goes through the real storage adapter, which on
  // web is `localStorage`. Leaving one behind would make these tests depend on
  // the order they run in.
  globalThis.localStorage.clear();
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

describe('a claim that never got an answer', () => {
  /**
   * The failure that cannot be reconstructed. The claim is made with the
   * anonymous session's access token, and by then that session is already
   * replaced — the token exists nowhere else. So a dropped connection is not a
   * retryable request, it is a membership stranded for ever: every later
   * attempt sees only the permanent session, skips the claim, and the circle
   * the guest joined is gone.
   */
  it('is kept when the transport fails, and finished later under the same key', async () => {
    // No HTTP response at all — the connection dropped.
    state.answers = [{ error: new Error('network') }];

    await expect(
      savePlace({ moment: 'after_answer', signIn: async () => ({ session: SAVED as never }) }),
    ).rejects.toBeInstanceOf(SavePlaceError);

    const first = state.invocations[0]?.body;
    state.invocations = [];
    // A reload later, now signed in: the session is the permanent one.
    state.session = SAVED;

    const resumed = await resumePendingClaim();

    expect(state.invocations).toHaveLength(1);
    expect(state.invocations[0]?.body.anonymous_session).toBe('anon.token');
    expect(state.invocations[0]?.body.idempotency_key).toBe(first?.idempotency_key);
    expect(resumed?.merged_memberships).toBe(0);
  });

  it('exists while the request is still in flight, not only after it fails', async () => {
    /**
     * A `catch` only runs if this code is still running. A page reloaded or a
     * native process killed mid-request reaches no handler at all — and the
     * anonymous session is already replaced by then, so the token exists
     * nowhere else. Recording in the failure path would have covered every
     * failure except the one that takes the process with it.
     */
    let release = (): void => undefined;
    state.answers = [
      {
        hang: new Promise<void>((resolve) => (release = resolve)),
        data: { user_id: SAVED_ID, merged_memberships: 0, duplicates_removed: 0 },
      } as never,
    ];

    const inFlight = savePlace({
      moment: 'after_answer',
      signIn: async () => ({ session: SAVED as never }),
    });

    // Give the call a turn to reach the transport, then look at storage as a
    // killed process would leave it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stored = globalThis.localStorage.getItem('circles.pending_claims');
    expect(stored).not.toBeNull();
    // Keyed by the identity it is for, so one browser can hold several.
    expect(JSON.parse(stored ?? '{}')[SAVED_ID]).toMatchObject({
      anonymous_session: 'anon.token',
      destination_user_id: SAVED_ID,
    });

    release();
    await inFlight;
  });

  it('is dropped when the answer was a refusal, so it is never replayed', async () => {
    state.answers = [
      {
        error: problemResponse(403, {
          error: 'forbidden',
          reason: 'source_is_permanent',
          message: 'That session cannot be merged.',
          reference: 'ref-4',
        }),
      },
    ];

    await expect(
      savePlace({ moment: 'after_answer', signIn: async () => ({ session: SAVED as never }) }),
    ).rejects.toBeInstanceOf(SavePlaceError);

    state.invocations = [];
    state.session = SAVED;
    await resumePendingClaim();

    // Asking again is asking the same question and getting the same no.
    expect(state.invocations).toEqual([]);
  });

  it('is not handed to whoever signs in next', async () => {
    /**
     * A shared browser: the guest's claim times out, they sign out, and
     * somebody else signs in. Without binding the record to the identity it was
     * made for, that person's account collects the first person's circles.
     */
    state.answers = [{ error: new Error('network') }];
    await expect(
      savePlace({ moment: 'after_answer', signIn: async () => ({ session: SAVED as never }) }),
    ).rejects.toBeInstanceOf(SavePlaceError);

    state.invocations = [];
    // A different permanent account, on the same browser.
    state.session = {
      access_token: 'stranger.token',
      user: { id: '33333333-3333-4333-8333-333333333333', is_anonymous: false },
    };

    await expect(resumePendingClaim()).resolves.toBeUndefined();
    expect(state.invocations).toEqual([]);

    // And it is still there for the identity it belongs to.
    state.session = SAVED;
    await resumePendingClaim();
    expect(state.invocations).toHaveLength(1);
  });

  it('is not overwritten by the next person to save their place here', async () => {
    /**
     * A shared laptop. One claim strands; a different guest then saves their
     * place in the same browser. With a single stored record the second write
     * erased the first person's only evidence, and their memberships were gone
     * with no error anywhere.
     */
    state.answers = [{ error: new Error('network') }];
    await expect(
      savePlace({ moment: 'after_answer', signIn: async () => ({ session: SAVED as never }) }),
    ).rejects.toBeInstanceOf(SavePlaceError);

    // Somebody else, from a fresh guest session, succeeding.
    const OTHER_ID = '44444444-4444-4444-8444-444444444444';
    state.session = ANON;
    await savePlace({
      moment: 'settings',
      signIn: async () => ({
        session: {
          access_token: 'other.token',
          user: { id: OTHER_ID, is_anonymous: false },
        } as never,
      }),
    });

    // The first person's claim survived, and still finishes.
    state.invocations = [];
    state.session = SAVED;
    await resumePendingClaim();
    expect(state.invocations).toHaveLength(1);
    expect(state.invocations[0]?.body.anonymous_session).toBe('anon.token');
  });

  it('keeps the refresh token when a resume does not succeed', async () => {
    /**
     * The sixty-minute fuse, put back by the fix for it. `freshAnonymousToken`
     * wrote the rotated token back and the `claimIdentity` that followed
     * overwrote the record without it — so one failed retry, or an app started
     * before the radio was up, left only an access token that expires within
     * the hour. Reproduced by the reviewer against the real module.
     */
    state.answers = [{ error: new Error('network') }];
    await expect(
      savePlace({ moment: 'after_answer', signIn: async () => ({ session: SAVED as never }) }),
    ).rejects.toBeInstanceOf(SavePlaceError);

    const before = JSON.parse(globalThis.localStorage.getItem('circles.pending_claims') ?? '{}');
    expect(before[SAVED_ID].anonymous_refresh_token).toBe('anon.refresh.v1');

    // A resume where the exchange works and the claim then fails again.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ access_token: 'anon.access.v2', refresh_token: 'anon.refresh.v2' }),
          ),
      ),
    );
    state.session = SAVED;
    state.answers = [{ error: new Error('network again') }];
    await expect(resumePendingClaim()).rejects.toBeInstanceOf(SavePlaceError);
    vi.unstubAllGlobals();

    const after = JSON.parse(globalThis.localStorage.getItem('circles.pending_claims') ?? '{}');
    expect(after[SAVED_ID]).toMatchObject({
      anonymous_session: 'anon.access.v2',
      anonymous_refresh_token: 'anon.refresh.v2',
    });
  });

  it('keeps the record when the token endpoint is merely unreachable', async () => {
    // A 502 from the gateway, GoTrue restarting, or the token endpoint's own
    // rate limit at app start. Reading those as "expired" dropped the record
    // and lost the membership over a blip.
    state.answers = [{ error: new Error('network') }];
    await expect(
      savePlace({ moment: 'after_answer', signIn: async () => ({ session: SAVED as never }) }),
    ).rejects.toBeInstanceOf(SavePlaceError);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    state.session = SAVED;
    state.invocations = [];
    // The claim itself is still down too, so nothing clears the record for a
    // reason other than the one under test.
    state.answers = [{ error: new Error('still down') }];
    await expect(resumePendingClaim()).rejects.toBeInstanceOf(SavePlaceError);
    vi.unstubAllGlobals();

    const kept = JSON.parse(globalThis.localStorage.getItem('circles.pending_claims') ?? '{}');
    expect(kept[SAVED_ID]).toBeDefined();
    // It tried anyway, with the token it already had.
    expect(state.invocations[0]?.body.anonymous_session).toBe('anon.token');
  });

  it('drops it when the auth server says the token is no good', async () => {
    state.answers = [{ error: new Error('network') }];
    await expect(
      savePlace({ moment: 'after_answer', signIn: async () => ({ session: SAVED as never }) }),
    ).rejects.toBeInstanceOf(SavePlaceError);

    // 400 `invalid_grant`: an answer about this token, and asking again will
    // not change it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 400 })),
    );
    state.session = SAVED;
    state.invocations = [];
    await expect(resumePendingClaim()).resolves.toBeUndefined();
    vi.unstubAllGlobals();

    expect(state.invocations).toEqual([]);
    expect(globalThis.localStorage.getItem('circles.pending_claims')).toBeNull();
  });

  it('does nothing when there is nothing pending', async () => {
    state.session = SAVED;

    await expect(resumePendingClaim()).resolves.toBeUndefined();
    expect(state.invocations).toEqual([]);
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
