import { brand } from '@circles/config';
import { DEEP_LINK_ROUTES, GenerateIcsRequest } from '@circles/contracts';
import {
  confirmationId,
  icsFilename,
  icsFor,
  planId,
  toLocal,
  userId,
  type Confirmation,
  type ConfirmationStatus,
} from '@circles/domain';

import { checkCalendarToken, signCalendarToken } from '../_shared/calendarToken.ts';
import type { Db } from '../_shared/db.ts';
import { downloadHandler, type Download } from '../_shared/download.ts';
import { optional } from '../_shared/env.ts';
import { now, toInstant, toZone } from '../_shared/moment.ts';
import { Refusal } from '../_shared/problem.ts';

/**
 * The confirmed meetup as a calendar file (spec §5.7: "web participants get an
 * `.ics` download").
 *
 * Read-only, and the read is the authorisation: `meetup_confirmations` is
 * selectable by active members of the circle and by nobody else, so a
 * confirmation that comes back is one this person may have. Nothing is written
 * and nothing is decided — `icsFor` in `packages/domain` builds the file, folds
 * the lines to 75 octets and escapes the text, because RFC 5545 is a
 * calculation and not an orchestration.
 *
 * **Three ways in** (ADR 0063). The bearer gets the file, as it always did.
 * The bearer with `format=link` gets a token: 15 minutes, HMAC-signed, for this
 * one confirmation. And a request with that token and **no bearer** gets the
 * file, because a navigation cannot send one and iOS opens a plain link into
 * the system "Add to Calendar" sheet. A request with neither gets nothing, and
 * reads nothing. The token is never logged: the kit logs fixed fields, and the
 * query string is not one of them.
 *
 * **No tokens in the file** (architecture §14). An `.ics` is forwarded, synced
 * to other devices and indexed by desktop search, so the only link it carries is
 * the plan's short link — a public path with no secret in it — and `icsFor`
 * throws rather than embedding anything else.
 *
 * A superseded or cancelled confirmation still downloads, with `STATUS:CANCELLED`:
 * "Thursday is off the table" (§5.7) is a thing a calendar needs to be told, and
 * refusing the file would leave the old event sitting in it.
 */
const SELECT =
  'id, plan_id, revision, starts_at, ends_at, available_user_ids, place_name, place_url, note, confirmed_by, status, confirmed_at, calendar_uid, calendar_sequence, plans(title, short_code, time_zone, circles(name))';

Deno.serve(
  downloadHandler({
    name: 'generate-ics',
    schema: GenerateIcsRequest,
    handle: async ({ query, caller }) => {
      if (query.format === 'link') return await linkFor(caller, query.confirmation_id);
      return await fileFor(caller, query.confirmation_id, 'attachment');
    },
    byToken: async ({ query, service }) => {
      const key = optional('CALENDAR_LINK_KEY');
      const refused = (): Refusal =>
        // One answer for every way a token can be wrong, so a bad one teaches
        // nothing: not that it expired, not that the signature was close.
        new Refusal('token_invalid', 'That calendar link is no longer valid.');
      if (key === undefined || query.token === undefined) throw refused();
      const checked = await checkCalendarToken(key, query.token, query.confirmation_id, Date.now());
      if (checked !== 'ok') throw refused();
      // Only now, and only for the one id the signature covers: the token is
      // the authorisation, so this reads as the service role.
      return await fileFor(service, query.confirmation_id, 'inline');
    },
  }),
);

/** `format=link`: row-level security first (may this person see it?), then a token. */
async function linkFor(caller: Db, confirmationId: string): Promise<Download> {
  const { data, error } = await caller
    .from('meetup_confirmations')
    .select('id')
    .eq('id', confirmationId)
    .maybeSingle();
  if (error !== null) throw error;
  if (data === null) throw new Refusal('confirmation_not_found', 'That meetup is not there.');

  const key = optional('CALENDAR_LINK_KEY');
  const signed =
    key === undefined ? undefined : await signCalendarToken(key, confirmationId, Date.now());
  return {
    body: JSON.stringify({
      token: signed?.token ?? null,
      expires_at: signed === undefined ? null : signed.expiresAt.toISOString(),
      expires_in:
        signed === undefined ? null : Math.round((signed.expiresAt.getTime() - Date.now()) / 1000),
    }),
    contentType: 'application/json',
    filename: '',
    disposition: 'none',
    maxAge: 0,
  };
}

async function fileFor(
  db: Db,
  wanted: string,
  disposition: 'attachment' | 'inline',
): Promise<Download> {
  const { data, error } = await db
    .from('meetup_confirmations')
    .select(SELECT)
    .eq('id', wanted)
    .maybeSingle();
  if (error !== null) throw error;
  // RLS answers "may this person see this?", so a stranger and a
  // confirmation that does not exist get the same answer.
  if (data === null) {
    throw new Refusal('confirmation_not_found', 'That meetup is not there.');
  }

  const row = data as unknown as {
    id: string;
    plan_id: string;
    revision: number;
    starts_at: string;
    ends_at: string;
    available_user_ids: string[];
    place_name: string | null;
    place_url: string | null;
    note: string | null;
    confirmed_by: string;
    status: ConfirmationStatus;
    confirmed_at: string;
    /** One calendar entry across a move: same UID, higher sequence (ADR 0051). */
    calendar_uid: string;
    calendar_sequence: number;
    plans: {
      title: string;
      short_code: string;
      time_zone: string;
      circles: { name: string };
    };
  };

  // Through the domain's own constructors rather than a cast: `UserId`,
  // `PlanId` and the rest are branded, and a cast is a claim that a string
  // from a row is one of them. These check.
  const confirmation: Confirmation = {
    id: confirmationId(row.id),
    planId: planId(row.plan_id),
    revision: row.revision,
    candidate: {
      start: toInstant(row.starts_at),
      end: toInstant(row.ends_at),
      availableUserIds: row.available_user_ids.map(userId),
    },
    placeName: row.place_name ?? undefined,
    placeUrl: row.place_url ?? undefined,
    note: row.note ?? undefined,
    confirmedBy: userId(row.confirmed_by),
    status: row.status,
    confirmedAt: toInstant(row.confirmed_at),
    calendarUid: row.calendar_uid,
    calendarSequence: row.calendar_sequence,
  };

  const circleName = row.plans.circles.name;

  return {
    body: icsFor({
      confirmation,
      circleName,
      title: row.plans.title,
      identity: {
        domain: brand.domain,
        prodId: `-//${brand.name}//Meetups 1.0//EN`,
      },
      // Passed, never read from a clock inside: the same confirmation
      // downloaded twice differs only in `DTSTAMP`, and that is the one
      // field that is allowed to.
      stamp: now(),
      url: `${origin()}${DEEP_LINK_ROUTES.plan.replace(':code', row.plans.short_code)}`,
    }),
    contentType: 'text/calendar; charset=utf-8',
    disposition,
    // `<circle>-<date>.ics`, and the date is the one on the invitation —
    // the local date in the plan's zone. Slicing the instant gives the UTC
    // date, which for 6:30 pm in Los Angeles is the *next* day: a file
    // named for a Thursday that says Wednesday inside it.
    filename: icsFilename(
      `${circleName} ${toLocal(confirmation.candidate.start, toZone(row.plans.time_zone)).date}`,
    ),
    // Not cached. A confirmation is exactly the kind of thing that changes
    // — rescheduled, cancelled — and a file served from a five-minute cache
    // would say `STATUS:CONFIRMED` about a time that is off the table
    // (spec §5.7). Re-fetching a two-kilobyte file is cheaper than being
    // wrong about when somebody is meeting.
    maxAge: 0,
  };
}

/**
 * Where the link in the file points.
 *
 * `EXPO_PUBLIC_APP_ORIGIN` is the variable this repository already has for
 * "where the app is" — `.env.example` lists it and the deploy workflows set it
 * — so the function reads that one rather than inventing a second name for the
 * same thing, which is how a dev stack ends up linking into production because
 * nobody set the new one.
 *
 * `brand.domain` is the fallback and is right in production, where the app is
 * served from the link host itself.
 */
function origin(): string {
  return optional('EXPO_PUBLIC_APP_ORIGIN') ?? `https://${brand.domain}`;
}
