import { z } from 'zod';

import { sha256Hex } from '../hash.ts';

/**
 * What a provider event means to us: which message, what happened, and
 * whether it is the kind of bounce that should stop us writing to the address.
 *
 * Only the fields used are read, and the schema is loose about everything
 * else: Resend adds fields to its events, and a webhook that refused an event
 * for carrying one more would drop exactly the bounces this exists to record.
 * The subject, the sender and the rest of the provider's copy of the message
 * are never read at all.
 */

/** Resend's event names, and the one each is stored as (`email_delivery_events_type`). */
const EVENT_TYPES = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'deferred',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
} as const;

export type DeliveryEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/** The analytics code for each (`email_delivery_result` in the catalogue). `sent` has none. */
export const ANALYTICS_CODE: Partial<
  Record<DeliveryEventType, 'delivered' | 'bounced' | 'complained' | 'deferred' | 'failed'>
> = {
  delivered: 'delivered',
  bounced: 'bounced',
  complained: 'complained',
  deferred: 'deferred',
  failed: 'failed',
};

const ProviderEvent = z.object({
  type: z.string(),
  created_at: z.string().optional(),
  data: z.object({
    email_id: z.string().min(1).max(200),
    created_at: z.string().optional(),
    to: z.array(z.string()).optional(),
    bounce: z.object({ type: z.string().optional() }).optional(),
  }),
});

export type DeliveryEvent = {
  readonly providerMessageId: string;
  readonly eventType: DeliveryEventType;
  /** When the provider says it happened, if it said. */
  readonly occurredAt: string | null;
  /**
   * False only for a bounce the provider calls transient. Resend's bounce
   * carries a `type` — `Permanent`, `Transient` or `Undetermined` — and
   * suppressing somebody for a full mailbox would be permanent punishment for
   * a passing state. Anything not called transient is treated as hard:
   * failing towards not writing to an address that bounced is the safe
   * direction.
   */
  readonly permanent: boolean;
  /**
   * `\x…` SHA-256 of the one recipient, normalised the way
   * `email_contacts.email_hash` is. The address is hashed here and goes no
   * further; null when there is not exactly one.
   */
  readonly recipientHash: string | null;
};

function instant(value: string | undefined): string | null {
  if (value === undefined) return null;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : new Date(millis).toISOString();
}

/** `Name <a@b>` or `a@b`, as `email_contacts.email_normalized` stores it. */
function normalised(recipient: string): string {
  const bracketed = /<([^>]+)>\s*$/.exec(recipient);
  return (bracketed?.[1] ?? recipient).trim().toLowerCase();
}

/** Null for an event we do not record — opened, clicked, or anything unreadable. */
export async function deliveryEventOf(payload: unknown): Promise<DeliveryEvent | null> {
  const parsed = ProviderEvent.safeParse(payload);
  if (!parsed.success) return null;
  const { type, data } = parsed.data;
  if (!Object.hasOwn(EVENT_TYPES, type)) return null;
  const eventType = EVENT_TYPES[type as keyof typeof EVENT_TYPES];

  const recipients = data.to ?? [];
  const only = recipients.length === 1 ? recipients[0] : undefined;

  return {
    providerMessageId: data.email_id,
    eventType,
    occurredAt: instant(parsed.data.created_at ?? data.created_at),
    permanent: eventType !== 'bounced' || data.bounce?.type?.toLowerCase() !== 'transient',
    recipientHash: only === undefined ? null : await sha256Hex(normalised(only)),
  };
}
