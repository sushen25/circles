import { ANSWERABLE_STATES } from '@circles/domain';

import type { authClient } from '../auth/client';

/**
 * The reads circle home and the circles list share, through RLS as the member.
 *
 * `plans`, `plan_participants`, `candidate_sets`, `meetup_confirmations` and
 * the forward-looking half of `attendance` are each readable by an active
 * member of the circle and by nobody else, so none of this calls a function.
 * What it cannot read is anybody else's answer — `plan_responses` is its
 * owner's alone — so "5 of 6 replied" is the engine's own count on the newest
 * candidate set for the current revision (`responded_count`). No set yet means
 * nobody has answered.
 *
 * Every failure throws one fixed message with no id in it: an exception
 * message is a thing that ends up in a log (non-negotiable 8).
 */
export const FAILED = 'circle lookup failed';

type Client = ReturnType<typeof authClient>;

export type PlanRow = {
  id: string;
  circle_id: string;
  short_code: string;
  title: string;
  state: string;
  revision: number;
  response_deadline: string;
};

/**
 * Plans still asking, and confirmed ones, newest first, for these circles.
 *
 * Every mode: a quiet ask that reached its threshold is asking for times like
 * any other plan, and stays `quiet` (spec §5.4). The states are what keep a
 * quiet ask still gathering interest (`seeking`) out — it is nobody's "finding
 * a time" until it opens, and who started it is never shown.
 */
export async function plansFor(client: Client, circleIds: readonly string[]): Promise<PlanRow[]> {
  if (circleIds.length === 0) return [];
  const { data, error } = await client
    .from('plans')
    .select('id, circle_id, short_code, title, state, revision, response_deadline')
    .in('circle_id', [...circleIds])
    .in('state', [...ANSWERABLE_STATES, 'confirmed'])
    .order('created_at', { ascending: false });
  if (error !== null) throw new Error(FAILED);
  return data;
}

/**
 * The plan finding a time in a circle: the one in an answerable state. A
 * plan past its deadline is still finding a time until the organiser decides
 * (spec §8); the deadline is the server's to judge.
 *
 * One, because a circle has at most one plan `collecting` or `ready` (spec
 * §5.3, ADR 00XX): `create_plan` refuses a second while it runs, and plan
 * setup shows this plan with Edit and Cancel instead of a form. "Newest first"
 * is the read's order and no longer a choice between two — before the rule, a
 * second plan dropped the first out of view here while it kept running.
 */
export function findingPlanOf(plans: readonly PlanRow[], circleId: string): PlanRow | undefined {
  return plans.find(
    (p) => p.circle_id === circleId && (ANSWERABLE_STATES as readonly string[]).includes(p.state),
  );
}

/** "5 of 6 replied": the engine's count, and who the revision asked. */
export async function repliesFor(
  client: Client,
  plan: Pick<PlanRow, 'id' | 'revision'>,
): Promise<{ replied: number; asked: number }> {
  const [asked, latest] = await Promise.all([
    client
      .from('plan_participants')
      .select('user_id', { count: 'exact', head: true })
      .eq('plan_id', plan.id)
      .eq('revision', plan.revision),
    client
      .from('candidate_sets')
      .select('responded_count')
      .eq('plan_id', plan.id)
      .eq('revision', plan.revision)
      .order('generated_at', { ascending: false })
      .limit(1),
  ]);
  if (asked.error !== null || latest.error !== null) throw new Error(FAILED);
  return { replied: latest.data[0]?.responded_count ?? 0, asked: asked.count ?? 0 };
}

export type MeetupRow = {
  confirmationId: string;
  planId: string;
  startsAt: string;
  endsAt: string;
  placeName: string | null;
};

/**
 * The live confirmation of each of these plans whose meetup has not ended —
 * "locked in" is about an evening still to come. One per plan at most (a
 * revision has one active confirmation, §8.2).
 */
export async function upcomingMeetups(
  client: Client,
  planIds: readonly string[],
  now = new Date(),
): Promise<MeetupRow[]> {
  if (planIds.length === 0) return [];
  const { data, error } = await client
    .from('meetup_confirmations')
    .select('id, plan_id, starts_at, ends_at, place_name')
    .in('plan_id', [...planIds])
    .eq('status', 'active')
    .gt('ends_at', now.toISOString())
    .order('starts_at', { ascending: true });
  if (error !== null) throw new Error(FAILED);
  return data.map((row) => ({
    confirmationId: row.id,
    planId: row.plan_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    placeName: row.place_name,
  }));
}

/** "5 going · 1 to confirm" — the forward-looking answers, which the circle may see. */
export async function goingCounts(
  client: Client,
  confirmationId: string,
): Promise<{ going: number; toConfirm: number }> {
  const { data, error } = await client
    .from('attendance')
    .select('status')
    .eq('confirmation_id', confirmationId)
    .in('status', ['going', 'unknown']);
  if (error !== null) throw new Error(FAILED);
  return {
    going: data.filter((row) => row.status === 'going').length,
    toConfirm: data.filter((row) => row.status === 'unknown').length,
  };
}

export async function whoAmI(client: Client): Promise<string | undefined> {
  const { data } = await client.auth.getSession();
  return data.session?.user.id;
}
