import {
  DURATIONS,
  type DurationMinutes,
  type PlanCategory,
  type PlanState,
} from '@circles/domain';

import { authClient } from '../auth/client';
import type { RosterMember } from '../scheduling';

/**
 * A plan as the organiser's lifecycle screens read it (spec §5.3, §5.7):
 * everything EditPlan prefills, what ChangeTime and CancelPlan need to say
 * which day is off, and what the cancelled and rescheduled screens tell a
 * member. One read, through RLS as a member of the circle — every table here
 * has a member-select policy — so it calls no function.
 *
 * **Who is asked is the current revision's participants**, not the circle's
 * roster: `revise-plan` refuses to require somebody who was never asked
 * (`not_a_participant`), so the required-members sheet can only offer the
 * people this revision is addressed to.
 *
 * Throws without the plan's id or code in the message: a plan's code is enough
 * to join it while it is asking (ADR 0022), so it stays out of logs.
 */

const FAILED = 'plan lookup failed';

export type ConfirmationSummary = {
  startsAt: string;
  endsAt: string;
  /** `active`, `superseded` (a reopen), `cancelled`, `completed`. */
  status: string;
  revision: number;
};

export type PlanDetails = {
  planId: string;
  code: string;
  circleId: string;
  circleName: string;
  zone: string;
  state: PlanState;
  title: string;
  category: PlanCategory;
  revision: number;
  /** Inclusive local dates. */
  windowStart: string;
  windowEnd: string;
  band: { startMin: number; endMin: number };
  durationMinutes: DurationMinutes;
  quorum: number;
  /** `quorum_source = 'chosen'`: the number is the organiser's and does not follow the circle. */
  quorumChosen: boolean;
  responseDeadline: string;
  /** Judged on the database's clock, never this device's. */
  deadlinePassed: boolean;
  /** The organiser's own words from CancelPlan. Content: never logged. */
  cancelNote: string | undefined;
  organiserUserId: string | null;
  me: string | undefined;
  isOrganiser: boolean;
  /** Cancelling is the organiser's or the circle owner's (spec §4.5). */
  isOwner: boolean;
  /** Everybody the circle has had, oldest first; `active` says who is in. */
  roster: RosterMember[];
  /** Who this revision asks: active participants, in the order they joined it. */
  participants: string[];
  /** Who has to be there, this revision. */
  required: string[];
  /**
   * The newest confirmation the plan has had, of any revision. After "Change
   * the time" it is the superseded one — the Thursday that is off the table.
   */
  lastConfirmation: ConfirmationSummary | null;
};

export async function planDetails(
  key: { planId: string } | { code: string },
): Promise<PlanDetails | null> {
  const client = authClient();

  const columns =
    'id, short_code, circle_id, state, title, category, revision, time_zone, window_start, window_end, daily_start_local, daily_end_local, duration_minutes, quorum, quorum_source, response_deadline, cancel_note, organiser_user_id';
  const query = client.from('plans').select(columns);
  const { data: plan, error } = await (
    'planId' in key ? query.eq('id', key.planId) : query.eq('short_code', key.code)
  ).maybeSingle();
  if (error !== null) {
    // Not a UUID: to a person, the same as a plan they are not in.
    if (error.code === '22P02') return null;
    throw new Error(FAILED);
  }
  if (plan === null) return null;

  const { data: session } = await client.auth.getSession();
  const me = session.session?.user.id;

  const [circle, roster, participants, required, confirmations, open] = await Promise.all([
    client.from('circles').select('name, owner_user_id').eq('id', plan.circle_id).maybeSingle(),
    client
      .from('circle_members')
      .select('user_id, display_name_snapshot, status, joined_at')
      .eq('circle_id', plan.circle_id)
      .order('joined_at', { ascending: true }),
    client
      .from('plan_participants')
      .select('user_id, joined_at')
      .eq('plan_id', plan.id)
      .eq('revision', plan.revision)
      .order('joined_at', { ascending: true })
      .order('user_id', { ascending: true }),
    client
      .from('plan_required_members')
      .select('user_id')
      .eq('plan_id', plan.id)
      .eq('revision', plan.revision),
    client
      .from('meetup_confirmations')
      .select('starts_at, ends_at, status, revision')
      .eq('plan_id', plan.id)
      .order('confirmed_at', { ascending: false })
      .limit(1),
    // `'now'` is Postgres's own input for the current time, so the deadline is
    // compared on the database's clock rather than this phone's.
    client
      .from('plans')
      .select('id')
      .eq('id', plan.id)
      .gt('response_deadline', 'now')
      .maybeSingle(),
  ]);
  if (
    circle.error !== null ||
    roster.error !== null ||
    participants.error !== null ||
    required.error !== null ||
    confirmations.error !== null ||
    open.error !== null
  ) {
    throw new Error(FAILED);
  }

  const active = new Set(roster.data.filter((m) => m.status === 'active').map((m) => m.user_id));
  const last = confirmations.data[0];

  return {
    planId: plan.id,
    code: plan.short_code,
    circleId: plan.circle_id,
    circleName: circle.data?.name ?? '',
    zone: plan.time_zone,
    state: plan.state as PlanState,
    title: plan.title,
    category: plan.category as PlanCategory,
    revision: plan.revision,
    windowStart: plan.window_start,
    windowEnd: plan.window_end,
    band: { startMin: plan.daily_start_local, endMin: plan.daily_end_local },
    durationMinutes: (DURATIONS as readonly number[]).includes(plan.duration_minutes)
      ? (plan.duration_minutes as DurationMinutes)
      : 120,
    quorum: plan.quorum,
    quorumChosen: plan.quorum_source === 'chosen',
    responseDeadline: plan.response_deadline,
    deadlinePassed: open.data === null,
    cancelNote: plan.cancel_note ?? undefined,
    organiserUserId: plan.organiser_user_id,
    me,
    isOrganiser: me !== undefined && plan.organiser_user_id === me,
    isOwner: me !== undefined && circle.data?.owner_user_id === me,
    roster: roster.data.map((m) => ({
      userId: m.user_id,
      name: m.display_name_snapshot,
      active: m.status === 'active',
    })),
    participants: participants.data.map((p) => p.user_id).filter((id) => active.has(id)),
    required: required.data.map((r) => r.user_id),
    lastConfirmation:
      last === undefined
        ? null
        : {
            startsAt: last.starts_at,
            endsAt: last.ends_at,
            status: last.status,
            revision: last.revision,
          },
  };
}
