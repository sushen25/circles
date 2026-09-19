import { z } from 'zod';

/**
 * Identifiers, branded so one kind cannot be passed where another is expected.
 *
 * A `PlanId` and a `CircleId` are both uuids at runtime; the brand exists so
 * that swapping them is a compile error rather than a query that quietly
 * returns nothing.
 */
function uuid<Brand extends string>(_brand: Brand) {
  return z.uuid().brand<Brand>();
}

export const CircleId = uuid('CircleId');
/**
 * A membership has no id of its own. `circle_members` is keyed by
 * `(circle_id, user_id)` and the domain identifies members by `UserId`
 * throughout (`activeMemberIds`, `requiredMemberIds`), so a separate `MemberId`
 * brand was a third name for the same thing — and the one that disagreed with
 * the other two. A member is a `UserId` in a circle.
 */
export const UserId = uuid('UserId');
export const PlanId = uuid('PlanId');
// No `CandidateId` either, and for a sharper reason: a candidate's identity *is*
// the instant it starts. The domain says so (`candidateIdOf` returns the ISO
// start) and so does the column that stores it — "the client's candidate id is
// the ISO start" — because the set is recomputed whenever anybody answers, and a
// row id the organiser was holding would point at a row that no longer exists
// while the time they chose is still the time they chose. `confirm-meetup` takes
// an `Instant`.

// No `RevisionId`. A revision is a counter on the plan — `plans.revision`, an
// integer that an edit increments — and a uuid for it was a scaffold's guess
// that nothing ever issued. The one place that referenced it asked callers for
// a uuid where `replace_response` takes an integer, so the id a client sent
// could never have matched the revision it was answering.
export const ResponseId = uuid('ResponseId');
export const CandidateSetId = uuid('CandidateSetId');
export const ConfirmationId = uuid('ConfirmationId');
export const InviteId = uuid('InviteId');
export const ContactId = uuid('ContactId');

export type CircleId = z.infer<typeof CircleId>;
export type UserId = z.infer<typeof UserId>;
export type PlanId = z.infer<typeof PlanId>;
export type ResponseId = z.infer<typeof ResponseId>;
export type CandidateSetId = z.infer<typeof CandidateSetId>;
export type ConfirmationId = z.infer<typeof ConfirmationId>;
export type InviteId = z.infer<typeof InviteId>;
export type ContactId = z.infer<typeof ContactId>;

/**
 * Short codes in links (`/j/:code`, `/p/:code`). Deliberately not uuids: they
 * are read aloud and pasted into chats, so they are short, lowercase and free
 * of characters that look like each other.
 */
export const ShortCode = z
  .string()
  .regex(/^[a-hjkmnp-z2-9]{6,12}$/, 'not a short code')
  .brand<'ShortCode'>();
export type ShortCode = z.infer<typeof ShortCode>;

/**
 * Tokens from emails (`/a#`, `/e#`, `/v#` — in the fragment, ADR 0023). Opaque
 * and high-entropy; never logged, never in analytics, never in a path.
 */
export const OpaqueToken = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/, 'not a token')
  .brand<'OpaqueToken'>();
export type OpaqueToken = z.infer<typeof OpaqueToken>;

/** Idempotency key supplied by the client on every mutation (architecture §9.1). */
export const IdempotencyKey = z.uuid().brand<'IdempotencyKey'>();
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

/** Echoed to the user as a reference on errors ("Ref 7F3K-2Q"). */
export const RequestId = z.string().min(1).max(64).brand<'RequestId'>();
export type RequestId = z.infer<typeof RequestId>;
