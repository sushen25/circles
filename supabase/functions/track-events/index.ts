import { acceptEvent, TrackEventsRequest, type TrackEventsResponse } from '@circles/contracts';

import { ingestHandler } from '../_shared/ingest.ts';
import { callerAddress, enforce } from '../_shared/rate.ts';

/**
 * First-party analytics ingest (architecture §15).
 *
 * Three rules, and the third is the one that matters:
 *
 * 1. **The catalogue decides what exists.** An event it does not declare is
 *    rejected, not stored under a name nobody can query.
 * 2. **Unknown keys are dropped rather than refusing the event.** A tab open
 *    since before a deploy should still be counted for the release the count is
 *    about — `acceptEvent` strips to the declared keys and *then* validates.
 * 3. **Nothing a person wrote reaches the table.** The catalogue's payloads are
 *    ids, enums, counts and booleans; `analytics.events` additionally refuses a
 *    key or a value that could carry words (`jobs.carries_content`). Two
 *    defences, because this is the one endpoint whose whole job is to accept
 *    data a client made up.
 *
 * The response says how many of each and nothing about which: answering "was
 * *this* event accepted" one at a time would be a validation oracle for a
 * schema the caller is not entitled to enumerate.
 */
/**
 * The client's clock, unless it is not believable.
 *
 * A device's clock is wrong often enough to matter — a fresh phone before it
 * syncs, a browser on a machine somebody set back — and the schema cannot tell
 * a wrong one from a right one. Two things follow. A year Postgres will not
 * store (`0000-01-01`, which `z.iso.datetime` accepts) raises inside
 * `record_events` and takes the other forty-nine events of the batch down with
 * it. And a plausible-but-wrong one files a real event in a month nobody will
 * look at, which is a measurement quietly lost rather than loudly missing.
 *
 * So anything further than a month either side of the server's clock is
 * recorded as *now*. The event survives, in the only month we can defend.
 */
const A_MONTH = 30 * 24 * 60 * 60 * 1000;

function occurredAt(claimed: string, now: number): string {
  const at = Date.parse(claimed);
  if (!Number.isFinite(at) || Math.abs(at - now) > A_MONTH) return new Date(now).toISOString();
  return claimed;
}

Deno.serve(
  ingestHandler({
    name: 'track-events',
    schema: TrackEventsRequest,
    guard: async ({ actor, body, request, service }) => {
      // Six hundred *events* a minute, which is what the number has to count:
      // a batch is up to fifty, so charging one token a request would have
      // allowed thirty thousand. Per user when there is one, and always per
      // connection — an anonymous identity is free to mint, an address is not.
      const cost = body.events.length;
      await enforce(service, [
        ...(actor === undefined
          ? []
          : [{ scope: 'track_user', key: actor.userId, max: 600, window: '1 minute', cost }]),
        { scope: 'track_ip', key: callerAddress(request), max: 600, window: '1 minute', cost },
      ]);
    },
    handle: async ({ body, actor, service }): Promise<TrackEventsResponse> => {
      const rows = [];
      const now = Date.now();

      for (const event of body.events) {
        const accepted = acceptEvent(event.name, event.properties);
        if (accepted === null) continue;
        // A version the catalogue does not hold is a payload whose meaning we
        // cannot know — an old client sending a shape that has since changed,
        // or a new one deployed ahead of the server. Rejected rather than
        // stored under a version number that would make the two indistinguishable.
        if (accepted.version !== event.version) continue;

        // `circle_id` and `plan_id` are lifted out of the payload into their own
        // columns — the indexes are on those — and not left behind as well: a
        // value in two places is two values that can disagree.
        const { circle_id: circleId, plan_id: planId, ...properties } = accepted.properties;

        rows.push({
          event_id: event.event_id,
          event_name: accepted.name,
          schema_version: accepted.version,
          user_id: actor?.userId ?? null,
          anonymous_id: body.anonymous_id ?? null,
          circle_id: typeof circleId === 'string' ? circleId : null,
          plan_id: typeof planId === 'string' ? planId : null,
          properties,
          occurred_at: occurredAt(event.occurred_at, now),
        });
      }

      if (rows.length > 0) {
        // Through a function, because `analytics` is not a schema PostgREST
        // exposes and should not become one. Already stored is already
        // accepted: the client resends a batch it could not confirm, and the
        // second arrival of an event is the same event rather than a new one.
        const { error } = await service.rpc('record_events', { p_rows: rows });
        if (error !== null) throw error;
      }

      return { accepted: rows.length, rejected: body.events.length - rows.length };
    },
  }),
);
