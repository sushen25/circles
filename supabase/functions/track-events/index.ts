import {
  acceptEvent,
  isServerEvent,
  isUnattributed,
  TrackEventsRequest,
  type TrackEventsResponse,
} from '@circles/contracts';

import { sha256Hex } from '../_shared/hash.ts';
import { ingestHandler } from '../_shared/ingest.ts';
import { log } from '../_shared/logging.ts';
import { memberIdsOf } from '../_shared/memberIds.ts';
import { splitRecordable } from '../_shared/recordable.ts';
import { callerAddress, enforce, within } from '../_shared/rate.ts';

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
 * 4. **A caller records only what a caller can know** (SUS-185). An event the
 *    catalogue marks `source: 'server'` is a fact that a function owns and
 *    records with the service role; it is refused from every caller. A
 *    `circle_id` or `plan_id` is kept only when the caller is an active member
 *    of that circle, checked once for the whole batch, and is otherwise
 *    nulled, so a script cannot file events against a group it is not in. The
 *    two quiet-ask events are recorded against nobody, to the hour, whatever
 *    the caller sent. `client_error` is the app's, and is capped per address.
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

/**
 * How many crash reports one address may file a minute. A crash loop on a real
 * device is a handful; a script posting `client_error` is what inflates the
 * health email's counts and writes a log line per event. Over the limit they
 * are dropped (and counted), not refused: the rest of the batch is still wanted.
 */
const CLIENT_ERRORS_PER_MINUTE = 30;

/** An instant rounded down to the hour: fine enough for every count, too coarse to join on. */
function toTheHour(instant: string): string {
  const at = new Date(instant);
  at.setUTCMinutes(0, 0, 0);
  return at.toISOString();
}

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
    handle: async ({ body, actor, service, request, requestId }): Promise<TrackEventsResponse> => {
      const rows = [];
      const now = Date.now();

      // **Hashed, and only when there is nobody signed in.**
      //
      // Hashed because the schema cannot tell a browser id from anything else
      // of the same shape — a re-entry token is base64url and fits it exactly —
      // and a token in `analytics.events` is the thing non-negotiable 8 forbids
      // outright. A digest is as good an identifier and cannot be spent.
      //
      // Dropped when a bearer identified somebody, because storing both on one
      // row is a join from everything this browser did before signing in to the
      // account it signed in to. The contract promises the id is never joined
      // to a person; this is where that is true or false.
      // `sha256Hex` returns the `\x…` form a `bytea` parameter takes; this
      // column is `text`, so the prefix comes off.
      const anonymousId =
        actor === undefined && body.anonymous_id !== undefined
          ? (await sha256Hex(body.anonymous_id)).replace(/^\\x/, '')
          : null;

      // **Refused before anything is spent on them.** A server-side fact is
      // recorded by the function that owns it; the name is the catalogue's
      // (`accepted.name`), and the count is all that is kept of the refusal.
      const refused: Record<string, number> = {};
      const candidates = [];
      for (const event of body.events) {
        const accepted = acceptEvent(event.name, event.properties);
        if (accepted === null) continue;
        // A version the catalogue does not hold is a payload whose meaning we
        // cannot know — an old client sending a shape that has since changed,
        // or a new one deployed ahead of the server. Rejected rather than
        // stored under a version number that would make the two indistinguishable.
        if (accepted.version !== event.version) continue;
        if (isServerEvent(accepted.name)) {
          refused[accepted.name] = (refused[accepted.name] ?? 0) + 1;
          continue;
        }
        candidates.push({ event, accepted });
      }

      // Crash reports are bounded per address, one counter charged for the
      // batch's reports. Over the limit the reports are dropped, not the batch.
      const crashes = candidates.filter(({ accepted }) => accepted.name === 'client_error');
      let crashesAllowed = true;
      if (crashes.length > 0) {
        crashesAllowed = await within(service, {
          scope: 'track_client_error',
          key: callerAddress(request),
          max: CLIENT_ERRORS_PER_MINUTE,
          window: '1 minute',
          cost: crashes.length,
        });
        if (!crashesAllowed) refused['client_error'] = crashes.length;
      }
      const wanted = crashesAllowed
        ? candidates
        : candidates.filter(({ accepted }) => accepted.name !== 'client_error');

      // One lookup for the whole batch, and none at all when nobody is signed
      // in: an anonymous caller is a member of nothing.
      const mine = await memberIdsOf(
        service,
        actor?.userId,
        wanted.map(({ accepted }) => accepted.properties.circle_id),
        wanted.map(({ accepted }) => accepted.properties.plan_id),
      );

      for (const { event, accepted } of wanted) {
        // `circle_id` and `plan_id` are lifted out of the payload into their own
        // columns — the indexes are on those — and not left behind as well: a
        // value in two places is two values that can disagree. Kept only when
        // the caller belongs to the circle (see `memberIds.ts`).
        const { circle_id: circleId, plan_id: planId, ...properties } = accepted.properties;

        // **Recorded against nobody, to the hour, whatever the caller sent**
        // (SUS-51, SUS-185). The client splits these into a request of their
        // own and rounds the time, but a caller that does not is still stored
        // as if it had: nothing here trusts it to.
        const nobody = isUnattributed(accepted.name);
        const at = occurredAt(event.occurred_at, now);

        rows.push({
          event_id: event.event_id,
          event_name: accepted.name,
          schema_version: accepted.version,
          user_id: nobody ? null : (actor?.userId ?? null),
          anonymous_id: nobody ? null : anonymousId,
          circle_id: typeof circleId === 'string' && mine.circles.has(circleId) ? circleId : null,
          plan_id: typeof planId === 'string' && mine.plans.has(planId) ? planId : null,
          properties,
          occurred_at: nobody ? toTheHour(at) : at,
          // Absent means `now()`, to the millisecond, in `record_events`.
          ...(nobody ? { received_at: toTheHour(new Date(now).toISOString()) } : {}),
        });
      }

      if (Object.keys(refused).length > 0) {
        log('warn', {
          fn: 'track-events',
          request_id: requestId,
          event: 'events_refused',
          counts: refused,
        });
      }

      // **One bad event costs one event.** `record_events` inserts the batch in
      // one statement and `analytics.events` raises on a payload that carries
      // content, so a single route pattern or string outside the table's rule
      // used to take the other forty-nine with it (SUS-147). The same rule is
      // applied here to each row on its own; the table's constraint stays as the
      // backstop. What is kept of a dropped event is its catalogue name, counted.
      const { keep, dropped } = splitRecordable(rows);
      const droppedCount = rows.length - keep.length;
      if (droppedCount > 0) {
        log('warn', {
          fn: 'track-events',
          request_id: requestId,
          event: 'events_dropped',
          counts: dropped,
        });
      }

      if (keep.length > 0) {
        // Through a function, because `analytics` is not a schema PostgREST
        // exposes and should not become one. Already stored is already
        // accepted: the client resends a batch it could not confirm, and the
        // second arrival of an event is the same event rather than a new one.
        const { error } = await service.rpc('record_events', { p_rows: keep });
        if (error !== null) throw error;

        // A crash somebody read out to the founder (SUS-112, SUS-48's "a
        // reference from any error can be found in the logs"). These fields
        // have already passed the catalogue's patterns: a reference, a route
        // pattern, two fixed lists, a commit and a platform. Logged after the
        // insert, for every event the ingest accepted: a replay of an event id
        // already stored is a no-op on the row but is still a line, and the
        // client replays identical content, so the two agree.
        for (const row of keep) {
          if (row.event_name !== 'client_error') continue;
          const p = row.properties as Record<string, unknown>;
          log('info', {
            fn: 'track-events',
            request_id: requestId,
            event: 'client_error',
            client_error: {
              reference: String(p.reference),
              route: String(p.route),
              error_class: String(p.error_class),
              source: String(p.source),
              build: String(p.build),
              platform: String(p.platform),
            },
          });
        }
      }

      return { accepted: keep.length, rejected: body.events.length - keep.length };
    },
  }),
);
