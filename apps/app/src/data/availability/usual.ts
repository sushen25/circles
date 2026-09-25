import {
  fromISO,
  usualDayparts,
  zone,
  type DayPart,
  type PriorAnswer,
  type ResponseStatus,
} from '@circles/domain';

import { authClient } from '../auth/client';

/**
 * What this person usually offers in this circle, for "Use my usual times"
 * (ADR 0005, S2-06), or `undefined` when there is no usual yet.
 *
 * **Read, not written** (ADR 00XX). Two sources, both through RLS as the
 * member and both readable by nobody else: `member_dayparts`, the counts of
 * the windows retention has already deleted, and this person's own answers to
 * the circle's other plans, which are the windows it has not. The domain adds
 * them (`usualDayparts`). Nothing is stored when somebody answers, so there
 * is no summary to fall out of date and no function to write one.
 *
 * Only the person's own rows are ever read: `plan_responses_select_own`,
 * `willing_windows_select_own` and `member_dayparts_select_own` allow nothing
 * else. Nobody who has not answered is scored by this — it is a start for the
 * reader's own next answer.
 *
 * Every earlier plan in the circle is asked about, not the most recent few: a
 * cap on the circle's plans would drop the member's answers behind a run of
 * plans they did not answer (review round 1). A circle makes a few dozen plans
 * a year, and only this member's answers to them come back.
 */

type ResponseRow = {
  plan_id: string;
  revision: number;
  status: string;
  willing_windows: { starts_at: string; ends_at: string }[] | null;
};

export async function usualTimes(input: {
  circleId: string;
  /** The plan being answered, which is not "earlier". */
  planId: string;
  userId: string;
}): Promise<readonly DayPart[] | undefined> {
  const client = authClient();

  const [plans, stored] = await Promise.all([
    client
      .from('plans')
      .select('id, time_zone')
      .eq('circle_id', input.circleId)
      .neq('id', input.planId),
    client
      .from('member_dayparts')
      .select('summary')
      .eq('circle_id', input.circleId)
      .eq('user_id', input.userId)
      .maybeSingle(),
  ]);
  if (plans.error !== null || stored.error !== null) throw new Error('usual times failed');

  const zones = new Map(plans.data.map((p) => [p.id, p.time_zone]));
  let rows: ResponseRow[] = [];
  if (zones.size > 0) {
    const responses = await client
      .from('plan_responses')
      .select('plan_id, revision, status, willing_windows (starts_at, ends_at)')
      .eq('user_id', input.userId)
      .in('plan_id', [...zones.keys()]);
    if (responses.error !== null) throw new Error('usual times failed');
    rows = responses.data as ResponseRow[];
  }

  // One answer per plan: the one to its latest revision. An edit asks again,
  // and the answer to the question as it was is not a second habit.
  const latest = new Map<string, ResponseRow>();
  for (const row of rows) {
    const seen = latest.get(row.plan_id);
    if (seen === undefined || row.revision > seen.revision) latest.set(row.plan_id, row);
  }

  const answers: PriorAnswer[] = [...latest.values()].map((row) => ({
    status: row.status as ResponseStatus,
    windows: (row.willing_windows ?? []).map((w) => ({
      start: fromISO(w.starts_at),
      end: fromISO(w.ends_at),
    })),
    zone: zone(zones.get(row.plan_id)!),
  }));

  const summary = stored.data?.summary as { counts?: Partial<Record<DayPart, number>> } | null;
  return usualDayparts({ stored: summary?.counts ?? undefined, answers });
}
