import {
  ANSWERABLE_STATES,
  type AttendanceStatus,
  type ConfirmationStatus,
  type PlanState,
} from '@circles/domain';

import { authClient } from '../auth/client';
import { isLockedIn, type RosterMember } from '../scheduling';

/**
 * What the confirmed screens read (spec §5.7): the plan, the confirmation it was
 * locked in with, and who is coming.
 *
 * Every row here is readable through RLS by an active member of the circle and
 * by nobody else, so this calls no function: `meetup_confirmations` has a
 * member-select policy, and `attendance_select_member` shows the circle
 * "Going / Can't make it / To confirm" for everybody — and "I was there" only
 * to its subject (migration 0005), which this screen never asks about.
 *
 * Throws without the plan's id or short code in the message: a plan's code is
 * enough to join it while it is asking (ADR 0022), so it stays out of logs.
 */

const FAILED = 'confirmation lookup failed';

/**
 * Which of the confirmed screens' situations the plan is in.
 *
 * - `confirmed` — locked in, and the meetup is still ahead.
 * - `open` — asking or deciding. Never confirmed, or reopened by "Change the
 *   time", which supersedes the confirmation and asks again (§5.7); either
 *   way the options are the screen to be on.
 * - `past` — locked in, and its time is over, or its outcome is in. Not
 *   "happened": whether it did is the organiser's to report (§5.10).
 *   "Who is going" stops being a question the circle can read: a member's
 *   "I was there" is visible to them alone (`attendance_select_member`), so
 *   counts taken from here would shrink as people answered and differ from
 *   one reader to the next. The morning after is S1-29's.
 * - `over` — cancelled or expired. Nothing is happening at the old time.
 */
export type ConfirmationView = 'confirmed' | 'past' | 'open' | 'over';

export type ConfirmationRead = {
  id: string;
  startsAt: string;
  endsAt: string;
  placeName: string | undefined;
  /** `http(s)` only — the database's check and the domain's `isLink`. */
  placeUrl: string | undefined;
  note: string | undefined;
  status: ConfirmationStatus;
  /** Who could make it when it was locked in. Frozen; never a non-responder. */
  going: string[];
  revision: number;
  confirmedBy: string;
  confirmedAt: string;
};

export type AttendanceRead = {
  userId: string;
  status: AttendanceStatus;
};

export type PlanConfirmation = {
  planId: string;
  code: string;
  circleId: string;
  circleName: string;
  zone: string;
  state: PlanState;
  organiserUserId: string | null;
  me: string | undefined;
  isOrganiser: boolean;
  /** Everybody the circle has had, oldest first — names for ids. */
  roster: RosterMember[];
  confirmation: ConfirmationRead | null;
  /**
   * One row per person who was asked, in roster order. A member who joined
   * after the time was locked in has none: they were never asked, and
   * `enforce_attendance_transition` would refuse them one.
   */
  attendance: AttendanceRead[];
  view: ConfirmationView;
};

const LIVE: readonly ConfirmationStatus[] = ['active', 'completed'];

/**
 * `ahead` is whether the meetup has still to end, **by the database's clock**:
 * a phone set a day fast would otherwise hide the place and the calendar file
 * from somebody the evening before.
 */
export function confirmationViewOf(
  state: PlanState,
  confirmation: ConfirmationRead | null,
  ahead: boolean,
): ConfirmationView {
  if (isLockedIn(state) && confirmation !== null) {
    return state === 'completed' || !ahead ? 'past' : 'confirmed';
  }
  if (ANSWERABLE_STATES.includes(state)) return 'open';
  return 'over';
}

export async function planConfirmation(
  key: { planId: string } | { code: string },
): Promise<PlanConfirmation | null> {
  const client = authClient();

  const columns = 'id, short_code, circle_id, state, revision, time_zone, organiser_user_id';
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

  const [circle, roster, confirmations] = await Promise.all([
    client.from('circles').select('name').eq('id', plan.circle_id).maybeSingle(),
    client
      .from('circle_members')
      .select('user_id, display_name_snapshot, status, joined_at')
      .eq('circle_id', plan.circle_id)
      .order('joined_at', { ascending: true }),
    // The current revision's, newest first. A reopened plan has moved to a
    // new revision, so a superseded Thursday is never read as this plan's time.
    client
      .from('meetup_confirmations')
      .select(
        'id, revision, starts_at, ends_at, place_name, place_url, note, status, available_user_ids, confirmed_by, confirmed_at',
      )
      .eq('plan_id', plan.id)
      .eq('revision', plan.revision)
      .order('confirmed_at', { ascending: false })
      .limit(1),
  ]);
  if (circle.error !== null || roster.error !== null || confirmations.error !== null) {
    throw new Error(FAILED);
  }

  const row = confirmations.data[0];
  const confirmation: ConfirmationRead | null =
    row === undefined || !LIVE.includes(row.status as ConfirmationStatus)
      ? null
      : {
          id: row.id,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          placeName: row.place_name ?? undefined,
          placeUrl: row.place_url ?? undefined,
          note: row.note ?? undefined,
          status: row.status as ConfirmationStatus,
          going: row.available_user_ids,
          revision: row.revision,
          confirmedBy: row.confirmed_by,
          confirmedAt: row.confirmed_at,
        };

  let attendance: AttendanceRead[] = [];
  let ahead = false;
  if (confirmation !== null) {
    // `'now'` is Postgres's own input for the current time, so "has it ended?"
    // is answered on the database's clock rather than this phone's.
    const { data: upcoming, error: upcomingError } = await client
      .from('meetup_confirmations')
      .select('id')
      .eq('id', confirmation.id)
      .gt('ends_at', 'now')
      .maybeSingle();
    if (upcomingError !== null) throw new Error(FAILED);
    ahead = upcoming !== null;

    const { data: rows, error: rowsError } = await client
      .from('attendance')
      .select('user_id, status')
      .eq('confirmation_id', confirmation.id);
    if (rowsError !== null) throw new Error(FAILED);
    // Active members only: somebody who has left keeps their row until the
    // confirmation is superseded, and "5 going" would count a person the
    // circle no longer holds.
    const active = roster.data.filter((m) => m.status === 'active');
    const order = new Map(active.map((m, index) => [m.user_id, index]));
    attendance = rows
      .filter((r) => order.has(r.user_id))
      .map((r) => ({ userId: r.user_id, status: r.status as AttendanceStatus }))
      .sort((a, b) => (order.get(a.userId) ?? 0) - (order.get(b.userId) ?? 0));
  }

  const state = plan.state as PlanState;
  return {
    planId: plan.id,
    code: plan.short_code,
    circleId: plan.circle_id,
    circleName: circle.data?.name ?? '',
    zone: plan.time_zone,
    state,
    organiserUserId: plan.organiser_user_id,
    me,
    isOrganiser: me !== undefined && plan.organiser_user_id === me,
    roster: roster.data.map((m) => ({
      userId: m.user_id,
      name: m.display_name_snapshot,
      active: m.status === 'active',
    })),
    confirmation,
    attendance,
    view: confirmationViewOf(state, confirmation, ahead),
  };
}
