import { randomUUID } from 'node:crypto';

import { sql } from './stack';

/** The seed the cadence and Plan another specs share: a circle that met `daysAgo`, and the prompt the dispatcher would write. */

/**
 * Last time, as it would be after the morning after: a dinner over a week of
 * evenings, ninety minutes, at least two — a quorum Maya chose — twenty-six
 * days ago, reported as happened. `report_outcome` as Maya is what moves
 * `last_met_at` and completes the plan.
 */
export function metTwentySixDaysAgo(circleId: string, mayaId: string, ninaId: string): void {
  sql(`begin; ${metSql(circleId, mayaId, [mayaId, ninaId], 26)} commit;`);
}

/**
 * A dinner `organiserId` organised, `daysAgo`, that `attendees` went to,
 * reported as happened by the organiser — as SQL, to run inside a
 * transaction of the caller's, which it leaves acting as `postgres` again.
 */
export function metSql(
  circleId: string,
  organiserId: string,
  attendees: string[],
  daysAgo: number,
  { minutes = 90, quorum = 2 }: { minutes?: number; quorum?: number } = {},
) {
  const planId = randomUUID();
  const confirmationId = randomUUID();
  const ids = attendees.map((id) => `'${id}'`);
  return `
    insert into public.plans (
      id, circle_id, mode, state, organiser_user_id, title, category, time_zone,
      window_start, window_end, daily_start_local, daily_end_local,
      duration_minutes, quorum, quorum_source, response_deadline, short_code
    ) values (
      '${planId}', '${circleId}', 'named', 'confirmed', '${organiserId}', 'Dinner', 'dinner',
      'Australia/Melbourne', current_date - ${daysAgo + 3}, current_date - ${daysAgo - 3}, 1050, 1350,
      ${minutes}, ${quorum}, 'chosen', now() - interval '${daysAgo + 4} days', 'cdn${randomUUID()
        .replace(/[^a-hjkmnp-z2-9]/g, '')
        .slice(0, 7)}'
    );
    insert into public.plan_participants (plan_id, revision, user_id)
    select '${planId}', 1, unnest(array[${ids.join(', ')}]::uuid[]);
    insert into public.meetup_confirmations
      (id, plan_id, revision, candidate_id, starts_at, ends_at, available_user_ids, confirmed_by)
    values ('${confirmationId}', '${planId}', 1, 'e2e', now() - interval '${daysAgo} days',
      now() - interval '${daysAgo} days' + interval '${minutes} minutes',
      array[${ids.join(', ')}]::uuid[], '${organiserId}');
    insert into public.attendance (confirmation_id, user_id, status)
    select '${confirmationId}', unnest(array[${ids.join(', ')}]::uuid[]), 'going';
    select set_config('role', 'authenticated', true);
    select set_config('request.jwt.claims', '{"sub": "${organiserId}", "role": "authenticated"}', true);
    select public.report_outcome('${confirmationId}', 'happened');
    select set_config('role', 'postgres', true);
    select set_config('request.jwt.claims', '', true);
  `;
}

/**
 * The dispatcher's decision for this cycle, as it would have written it.
 *
 * An upsert, because the dispatcher may get there first: every spec that runs
 * it sweeps the whole stack, and a circle a month on is due. It would choose
 * the same person, but the row is made to say exactly what the test needs.
 */
export function promptedThisCycle(
  circleId: string,
  userId: string,
  role: string,
  due: string,
): string {
  return `insert into private.cadence_prompts (circle_id, last_met_at, due_date, user_id, recipient_role)
    select id, last_met_at, ${due}, '${userId}', '${role}' from public.circles where id = '${circleId}'
    on conflict (circle_id, last_met_at) do update
      set due_date = excluded.due_date, user_id = excluded.user_id,
          recipient_role = excluded.recipient_role;`;
}
