import {
  DURATIONS,
  localDate,
  type DurationMinutes,
  type LastPlan,
  type PlanCategory,
} from '@circles/domain';

import { authClient } from '../auth/client';

/**
 * The last meetup this circle had that actually happened, as the plan it came
 * from — what **Plan another** fills itself in from (spec §5.9).
 *
 * "Happened" is the organiser's `happened` on the morning after, the only
 * outcome that moves `last_met_at` (spec §5.10); a plan that was cancelled or
 * never reported is not "last time". Read through RLS as a member — plans,
 * confirmations and outcome reports each have a member-select policy — and
 * chosen here by the meetup's own start, newest first, because a plan's
 * outcome can be reported late.
 *
 * Null for a circle whose meetups have never happened: Plan another is then
 * the ordinary setup. Throws without the circle id in the message.
 */
export type LastHappenedPlan = LastPlan & {
  /** ISO: when that meetup began — "Filled in from September's catch-up". */
  startsAt: string;
};

type Row = {
  category: string;
  duration_minutes: number;
  quorum: number;
  quorum_source: string;
  window_start: string;
  window_end: string;
  daily_start_local: number;
  daily_end_local: number;
  meetup_confirmations: { starts_at: string; outcome_reports: { outcome: string }[] }[];
};

export async function lastHappenedPlan(circleId: string): Promise<LastHappenedPlan | null> {
  const { data, error } = await authClient()
    .from('plans')
    .select(
      'category, duration_minutes, quorum, quorum_source, window_start, window_end, daily_start_local, daily_end_local, meetup_confirmations(starts_at, outcome_reports(outcome))',
    )
    .eq('circle_id', circleId)
    .eq('state', 'completed');
  if (error !== null) throw new Error('last plan lookup failed');

  let best: { row: Row; startsAt: string } | undefined;
  for (const row of data as unknown as Row[]) {
    for (const confirmation of row.meetup_confirmations) {
      if (!confirmation.outcome_reports.some((o) => o.outcome === 'happened')) continue;
      if (best === undefined || confirmation.starts_at > best.startsAt) {
        best = { row, startsAt: confirmation.starts_at };
      }
    }
  }
  if (best === undefined) return null;

  const { row } = best;
  return {
    category: row.category as PlanCategory,
    durationMinutes: (DURATIONS as readonly number[]).includes(row.duration_minutes)
      ? (row.duration_minutes as DurationMinutes)
      : 120,
    quorum: row.quorum,
    quorumChosen: row.quorum_source === 'chosen',
    window: { start: localDate(row.window_start), end: localDate(row.window_end) },
    daily: { startMin: row.daily_start_local, endMin: row.daily_end_local },
    startsAt: best.startsAt,
  };
}
