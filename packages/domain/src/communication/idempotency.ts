/**
 * `idempotency_key = hash(channel, recipient, plan, revision, kind, occurrence)`
 * (architecture §13).
 *
 * The unique index on that column is what makes a duplicate impossible under
 * retry, so the only thing this has to get right is that two different sends
 * never produce the same string. Every part is length-prefixed before joining:
 * a plain separator would let `("ab", "c")` and `("a", "bc")` collide, and a
 * collision here is a notification that silently never arrives.
 *
 * The digest is `crypto.subtle`, which exists unchanged in Node, Deno and the
 * browser — the three places this package runs. It is asynchronous, which is
 * why `idempotencyKey` is; `idempotencyInput` is the same value synchronously,
 * for tests and for a caller that would rather let Postgres hash it.
 */

import type { UserId } from '../circles/types.js';
import type { PlanId } from '../planning/types.js';
import type { Channel, NotificationKind } from './kinds.js';

export type IdempotencyParts = {
  readonly channel: Channel;
  readonly recipientId: UserId | string;
  /**
   * Absent for a kind that belongs to a circle rather than a plan — the cadence
   * nudge is the only one today. An absent plan is distinct from any present
   * one, because the length prefix makes an empty part unambiguous.
   */
  readonly planId?: PlanId | undefined;
  readonly revision?: number | undefined;
  readonly kind: NotificationKind;
  readonly occurrence: string;
};

/** Length-prefixed, so no value can be confused with a boundary. */
function canonical(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join('');
}

export function idempotencyInput(parts: IdempotencyParts): string {
  return canonical([
    parts.channel,
    parts.recipientId,
    parts.planId ?? '',
    parts.revision === undefined ? '' : String(parts.revision),
    parts.kind,
    parts.occurrence,
  ]);
}

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The stored key: SHA-256 of the canonical string, lower-case hex. */
export async function idempotencyKey(parts: IdempotencyParts): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(idempotencyInput(parts)));
  return toHex(digest);
}
