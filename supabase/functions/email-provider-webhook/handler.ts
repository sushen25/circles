import { validateEvent } from '@circles/contracts';

import { asService, type Db } from '../_shared/db.ts';
import { ANALYTICS_CODE, deliveryEventOf } from '../_shared/email/delivery.ts';
import { verifySvix } from '../_shared/email/svix.ts';
import { optional } from '../_shared/env.ts';
import { sha256 } from '../_shared/hash.ts';
import { log } from '../_shared/logging.ts';
import { reference } from '../_shared/respond.ts';

/**
 * The email provider telling us what happened to a message (architecture §13).
 *
 * Not one of the kit's wrappers, because its authority is none of theirs: no
 * user JWT, no `CRON_SECRET`, no token in the body. It is a signature over the
 * raw bytes of the request, which has to be checked before those bytes are
 * parsed — so the wrapper that parses first cannot be the one that serves it.
 *
 * **Fails closed.** With no `RESEND_WEBHOOK_SECRET` every request is refused,
 * exactly as `internalHandler` refuses without `CRON_SECRET`: an endpoint that
 * suppresses addresses on the word of whoever calls it is worse than one that
 * records nothing. The provider retries a refused event, so events sent while
 * the secret is being set are not lost, only late.
 *
 * **After the signature, 200 unless we failed.** An event we do not record —
 * opened, clicked, a shape we cannot read — is acknowledged and dropped, so the
 * provider does not retry it for days. Our own failure (the database) is a 500,
 * so the provider *does* retry: a bounce acknowledged and then lost is an
 * address we go on writing to. The store is idempotent, so the retry is safe.
 *
 * Logs carry the request id, the event type and the contact id. Never the
 * address, which is hashed on the way in and goes no further.
 */

export type WebhookDeps = {
  secret: () => string | undefined;
  service: () => Db;
  /** Seconds since the epoch. */
  now: () => number;
};

const DEFAULTS: WebhookDeps = {
  secret: () => optional('RESEND_WEBHOOK_SECRET'),
  service: asService,
  now: () => Math.floor(Date.now() / 1000),
};

const NAME = 'email-provider-webhook';

/**
 * The analytics row's id, derived from the event rather than drawn at random,
 * so that a retried webhook lands on the row the first attempt wrote
 * (`record_events` ignores an id it already holds) instead of counting twice.
 */
async function eventIdOf(providerMessageId: string, eventType: string): Promise<string> {
  const hex = [...(await sha256(`${NAME}:${providerMessageId}:${eventType}`))]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Recorded = {
  recorded: boolean;
  suppressed: boolean;
  contact_id: string | null;
  plan_id: string | null;
  circle_id: string | null;
};

export function emailProviderWebhook(
  deps: WebhookDeps = DEFAULTS,
): (request: Request) => Promise<Response> {
  return async function serve(request: Request): Promise<Response> {
    const started = Date.now();
    const requestId = reference();

    const answer = (
      status: number,
      body: Record<string, unknown>,
      event: string,
      extra: { reason?: string | undefined; contact_id?: string | undefined } = {},
    ): Response => {
      log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', {
        fn: NAME,
        request_id: requestId,
        event,
        status,
        duration_ms: Date.now() - started,
        ...extra,
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'x-request-id': requestId },
      });
    };

    if (request.method !== 'POST') {
      return answer(405, { error: 'method_not_allowed' }, 'refused');
    }

    const body = await request.text();
    const secret = deps.secret();
    const verdict =
      secret === undefined
        ? 'unconfigured'
        : await verifySvix({ secret, headers: request.headers, body, now: deps.now() });
    if (verdict !== 'ok') {
      // One answer for every way of not being the provider. Which it was is
      // ours to know from the log, and saying so would tell a caller whether
      // the endpoint is armed.
      return answer(401, { error: 'unauthorised' }, 'refused', { reason: verdict });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return answer(200, { received: true }, 'ignored', { reason: 'unreadable' });
    }

    const event = await deliveryEventOf(payload);
    if (event === null) {
      return answer(200, { received: true }, 'ignored', { reason: 'not_recorded' });
    }

    try {
      const service = deps.service();
      const { data, error } = await service.rpc('record_email_delivery', {
        p_provider_message_id: event.providerMessageId,
        p_event_type: event.eventType,
        p_occurred_at: event.occurredAt,
        p_permanent: event.permanent,
        p_email_hash: event.recipientHash,
      });
      if (error !== null) throw new Error('record_email_delivery_failed');
      const recorded = data as Recorded;

      const code = ANALYTICS_CODE[event.eventType];
      const accepted =
        code === undefined
          ? null
          : validateEvent('email_delivery_result', {
              code,
              ...(recorded.plan_id === null ? {} : { plan_id: recorded.plan_id }),
              ...(recorded.circle_id === null ? {} : { circle_id: recorded.circle_id }),
            });
      if (accepted !== null) {
        const { circle_id: circleId, plan_id: planId, ...properties } = accepted.properties;
        const { error: tracked } = await service.rpc('record_events', {
          p_rows: [
            {
              event_id: await eventIdOf(event.providerMessageId, event.eventType),
              event_name: accepted.name,
              schema_version: accepted.version,
              user_id: null,
              anonymous_id: null,
              circle_id: circleId ?? null,
              plan_id: planId ?? null,
              properties,
              occurred_at: event.occurredAt ?? new Date().toISOString(),
            },
          ],
        });
        if (tracked !== null) throw new Error('record_events_failed');
      }

      return answer(
        200,
        { received: true },
        recorded.recorded ? (recorded.suppressed ? 'suppressed' : 'recorded') : 'replayed',
        { reason: event.eventType, contact_id: recorded.contact_id ?? undefined },
      );
    } catch (thrown) {
      // A Postgres message can quote the row that caused it; only our own code
      // is logged.
      const reason = thrown instanceof Error ? thrown.message : 'failed';
      return answer(500, { error: 'unavailable' }, 'failed', {
        reason: /^[a-z_]+$/.test(reason) ? reason : 'failed',
      });
    }
  };
}
