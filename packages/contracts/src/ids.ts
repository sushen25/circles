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
export const MemberId = uuid('MemberId');
export const UserId = uuid('UserId');
export const PlanId = uuid('PlanId');
export const RevisionId = uuid('RevisionId');
export const ResponseId = uuid('ResponseId');
export const CandidateSetId = uuid('CandidateSetId');
export const CandidateId = uuid('CandidateId');
export const ConfirmationId = uuid('ConfirmationId');
export const InviteId = uuid('InviteId');
export const ContactId = uuid('ContactId');

export type CircleId = z.infer<typeof CircleId>;
export type MemberId = z.infer<typeof MemberId>;
export type UserId = z.infer<typeof UserId>;
export type PlanId = z.infer<typeof PlanId>;
export type RevisionId = z.infer<typeof RevisionId>;
export type ResponseId = z.infer<typeof ResponseId>;
export type CandidateSetId = z.infer<typeof CandidateSetId>;
export type CandidateId = z.infer<typeof CandidateId>;
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
 * Single-use tokens from emails (`/a/:token`, `/e/:token`, `/v/:token`). Opaque
 * and high-entropy; never logged, never in analytics.
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
