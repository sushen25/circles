import type { Cadence } from '@circles/domain';

import { authClient } from '../auth/client';
import { FAILED, findingPlanOf, plansFor, repliesFor, upcomingMeetups, whoAmI } from './rows';

/**
 * Every circle the reader is in, for the circles list (spec §5.2): enough of
 * each to choose its state line — "Finding a time · 5 of 6 replied", "Locked
 * in · Thu 24 Sep", "Last caught up 2 Aug · No rush".
 *
 * RLS answers "which circles": `circles_select_member` returns the ones the
 * reader is an active member of, and nothing else. Archived circles come back
 * too, last, so an owner can find one to bring back.
 */
export type CircleSummary = {
  id: string;
  name: string;
  color: string;
  status: 'active' | 'archived';
  cadence: Cadence;
  zone: string;
  lastMetAt: string | null;
  cadenceSnoozedUntil: string | null;
  defaultDurationMinutes: number;
  memberCount: number;
  isOwner: boolean;
  activePlan: { replied: number; asked: number } | null;
  lockedIn: { startsAt: string } | null;
};

export async function circlesList(): Promise<CircleSummary[]> {
  const client = authClient();
  const me = await whoAmI(client);
  if (me === undefined) return [];

  const { data: circles, error } = await client
    .from('circles')
    .select(
      'id, name, color, status, cadence, time_zone, last_met_at, cadence_snoozed_until, default_duration_minutes, owner_user_id, created_at',
    )
    .order('created_at', { ascending: false });
  if (error !== null) throw new Error(FAILED);
  if (circles.length === 0) return [];

  const ids = circles.map((c) => c.id);
  const [members, plans] = await Promise.all([
    client.from('circle_members').select('circle_id').in('circle_id', ids).eq('status', 'active'),
    plansFor(client, ids),
  ]);
  if (members.error !== null) throw new Error(FAILED);

  const meetups = await upcomingMeetups(
    client,
    plans.filter((p) => p.state === 'confirmed').map((p) => p.id),
  );

  const summaries = await Promise.all(
    circles.map(async (circle): Promise<CircleSummary> => {
      const finding = findingPlanOf(plans, circle.id);
      const planIds = new Set(plans.filter((p) => p.circle_id === circle.id).map((p) => p.id));
      const meetup = meetups.find((m) => planIds.has(m.planId));
      return {
        id: circle.id,
        name: circle.name,
        color: circle.color,
        status: circle.status === 'archived' ? 'archived' : 'active',
        cadence: circle.cadence as Cadence,
        zone: circle.time_zone,
        lastMetAt: circle.last_met_at,
        cadenceSnoozedUntil: circle.cadence_snoozed_until,
        defaultDurationMinutes: circle.default_duration_minutes,
        memberCount: members.data.filter((m) => m.circle_id === circle.id).length,
        isOwner: circle.owner_user_id === me,
        activePlan: finding === undefined ? null : await repliesFor(client, finding),
        lockedIn: meetup === undefined ? null : { startsAt: meetup.startsAt },
      };
    }),
  );

  // Archived last; otherwise newest first, as the circles were read.
  return [
    ...summaries.filter((s) => s.status === 'active'),
    ...summaries.filter((s) => s.status === 'archived'),
  ];
}
