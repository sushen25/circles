import { brand } from '@circles/config';
import { DEEP_LINK_ROUTES, GenerateIcsRequest } from '@circles/contracts';
import {
  confirmationId,
  icsFilename,
  icsFor,
  planId,
  userId,
  type Confirmation,
  type ConfirmationStatus,
} from '@circles/domain';

import { downloadHandler } from '../_shared/download.ts';
import { optional } from '../_shared/env.ts';
import { now, toInstant } from '../_shared/moment.ts';
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
 * **No tokens in the file** (architecture §14). An `.ics` is forwarded, synced
 * to other devices and indexed by desktop search, so the only link it carries is
 * the plan's short link — a public path with no secret in it — and `icsFor`
 * throws rather than embedding anything else.
 *
 * A superseded or cancelled confirmation still downloads, with `STATUS:CANCELLED`:
 * "Thursday is off the table" (§5.7) is a thing a calendar needs to be told, and
 * refusing the file would leave the old event sitting in it.
 */
Deno.serve(
  downloadHandler({
    name: 'generate-ics',
    schema: GenerateIcsRequest,
    handle: async ({ query, caller }) => {
      const { data, error } = await caller
        .from('meetup_confirmations')
        .select(
          'id, plan_id, revision, starts_at, ends_at, available_user_ids, place_name, place_url, note, confirmed_by, status, confirmed_at, plans(title, short_code, circles(name))',
        )
        .eq('id', query.confirmation_id)
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
        plans: { title: string; short_code: string; circles: { name: string } };
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
        // `<circle>-<date>.ics`. One slug function, given both halves: a person
        // with three of these in a downloads folder can tell them apart.
        filename: icsFilename(`${circleName} ${row.starts_at.slice(0, 10)}`),
        // Five minutes. A confirmation changes rarely and a stale file is a
        // wrong time in somebody's calendar; `private`, because it is theirs.
        maxAge: 300,
      };
    },
  }),
);

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
