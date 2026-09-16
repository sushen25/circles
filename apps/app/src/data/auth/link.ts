import { ClaimIdentityResponse, type ClaimIdentityRequest, type Problem } from '@circles/contracts';

import { newIdempotencyKey, problemOf } from '../functions';
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
 *
 * **Keyed by destination, so there can be more than one.** A single record
 * meant the next claim overwrote whatever was waiting: a stranded claim for one
 * identity, then a fresh guest on the same browser saving their place, and the
 * first person's only evidence was gone. One browser can carry claims for
 * several people — a shared laptop is the ordinary case, not the exotic one.
 */
const PENDING_KEY = 'circles.pending_claims';

interface PendingClaim {
  anonymous_session: string;
  idempotency_key: string;
  moment: SaveMoment;
  /**
   * The identity the memberships were being moved **to**.
   *
   * Without it the record says only where they came from, and resuming it for
   * whoever happens to be signed in later hands a stranger the guest's circles
   * — a shared browser, a sign-out, the next person's sign-in, and their
   * account receives somebody else's memberships. The claim is a sentence with
   * two halves and storing one of them is not storing the claim.
   */
  destination_user_id: string;
  /**
   * The anonymous session's **refresh** token, which is what makes the record
   * outlive the hour.
   *
   * An access token expires in `jwt_expiry`, one hour by default. Storing only
   * that gave the recovery a sixty-minute fuse: an app killed mid-claim and
   * reopened the next morning replayed a JWT the auth server no longer
   * accepted, `claim-identity` answered `source_is_permanent`, and the record
   * was dropped as a definitive refusal — the membership lost silently, which
   * is the outcome the whole mechanism exists to prevent. The refresh token is
   * in hand at the same moment as the access token, so keeping it costs a
   * field and buys the difference between "recoverable today" and
   * "recoverable".
   */
  anonymous_refresh_token?: string;
}

function usable(claim: PendingClaim | undefined): claim is PendingClaim {
  // A record missing any part is not resumable, and that includes one written
  // by an older build with a different shape.
  return (
    typeof claim?.anonymous_session === 'string' &&
    typeof claim.idempotency_key === 'string' &&
    typeof claim.destination_user_id === 'string'
  );
}

async function allClaims(): Promise<Record<string, PendingClaim>> {
  try {
    const raw = await sessionStorage.getItem(PENDING_KEY);
    if (raw === null || raw === undefined) return {};
    const parsed = JSON.parse(raw) as Record<string, PendingClaim>;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, claim]) => usable(claim)));
  } catch {
    return {};
  }
}

async function writeClaims(claims: Record<string, PendingClaim>): Promise<void> {
  try {
    if (Object.keys(claims).length === 0) {
      await sessionStorage.removeItem(PENDING_KEY);
      return;
    }
    await sessionStorage.setItem(PENDING_KEY, JSON.stringify(claims));
  } catch {
    // Storage refusing is not a reason to lose the error the caller is about
    // to see; the claim is simply not resumable on this device.
  }
}

/**
 * Merges, rather than replaces.
 *
 * Replacing lost the refresh token on every resume that did not succeed:
 * `freshAnonymousToken` wrote the rotated one back, and the `claimIdentity`
 * that followed immediately overwrote the record without it — so a failed
 * retry, or an app simply started before the radio was up, put the sixty-minute
 * fuse back with nothing to say it had. A record is built up by more than one
 * caller; only the fields a caller actually has should move.
 */
async function rememberClaim(
  claim: Partial<PendingClaim> & { destination_user_id: string },
): Promise<void> {
  const claims = await allClaims();
  const existing = claims[claim.destination_user_id];
  const merged = { ...existing, ...claim } as PendingClaim;
  if (!usable(merged)) return;
  claims[claim.destination_user_id] = merged;
  await writeClaims(claims);
}

/** Drops one identity's claim and leaves everybody else's alone. */
async function forgetClaim(destinationUserId: string): Promise<void> {
  const claims = await allClaims();
  if (!(destinationUserId in claims)) return;
  delete claims[destinationUserId];
  await writeClaims(claims);
}

async function pendingClaim(destinationUserId: string): Promise<PendingClaim | undefined> {
  const claim = (await allClaims())[destinationUserId];
  return usable(claim) ? claim : undefined;
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
  return (
    problem.reason === 'in_progress' ||
    problem.reason === 'too_many_requests' ||
    // The server fingerprints the whole body, and a resumed claim can carry a
    // re-minted token under the old key — or arrive while the first attempt is
    // still in flight. Either way the question has not been answered, and
    // dropping the record here would discard the only evidence over a
    // bookkeeping collision.
    problem.reason === 'idempotency_mismatch'
  );
}

async function claimIdentity(
  anonymousSession: string,
  moment: SaveMoment,
  destinationUserId: string,
  existingKey?: string,
  anonymousRefreshToken?: string,
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
  await rememberClaim({
    anonymous_session: anonymousSession,
    idempotency_key: key,
    moment,
    destination_user_id: destinationUserId,
    ...(anonymousRefreshToken === undefined
      ? {}
      : { anonymous_refresh_token: anonymousRefreshToken }),
  });

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
    if (!stillOpen(problem)) await forgetClaim(destinationUserId);
    throw error;
  };

  try {
    const answered = await attempt();
    await forgetClaim(destinationUserId);
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
        await forgetClaim(destinationUserId);
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
  const { data } = await authClient().auth.getSession();
  // Only a permanent session can be a destination; asking from an anonymous one
  // is refused with `destination_is_not_permanent`.
  if (data.session === null || data.session.user.is_anonymous === true) return undefined;

  // Only this identity's claim. Anybody else's stays where it is, waiting for
  // them — on a shared browser the next account to sign in would otherwise
  // collect the first person's circles.
  const pending = await pendingClaim(data.session.user.id);
  if (pending === undefined) return undefined;

  // The stored access token may be hours old. Mint a fresh one rather than
  // find out from a refusal that cannot be told apart from a real one.
  const fresh = await freshAnonymousToken(pending);
  if (fresh === undefined) {
    // The evidence really has expired. Nothing can be claimed with it again, so
    // keeping the record would only strand it somewhere it cannot be seen.
    await forgetClaim(pending.destination_user_id);
    return undefined;
  }

  const answered = await claimIdentity(
    fresh.token,
    pending.moment,
    pending.destination_user_id,
    // A re-minted token is a **different body**, and the server fingerprints
    // the whole body against the key. Replaying the old key would answer
    // `idempotency_mismatch` rather than resuming. A fresh key is safe here
    // precisely because `public.claim_identity` is idempotent in the database:
    // the key stops a double *request*, and the SQL stops a double *claim*.
    fresh.reminted ? undefined : pending.idempotency_key,
  );
  await forgetClaim(pending.destination_user_id);
  return answered;
}

/**
 * A usable access token for the abandoned anonymous session.
 *
 * Exchanged directly rather than through `supabase-js`, because every method
 * that refreshes also *installs* the result as the current session — and the
 * current session is the permanent identity we are claiming *into*. This has to
 * mint a token for somebody else without becoming them.
 *
 * The rotated refresh token is written back, so a second interrupted attempt
 * has something good to use rather than a token already spent.
 */
async function freshAnonymousToken(
  pending: PendingClaim,
): Promise<{ token: string; reminted: boolean } | undefined> {
  if (pending.anonymous_refresh_token === undefined) {
    return { token: pending.anonymous_session, reminted: false };
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || key === undefined) {
    return { token: pending.anonymous_session, reminted: false };
  }

  try {
    const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: pending.anonymous_refresh_token }),
    });
    /**
     * Only a refusal means the evidence is gone.
     *
     * A 502 from Kong, GoTrue restarting, or the token endpoint's own per-IP
     * limit at app start are all `!ok`, and reading them as "expired" dropped
     * the record and lost the membership — for a blip. A 4xx is the auth server
     * answering about this token (`invalid_grant`, already used, unknown);
     * anything else is it not answering at all, and the record should wait.
     */
    /**
     * Only a 400 is a verdict on *this token*.
     *
     * GoTrue answers 400 with `validation_failed`, `refresh_token_not_found` or
     * `refresh_token_already_used` — all final. Everything else is about
     * something other than the token and must not discard it: 429 is the token
     * endpoint's own rate limit, which an app start can hit, and 401 is the
     * gateway rejecting the *anon key*, which a build with a rotated key
     * produces for every stranded claim it ever sees.
     */
    if (!response.ok) {
      if (response.status === 400) return undefined;
      return { token: pending.anonymous_session, reminted: false };
    }

    const body = (await response.json()) as { access_token?: string; refresh_token?: string };
    if (typeof body.access_token !== 'string') return undefined;

    await rememberClaim({
      ...pending,
      anonymous_session: body.access_token,
      ...(typeof body.refresh_token === 'string'
        ? { anonymous_refresh_token: body.refresh_token }
        : {}),
    });
    return { token: body.access_token, reminted: true };
  } catch {
    // Offline. The record stays; the next start tries again.
    return { token: pending.anonymous_session, reminted: false };
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
  // Anything left over from an attempt that never got an answer, before a new
  // one overwrites the record it is waiting on.
  await resumePendingClaim().catch(() => undefined);

  const { data } = await authClient().auth.getSession();
  const previous = data.session;
  const anonymousToken = isAnonymous(previous) ? previous?.access_token : undefined;
  // Captured in the same breath as the access token, and for the same reason:
  // after `signIn()` neither exists anywhere the client can reach.
  const anonymousRefresh = isAnonymous(previous) ? previous?.refresh_token : undefined;

  const signedIn = await options.signIn();

  if (anonymousToken === undefined) {
    // A first-run organiser with no guest session behind them. Nothing was left
    // behind, so there is nothing to claim — and `anonymous_session` has no
    // honest value to carry.
    return { ...signedIn, mergedMemberships: 0, duplicatesRemoved: 0 };
  }

  const claimed = await claimIdentity(
    anonymousToken,
    options.moment,
    signedIn.session.user.id,
    undefined,
    anonymousRefresh,
  );
  await forgetClaim(signedIn.session.user.id);
  return {
    ...signedIn,
    mergedMemberships: claimed.merged_memberships,
    duplicatesRemoved: claimed.duplicates_removed,
  };
}
