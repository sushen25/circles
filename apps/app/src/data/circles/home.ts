import { ANSWERABLE_STATES, type Cadence, type PlanState } from '@circles/domain';

import { authClient } from '../auth/client';

/**
 * A circle's home, read through RLS as the member (spec §5.2).
 *
 * `circles`, `circle_members`, `plans`, `plan_participants` and
 * `candidate_sets` are each readable by an active member of the circle and by
 * nobody else, so this calls no function. What it cannot read is anybody
 * else's answer — `plan_responses` is its owner's alone — so "5 of 6 replied"
 * comes from the engine's own count on the newest candidate set for the
 * current revision (`responded_count`), which is recomputed on every answer.
 * No set yet means nobody has answered.
 *
 * Throws without the id in the message.
 */
export type HomeMember = {
  userId: string;
  name: string;
  /** ISO. The newest are the "just joined". */
  joinedAt: string;
  role: 'owner' | 'member';
};

export type HomePlan = {
  id: string;
  code: string;
  title: string;
  /** ISO, shown in the circle's zone. */
  responseDeadline: string;
  replied: number;
  asked: number;
};

export type CircleHome = {
  id: string;
  name: string;
  cadence: Cadence;
  zone: string;
  lastMetAt: string | null;
  cadenceSnoozedUntil: string | null;
  defaultDurationMinutes: number;
  defaultQuorum: number | null;
  /** The person reading it. */
  isOwner: boolean;
  me: string | undefined;
  /** Active members, oldest first. */
  members: HomeMember[];
  /**
   * The named plan that is finding a time, if there is one: the newest in an
   * answerable state. A plan past its deadline is still finding a time until
   * the organiser decides (spec §8); the deadline is the server's to judge.
   */
  activePlan: HomePlan | null;
};

const FAILED = 'circle home lookup failed';

export async function circleHome(id: string): Promise<CircleHome | null> {
  const client = authClient();

  const { data: circle, error } = await client
    .from('circles')
    .select(
      'id, name, cadence, time_zone, last_met_at, cadence_snoozed_until, default_duration_minutes, default_quorum, owner_user_id',
    )
    .eq('id', id)
    .maybeSingle();
  if (error !== null) {
    // Not a UUID: to a person, the same as a circle they are not in.
    if (error.code === '22P02') return null;
    throw new Error(FAILED);
  }
  if (circle === null) return null;

  const { data: session } = await client.auth.getSession();
  const me = session.session?.user.id;

  const [members, plans] = await Promise.all([
    client
      .from('circle_members')
      .select('user_id, display_name_snapshot, joined_at, role')
      .eq('circle_id', id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true }),
    client
      .from('plans')
      .select('id, short_code, title, state, revision, response_deadline')
      .eq('circle_id', id)
      .eq('mode', 'named')
      .in('state', [...ANSWERABLE_STATES])
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  if (members.error !== null || plans.error !== null) throw new Error(FAILED);

  const plan = plans.data[0];
  let activePlan: HomePlan | null = null;
  if (plan !== undefined && ANSWERABLE_STATES.includes(plan.state as PlanState)) {
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
    activePlan = {
      id: plan.id,
      code: plan.short_code,
      title: plan.title,
      responseDeadline: plan.response_deadline,
      replied: latest.data[0]?.responded_count ?? 0,
      asked: asked.count ?? 0,
    };
  }

  return {
    id: circle.id,
    name: circle.name,
    cadence: circle.cadence as Cadence,
    zone: circle.time_zone,
    lastMetAt: circle.last_met_at,
    cadenceSnoozedUntil: circle.cadence_snoozed_until,
    defaultDurationMinutes: circle.default_duration_minutes,
    defaultQuorum: circle.default_quorum,
    isOwner: me !== undefined && circle.owner_user_id === me,
    me,
    members: members.data.map((m) => ({
      userId: m.user_id,
      name: m.display_name_snapshot,
      joinedAt: m.joined_at,
      role: m.role === 'owner' ? 'owner' : 'member',
    })),
    activePlan,
  };
}

/**
 * Whether this account belongs to any circle — the Welcome screen's question
 * for somebody who has just signed in (spec §5.1: returning users go to their
 * circles, new ones make their first). Their own rows are readable through
 * `circle_members_select_member`, because being in a circle is what the policy
 * checks.
 */
export async function belongsToAnyCircle(): Promise<boolean> {
  const client = authClient();
  const { data: session } = await client.auth.getSession();
  const me = session.session?.user.id;
  if (me === undefined) return false;

  const { count, error } = await client
    .from('circle_members')
    .select('circle_id', { count: 'exact', head: true })
    .eq('user_id', me)
    .eq('status', 'active');
  if (error !== null) throw new Error('membership lookup failed');
  return (count ?? 0) > 0;
}
