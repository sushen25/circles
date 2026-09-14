import type { Problem, ProblemReason } from '@circles/contracts';

/**
 * Turning a failure into something a client can act on, without telling it
 * anything it should not know.
 *
 * Two levels, as `Problem` describes: a coarse `error` that picks the status
 * code, and a precise `reason` that picks the screen. The mapping below is the
 * only place a database error name becomes either — so a function raises
 * `duplicate_name` and stops caring what HTTP means.
 */

export class Refusal extends Error {
  constructor(
    readonly reason: ProblemReason,
    /** Safe to show. Never a name, an address, or anything the caller supplied. */
    override readonly message: string,
  ) {
    super(message);
    this.name = 'Refusal';
  }
}

/**
 * Something we depend on could not be reached — and nothing was done.
 *
 * Distinct from `Refusal`, which says *no*, and from a bare `Error`, which the
 * wrapper has to treat as possibly-committed and therefore keeps the idempotency
 * claim for. A handler that fails before it calls the product's RPC knows that much
 * and can say so: the claim is given back, and the caller is told 503 rather than
 * being sent to fix something that is ours.
 */
export class Unavailable extends Error {
  constructor(override readonly message = 'Something went wrong at our end.') {
    super(message);
    this.name = 'Unavailable';
  }
}

/** What each reason means to HTTP, and what we are willing to say about it. */
const REASONS: Record<ProblemReason, { status: number; error: Problem['error'] }> = {
  // A link that is not live is indistinguishable from one that never existed,
  // and deliberately so: the difference would confirm that a circle is there.
  invite_inactive: { status: 404, error: 'not_found' },
  circle_full: { status: 409, error: 'conflict' },
  duplicate_name: { status: 409, error: 'conflict' },
  member_not_found: { status: 404, error: 'not_found' },
  target_is_permanent: { status: 403, error: 'forbidden' },
  caller_is_permanent: { status: 403, error: 'forbidden' },
  already_member: { status: 409, error: 'conflict' },
  reattach_limit: { status: 429, error: 'rate_limited' },
  token_invalid: { status: 404, error: 'not_found' },
  source_is_permanent: { status: 403, error: 'forbidden' },
  destination_is_not_permanent: { status: 403, error: 'forbidden' },
  display_name_unusable: { status: 400, error: 'invalid_request' },
  idempotency_mismatch: { status: 409, error: 'conflict' },
  in_progress: { status: 409, error: 'conflict' },
  too_many_requests: { status: 429, error: 'rate_limited' },

  // S1-15. The three that are about *who* are `forbidden`; the rest are the
  // caller asking for something that cannot be, which is `invalid_request`
  // unless the thing itself is missing or gone.
  requires_saved_place: { status: 403, error: 'forbidden' },
  not_the_owner: { status: 403, error: 'forbidden' },
  not_the_organiser: { status: 403, error: 'forbidden' },
  not_the_organiser_or_owner: { status: 403, error: 'forbidden' },
  not_yet: { status: 501, error: 'unavailable' },
  plan_is_finished: { status: 409, error: 'conflict' },
  wrong_state: { status: 409, error: 'conflict' },
  plan_not_found: { status: 404, error: 'not_found' },
  circle_not_found: { status: 404, error: 'not_found' },
  circle_archived: { status: 409, error: 'conflict' },
  too_late_for_tonight: { status: 400, error: 'invalid_request' },
  window_too_long: { status: 400, error: 'invalid_request' },
  window_backwards: { status: 400, error: 'invalid_request' },
  window_has_passed: { status: 400, error: 'invalid_request' },
  band_shorter_than_meetup: { status: 400, error: 'invalid_request' },
  band_backwards: { status: 400, error: 'invalid_request' },
  band_unaligned: { status: 400, error: 'invalid_request' },
  band_out_of_day: { status: 400, error: 'invalid_request' },
  deadline_out_of_range: { status: 400, error: 'invalid_request' },
  not_a_participant: { status: 400, error: 'invalid_request' },
  nothing_to_change: { status: 400, error: 'invalid_request' },
  note_not_allowed: { status: 400, error: 'invalid_request' },
};

/**
 * The database raises these by name — `raise exception 'duplicate_name'` — and
 * this is where the name becomes a response. Postgres puts the raised text in
 * `message`; `postgrest-js` passes it through untouched.
 *
 * Matched exactly, not by substring: `message.includes('member_not_found')`
 * would also match an error whose text merely mentioned it, and an exception
 * text is not a stable interface.
 */
export function reasonOf(
  error: { message?: string } | null | undefined,
): ProblemReason | undefined {
  const message = error?.message?.trim();
  if (message === undefined) return undefined;
  return message in REASONS ? (message as ProblemReason) : undefined;
}

export function problemFor(
  reason: ProblemReason,
  message: string,
  reference: string,
): { status: number; body: Problem } {
  const { status, error } = REASONS[reason];
  return {
    status,
    body: { error, reason, message, reference: reference as Problem['reference'] },
  };
}

export function plainProblem(
  error: Problem['error'],
  status: number,
  message: string,
  reference: string,
): { status: number; body: Problem } {
  return { status, body: { error, message, reference: reference as Problem['reference'] } };
}

/**
 * How to read a failure: what it was, and whether anything happened.
 *
 * Both questions at once, because the answers come from the same evidence and
 * keeping them apart is how the wrapper's catch got this wrong in three different
 * ways across eleven review rounds.
 *
 * `committed: 'no'` means the idempotency claim can be given back and a retry is a
 * genuine retry. `'maybe'` means it must be kept: a failure with no SQLSTATE and no
 * name of ours might be a connection lost after the commit, and a reattachment that
 * already happened does not survive being done twice.
 */
export interface Outcome {
  readonly reason?: ProblemReason;
  readonly unavailable: boolean;
  readonly committed: 'no' | 'maybe';
  /** A SQLSTATE or a short word. Never a message: Postgres quotes rows in those. */
  readonly code: string;
}

export function outcomeOf(thrown: unknown): Outcome {
  if (thrown instanceof Refusal) {
    return { reason: thrown.reason, unavailable: false, committed: 'no', code: thrown.reason };
  }

  if (thrown instanceof Unavailable) {
    // Thrown by a handler that failed before it called anything.
    return { unavailable: true, committed: 'no', code: 'unavailable' };
  }

  const named = reasonOf(thrown as { message?: string } | undefined);
  if (named !== undefined) {
    return { reason: named, unavailable: false, committed: 'no', code: named };
  }

  // A five-character SQLSTATE is Postgres reporting that it refused the statement,
  // which means the transaction is gone — even when the reason is not one of ours.
  // PostgREST's own codes are eight characters (`PGRST116`), so they cannot be
  // mistaken for it.
  const code = (thrown as { code?: unknown } | undefined)?.code;
  const aborted = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);

  return {
    unavailable: false,
    committed: aborted ? 'no' : 'maybe',
    code: typeof code === 'string' ? code : 'unknown',
  };
}
