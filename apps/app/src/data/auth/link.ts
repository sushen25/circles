import {
  ClaimIdentityResponse,
  IdempotencyKey,
  Problem,
  type ClaimIdentityRequest,
} from '@circles/contracts';

import { authClient } from './client';
import { isAnonymous } from './guest';
import type { SignedIn } from './providers/types';
import { sessionStorage } from './storage';

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

/**
 * A claim that was started and has not been answered.
 *
 * **This is the one piece of state that cannot be reconstructed.** The claim is
 * made with the anonymous session's access token, and by the time the call goes
 * out that session has already been replaced — the token exists nowhere else.
 * So a connection that drops mid-call is not a retryable request, it is a
 * membership stranded for ever: every later attempt sees only the permanent
 * session, skips the claim, and the guest's circle is simply gone.
 *
 * Persisted rather than held in memory because the failure that matters is the
 * one that comes with a reload. It is written through the same adapter as the
 * session itself, so it lives where that lives, and it holds a token that was
 * already stored there and that expires on its own. The key and the moment go
 * with it: retrying under the same key is what makes the retry a resume rather
 * than a second claim.
 */
const PENDING_KEY = 'circles.pending_claim';

interface PendingClaim {
  anonymous_session: string;
  idempotency_key: string;
  moment: SaveMoment;
}

async function rememberClaim(claim: PendingClaim): Promise<void> {
  try {
    await sessionStorage.setItem(PENDING_KEY, JSON.stringify(claim));
  } catch {
    // Storage refusing is not a reason to lose the error the caller is about
    // to see; the claim is simply not resumable on this device.
  }
}

async function forgetClaim(): Promise<void> {
  try {
    await sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to do.
  }
}

async function pendingClaim(): Promise<PendingClaim | undefined> {
  try {
    const raw = await sessionStorage.getItem(PENDING_KEY);
    if (raw === null || raw === undefined) return undefined;
    const parsed = JSON.parse(raw) as PendingClaim;
    return typeof parsed.anonymous_session === 'string' &&
      typeof parsed.idempotency_key === 'string'
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a failure leaves the question open.
 *
 * A refusal is an answer and there is nothing to come back to: the token
 * belongs to somebody else, or the caller has not signed in, or the key was
 * reused for a different body. Everything else — no response at all, the auth
 * server unreachable, a first attempt still running — means the claim may yet
 * succeed, and the only way to find out is to ask again with the same key.
 */
function stillOpen(problem: Problem | undefined): boolean {
  if (problem === undefined) return true; // No HTTP response: the transport failed.
  if (problem.reason === undefined) return problem.error === 'unavailable';
  return problem.reason === 'in_progress' || problem.reason === 'too_many_requests';
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
  existingKey?: string,
): Promise<ClaimIdentityResponse> {
  // One key across every attempt, including a resumed one. That is what makes a
  // retry safe rather than a second claim: the key is the thing the server
  // dedupes on (ADR 0016), so reusing it turns "did my first attempt land?"
  // into a question the server answers instead of one the client guesses.
  const key = existingKey ?? newIdempotencyKey();

  /**
   * Written **before** the first attempt, not in the failure path.
   *
   * A `catch` only runs if this code is still running. A page reloaded or a
   * native process killed while the request is in flight reaches no handler at
   * all — and by then the anonymous session has already been replaced, so the
   * token exists nowhere else and the membership is stranded with nothing
   * recording that it was ever being claimed. Recording first costs one write
   * on the ordinary path and is the only version that survives the failure it
   * is for.
   */
  await rememberClaim({ anonymous_session: anonymousSession, idempotency_key: key, moment });

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

  const settle = async (error: unknown): Promise<never> => {
    const problem = error instanceof SavePlaceError ? error.problem : undefined;
    // An answer, and not one asking again will change: stop keeping the record.
    if (!stillOpen(problem)) await forgetClaim();
    throw error;
  };

  try {
    const answered = await attempt();
    await forgetClaim();
    return answered;
  } catch (error) {
    const problem = error instanceof SavePlaceError ? error.problem : undefined;

    /**
     * Retry exactly one shape immediately, and only this one.
     *
     * `unavailable` with no `reason` means the auth server could not be *asked*
     * whether the token was good — the function released the key rather than
     * holding it, so the same key is safe and correct to send again. Every
     * other failure is either an answer or something the stored record will
     * pick up later.
     */
    if (problem?.error === 'unavailable' && problem.reason === undefined) {
      try {
        const answered = await attempt();
        await forgetClaim();
        return answered;
      } catch (again) {
        return await settle(again);
      }
    }

    return await settle(error);
  }
}

/**
 * Finishes a claim an earlier attempt could not get an answer to.
 *
 * Safe to call at any time and returns nothing when there is nothing to do, so
 * the app can call it on start and after every sign-in without asking whether
 * it should. The token it replays may have expired, in which case the server
 * refuses and the record is dropped — a stranded membership is not recoverable
 * for ever, but it is recoverable for as long as the evidence is good.
 */
export async function resumePendingClaim(): Promise<ClaimIdentityResponse | undefined> {
  const pending = await pendingClaim();
  if (pending === undefined) return undefined;

  const { data } = await authClient().auth.getSession();
  // Only a permanent session can be the destination; asking from an anonymous
  // one is refused with `destination_is_not_permanent`.
  if (data.session === null || data.session.user.is_anonymous === true) return undefined;

  const answered = await claimIdentity(
    pending.anonymous_session,
    pending.moment,
    pending.idempotency_key,
  );
  await forgetClaim();
  return answered;
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
  // Anything left over from an attempt that never got an answer, before a new
  // one overwrites the record it is waiting on.
  await resumePendingClaim().catch(() => undefined);

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
  await forgetClaim();
  return {
    ...signedIn,
    mergedMemberships: claimed.merged_memberships,
    duplicatesRemoved: claimed.duplicates_removed,
  };
}
