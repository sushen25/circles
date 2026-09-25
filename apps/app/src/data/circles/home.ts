import type { Cadence, NudgePolicy } from '@circles/domain';

import { authClient } from '../auth/client';
import { morningAfterOf, type MorningAfter } from '../confirmation';
import {
  FAILED,
  findingPlanOf,
  goingCounts,
  plansFor,
  repliesFor,
  upcomingMeetups,
  whoAmI,
} from './rows';

/**
 * A circle's home, read through RLS as the member (spec §5.2): the circle, who
 * is in it, the plan finding a time, the meetup locked in, and the reader's own
 * switches. Everything circle settings shows comes from the same read, so the
 * two screens cannot disagree about a circle.
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
  /**
   * Who may edit it; with the owner, who may cancel it (spec §4.5). Null on a
   * quiet ask nobody has taken on. Read so that a screen offering those two
   * things offers them to the people who can do them.
   */
  organiserUserId: string | null;
  /** ISO, shown in the circle's zone. */
  responseDeadline: string;
  replied: number;
  asked: number;
};

/** The next confirmed meetup still ahead: "Locked in · Thu 17 Sep". */
export type HomeMeetup = {
  planId: string;
  code: string;
  startsAt: string;
  endsAt: string;
  placeName: string | null;
  going: number;
  toConfirm: number;
};

/** The reader's own switches for this circle (notification settings). */
export type MySwitches = {
  mutedAll: boolean;
  mutedQuietAsks: boolean;
  mutedNudges: boolean;
};

export type CircleHome = {
  id: string;
  name: string;
  /** A circle palette token (`clay`), never a hex. */
  color: string;
  status: 'active' | 'archived';
  cadence: Cadence;
  /** Null until somebody chooses: the domain works the default out (`effectiveNudgePolicy`). */
  nudgePolicy: NudgePolicy | null;
  defaultArea: string | null;
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
  activePlan: HomePlan | null;
  lockedIn: HomeMeetup | null;
  /**
   * The morning-after question the reader owes, if any (S1-29): the
   * organiser's "did it happen?" until they answer, a member's "were you
   * there?" until they answer or say "Not now".
   */
  morningAfter: MorningAfter | null;
  mine: MySwitches | null;
  /**
   * Whether the cadence nudge for this due date asked the reader (S2-04):
   * circle home's "it's your turn". The dispatcher's choice, read back through
   * `my_turn_to_plan` — yes or no, never who else was asked.
   */
  myTurn: boolean;
};

export async function circleHome(id: string): Promise<CircleHome | null> {
  const client = authClient();

  const { data: circle, error } = await client
    .from('circles')
    .select(
      'id, name, color, status, cadence, nudge_policy, default_area, time_zone, last_met_at, cadence_snoozed_until, default_duration_minutes, default_quorum, owner_user_id',
    )
    .eq('id', id)
    .maybeSingle();
  if (error !== null) {
    // Not a UUID: to a person, the same as a circle they are not in.
    if (error.code === '22P02') return null;
    throw new Error(FAILED);
  }
  if (circle === null) return null;

  const me = await whoAmI(client);

  const [members, plans, morningAfter, myTurn] = await Promise.all([
    client
      .from('circle_members')
      .select(
        'user_id, display_name_snapshot, joined_at, role, muted_all, muted_quiet_asks, muted_nudges',
      )
      .eq('circle_id', id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true }),
    plansFor(client, [id]),
    // A prompt, not the home: if it cannot be read the home still shows, and
    // the next read asks again.
    morningAfterOf(id).catch(() => null),
    // A line on the card, not the home: unread, the card says the quieter
    // sentence everybody else sees.
    myTurnToPlan(client, id),
  ]);
  if (members.error !== null) throw new Error(FAILED);

  const finding = findingPlanOf(plans, id);
  const confirmed = plans.filter((p) => p.state === 'confirmed');
  const [replies, meetups] = await Promise.all([
    finding === undefined ? undefined : repliesFor(client, finding),
    upcomingMeetups(
      client,
      confirmed.map((p) => p.id),
    ),
  ]);

  const next = meetups[0];
  let lockedIn: HomeMeetup | null = null;
  if (next !== undefined) {
    const counts = await goingCounts(client, next.confirmationId);
    lockedIn = {
      planId: next.planId,
      code: confirmed.find((p) => p.id === next.planId)?.short_code ?? '',
      startsAt: next.startsAt,
      endsAt: next.endsAt,
      placeName: next.placeName,
      ...counts,
    };
  }

  const own = members.data.find((m) => m.user_id === me);

  return {
    id: circle.id,
    name: circle.name,
    color: circle.color,
    status: circle.status === 'archived' ? 'archived' : 'active',
    cadence: circle.cadence as Cadence,
    nudgePolicy: (circle.nudge_policy as NudgePolicy | null) ?? null,
    defaultArea: circle.default_area,
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
    activePlan:
      finding === undefined || replies === undefined
        ? null
        : {
            id: finding.id,
            code: finding.short_code,
            title: finding.title,
            organiserUserId: finding.organiser_user_id,
            responseDeadline: finding.response_deadline,
            ...replies,
          },
    lockedIn,
    morningAfter,
    myTurn,
    mine:
      own === undefined
        ? null
        : {
            mutedAll: own.muted_all,
            mutedQuietAsks: own.muted_quiet_asks,
            mutedNudges: own.muted_nudges,
          },
  };
}

async function myTurnToPlan(client: ReturnType<typeof authClient>, id: string): Promise<boolean> {
  const { data, error } = await client.rpc('my_turn_to_plan', { p_circle_id: id });
  return error === null && data === true;
}

/**
 * Whether this account belongs to any circle — the Welcome screen's question
 * for somebody who has just signed in (spec §5.1: returning users go to their
 * circles, new ones make their first). Their own rows are readable through
 * `circle_members_select_member`, because being in a circle is what the policy
 * checks.
 */
export async function belongsToAnyCircle(): Promise<boolean> {
  return (await newestCircleId()) !== undefined;
}

/** The circle this account joined most recently, or undefined when it is in none. */
export async function newestCircleId(): Promise<string | undefined> {
  const client = authClient();
  const me = await whoAmI(client);
  if (me === undefined) return undefined;

  const { data, error } = await client
    .from('circle_members')
    .select('circle_id')
    .eq('user_id', me)
    .eq('status', 'active')
    .order('joined_at', { ascending: false })
    .limit(1);
  if (error !== null) throw new Error('membership lookup failed');
  return data[0]?.circle_id;
}
