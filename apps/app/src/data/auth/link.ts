import {
  ClaimIdentityResponse,
  IdempotencyKey,
  Problem,
  type ClaimIdentityRequest,
} from '@circles/contracts';

import { authClient } from './client';
import { isAnonymous } from './guest';
import type { SignedIn } from './providers/types';

/**
 * Saving a place: turning a guest into somebody the product can find again
 * (architecture §10, spec §5.1, ADR 0004).
 *
 * Two halves, and the seam between them is the point. The first half replaces
 * the session and is provider-specific — a code for email here, an identity
 * token for Apple and Google in S1-14b. The second half reconciles memberships
 * and is identical either way, so it lives here and takes the first half as an
 * argument.
 */

export type SaveMoment = ClaimIdentityRequest['moment'];

export interface SavePlaceOptions {
  /** Where in the journey this happened. The conversion funnel is measured by it. */
  moment: SaveMoment;
  /** Replaces the current session with a permanent one. Provider-specific. */
  signIn: () => Promise<SignedIn>;
}

export interface SavedPlace {
  session: SignedIn['session'];
  suggestedName?: string;
  /** Zero on the ordinary path — see below. */
  mergedMemberships: number;
  /** Feeds the `duplicate_member_removed` event; there is no other way to know. */
  duplicatesRemoved: number;
}

/** A refusal the caller can act on, with the reason kept rather than flattened. */
export class SavePlaceError extends Error {
  constructor(
    readonly problem: Problem | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'SavePlaceError';
  }
}

function newIdempotencyKey(): IdempotencyKey {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid === undefined) throw new Error('no crypto.randomUUID available');
  return IdempotencyKey.parse(uuid);
}

/** `functions.invoke` gives back a `Response` on failure; the body is the Problem. */
async function problemOf(error: unknown): Promise<Problem | undefined> {
  const response = (error as { context?: unknown })?.context;
  if (!(response instanceof Response)) return undefined;
  try {
    const parsed = Problem.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function claimIdentity(
  anonymousSession: string,
  moment: SaveMoment,
): Promise<ClaimIdentityResponse> {
  // One key across both attempts. That is what makes the retry below safe
  // rather than a second claim: the key is the thing the server dedupes on
  // (ADR 0016), so reusing it turns "did my first attempt land?" into a
  // question the server answers instead of one the client guesses.
  const key = newIdempotencyKey();

  const attempt = async (): Promise<ClaimIdentityResponse> => {
    const { data, error } = await authClient().functions.invoke('claim-identity', {
      body: { idempotency_key: key, anonymous_session: anonymousSession, moment },
    });
    if (error !== null) {
      const problem = await problemOf(error);
      throw new SavePlaceError(problem, problem?.message ?? 'claim-identity failed');
    }
    return ClaimIdentityResponse.parse(data);
  };

  try {
    return await attempt();
  } catch (error) {
    const problem = error instanceof SavePlaceError ? error.problem : undefined;

    /**
     * Retry exactly one shape, and only this one.
     *
     * `unavailable` with no `reason` means the auth server could not be *asked*
     * whether the token was good — the function released the key rather than
     * holding it, so the same key is safe and correct to send again. Every
     * other failure is an answer: `source_is_permanent` (403) means the token
     * verified and belongs to somebody else's account, and retrying it is
     * asking the same question and getting the same no.
     */
    if (problem?.error === 'unavailable' && problem.reason === undefined) {
      return await attempt();
    }
    throw error;
  }
}

/**
 * Sign in, then reconcile.
 *
 * **The anonymous token is captured before anything replaces it**, which is the
 * one ordering this function exists to guarantee. `claim-identity` takes the
 * *access token* of the session being left behind, not its user id — a user id
 * is an unchecked parameter naming somebody else's guest membership, which is
 * to say a way to take it, so the function verifies the token with the auth
 * server and reads the id out of it. After `signIn()` runs, that token is gone
 * from the client and the claim can never be made.
 *
 * **It is called even when nothing can have moved.** The email path converts
 * the anonymous user *in place* — same id, now permanent — so the old token
 * resolves to the same caller and there is nothing to merge. Calling anyway is
 * deliberate: the database marks the profile and writes `growth.account_claimed`
 * once, and an early return here would be a second opinion about idempotence
 * held by the client. S1-14b's SSO path genuinely does merge, and it takes this
 * same route.
 *
 * It is skipped in only one case, and for a documented refusal rather than an
 * optimisation: a caller whose previous session was already permanent gets
 * `source_is_permanent`, so there is nothing to ask for.
 */
export async function savePlace(options: SavePlaceOptions): Promise<SavedPlace> {
  const { data } = await authClient().auth.getSession();
  const previous = data.session;
  const anonymousToken = isAnonymous(previous) ? previous?.access_token : undefined;

  const signedIn = await options.signIn();

  if (anonymousToken === undefined) {
    // A first-run organiser with no guest session behind them. Nothing was left
    // behind, so there is nothing to claim — and `anonymous_session` has no
    // honest value to carry.
    return { ...signedIn, mergedMemberships: 0, duplicatesRemoved: 0 };
  }

  const claimed = await claimIdentity(anonymousToken, options.moment);
  return {
    ...signedIn,
    mergedMemberships: claimed.merged_memberships,
    duplicatesRemoved: claimed.duplicates_removed,
  };
}
