import {
  type Attendance,
  type Circle,
  type EligibilityContext,
  type Member,
  type Plan,
  type Response,
  type UserId,
  type Zone,
  instant,
  localDate,
  zone,
} from '@circles/domain';

import type { Db } from '../_shared/db.ts';

/**
 * One plan's state, as the rules want it.
 *
 * `public.dispatch_context` reads it in one statement; this turns the rows
 * into the domain's types so that `recipientsFor` can be asked the question.
 * The shape of the answer is the whole point of the split: every decision the
 * dispatcher would otherwise take — who hears, on what, when — is a pure
 * function of this value (non-negotiable 2), and the dispatcher stays a loop.
 *
 * The one thing that is **not** turned into a domain type is the contact list.
 * A contact is a row in `private.email_contacts` and the domain has no idea
 * such a thing exists; it answers in members, and mapping a member to the
 * address they asked to be written at is this layer's job.
 */

type MemberRow = {
  circle_id: string;
  user_id: string;
  display_name: string;
  role: string;
  status: string;
  joined_at: string;
  muted_quiet_asks: boolean;
  muted_all: boolean;
  time_zone: string;
  is_permanent: boolean;
  /** The person's "Emails about plans you organise" switch, off (ADR 00XX). */
  muted_organiser_email: boolean;
};

type ConfirmationRow = {
  id: string;
  revision: number;
  starts_at: string;
  ends_at: string;
  place_name: string | null;
  note: string | null;
  status: string;
  confirmed_by: string;
  available_user_ids: string[];
};

type ContextRow = {
  circle: Record<string, unknown>;
  plan: Record<string, unknown>;
  organiser_name: string | null;
  members: MemberRow[];
  participant_ids: string[];
  responses: { plan_id: string; revision: number; user_id: string; status: string }[];
  confirmation: ConfirmationRow | null;
  superseded_confirmation: ConfirmationRow | null;
  attendance: { confirmation_id: string; user_id: string; status: string }[];
  email_recipients: { contact_id: string; user_id: string }[];
  push_user_ids: string[];
  best_candidate: { starts_at: string; available_count: number } | null;
  already_reminded: string[];
};

/** Everything one plan's notifications need, rules and rendering alike. */
export type PlanContext = {
  readonly planId: string;
  readonly circleId: string;
  readonly circleName: string;
  readonly planCode: string;
  readonly planState: string;
  readonly planZone: Zone;
  readonly revision: number;
  readonly organiserUserId: string | undefined;
  readonly organiserName: string | undefined;
  /** The organiser's words on the cancel screen, for the `cancelled` letter. */
  readonly cancelNote: string | undefined;
  readonly confirmation: ConfirmationRow | null;
  readonly supersededConfirmation: ConfirmationRow | null;
  readonly bestCandidate: { startsAt: string; availableCount: number } | null;
  /** The recipient's own zone, which is what quiet hours are computed in. */
  readonly zoneOf: (userId: string) => Zone;
  /** Every verified, subscribed, still-active contact for this plan. */
  readonly contactsOf: (userId: string) => readonly string[];
  readonly eligibility: EligibilityContext;
};

function asInstant(value: string): ReturnType<typeof instant> {
  return instant(Date.parse(value));
}

function circleOf(row: Record<string, unknown>): Circle {
  const optionalNudge = (row['nudge_policy'] ?? null) as NonNullable<Circle['nudgePolicy']> | null;
  const optionalQuorum = row['default_quorum'] as number | null;
  const optionalArea = row['default_area'] as string | null;
  const optionalMet = row['last_met_at'] as string | null;
  const optionalSnooze = row['cadence_snoozed_until'] as string | null;
  return {
    id: row['id'] as Circle['id'],
    ownerUserId: row['owner_user_id'] as UserId,
    name: row['name'] as string,
    color: row['color'] as string,
    zone: zone(row['time_zone'] as string),
    cadence: row['cadence'] as Circle['cadence'],
    ...(optionalNudge === null ? {} : { nudgePolicy: optionalNudge }),
    defaultDurationMinutes: row['default_duration_minutes'] as number,
    ...(optionalQuorum === null ? {} : { defaultQuorum: optionalQuorum }),
    ...(optionalArea === null ? {} : { defaultArea: optionalArea }),
    status: row['status'] as Circle['status'],
    ...(optionalMet === null ? {} : { lastMetAt: asInstant(optionalMet) }),
    ...(optionalSnooze === null ? {} : { cadenceSnoozedUntil: asInstant(optionalSnooze) }),
  };
}

function planOf(row: Record<string, unknown>): Plan {
  const organiser = row['organiser_user_id'] as string | null;
  const threshold = row['quiet_threshold'] as number | null;
  const expires = row['quiet_expires_at'] as string | null;
  return {
    id: row['id'] as Plan['id'],
    circleId: row['circle_id'] as Plan['circleId'],
    mode: row['mode'] as Plan['mode'],
    state: row['state'] as Plan['state'],
    ...(organiser === null ? {} : { organiserUserId: organiser as UserId }),
    title: row['title'] as string,
    category: row['category'] as Plan['category'],
    zone: zone(row['time_zone'] as string),
    window: {
      start: localDate(row['window_start'] as string),
      end: localDate(row['window_end'] as string),
    },
    daily: {
      startMin: row['daily_start_local'] as number,
      endMin: row['daily_end_local'] as number,
    },
    durationMinutes: row['duration_minutes'] as Plan['durationMinutes'],
    quorum: row['quorum'] as number,
    requiredMemberIds: [],
    responseDeadline: asInstant(row['response_deadline'] as string),
    ...(threshold === null ? {} : { quietThreshold: threshold }),
    ...(expires === null ? {} : { quietExpiresAt: asInstant(expires) }),
    revision: row['revision'] as number,
    inputVersion: row['input_version'] as number,
    scoringVersion: row['scoring_version'] as number,
    shortCode: row['short_code'] as string,
  };
}

function memberOf(row: MemberRow): Member {
  return {
    circleId: row.circle_id as Member['circleId'],
    userId: row.user_id as UserId,
    displayName: row.display_name,
    role: row.role as Member['role'],
    status: row.status as Member['status'],
    joinedAt: asInstant(row.joined_at),
    mutedQuietAsks: row.muted_quiet_asks,
    mutedAll: row.muted_all,
    isPermanent: row.is_permanent,
  };
}

/**
 * Statuses only, and windows never.
 *
 * Eligibility asks who answered, not what they said, and a `Response` with an
 * empty window list is the honest shape for that: the alternative is reading
 * `willing_windows` for every recipient of every message, which is a great
 * deal of somebody's availability moved through a code path that has no use
 * for it (privacy invariant: availability is scoped to one plan revision).
 */
function responseOf(row: { plan_id: string; revision: number; user_id: string; status: string }) {
  return {
    planId: row.plan_id,
    revision: row.revision,
    userId: row.user_id,
    status: row.status,
    windows: [],
    usedCalendarOverlay: false,
    submittedAt: instant(0),
  } as unknown as Response;
}

export async function loadContext(service: Db, planId: string): Promise<PlanContext | null> {
  const { data, error } = await service.rpc('dispatch_context', { p_plan_id: planId });
  if (error !== null) throw error;
  if (data === null) return null;

  const row = data as unknown as ContextRow;
  const circle = circleOf(row.circle);
  const plan = planOf(row.plan);
  const members = row.members.map(memberOf);
  const pushes = new Set(row.push_user_ids);
  const subscribed = new Map<string, string[]>();
  for (const recipient of row.email_recipients) {
    subscribed.set(recipient.user_id, [
      ...(subscribed.get(recipient.user_id) ?? []),
      recipient.contact_id,
    ]);
  }
  const zones = new Map(row.members.map((m) => [m.user_id, zone(m.time_zone)] as const));
  const organiserEmailOff = new Set(
    row.members.filter((m) => m.muted_organiser_email).map((m) => m.user_id),
  );

  const attendance: readonly Attendance[] = row.attendance.map((a) => ({
    confirmationId: a.confirmation_id as Attendance['confirmationId'],
    userId: a.user_id as UserId,
    status: a.status as Attendance['status'],
    updatedAt: instant(0),
  }));

  const eligibility: EligibilityContext = {
    circle,
    plan,
    members,
    participantIds: row.participant_ids as UserId[],
    responses: row.responses.map(responseOf),
    hasPushDevice: (userId) => pushes.has(userId),
    hasPlanEmailSubscription: (userId) => subscribed.has(userId),
    mutedOrganiserEmail: (userId) => organiserEmailOff.has(userId),
    attendance,
    ...(row.confirmation === null
      ? {}
      : { confirmationId: row.confirmation.id as Attendance['confirmationId'] }),
    alreadySent: row.already_reminded as UserId[],
  };

  return {
    planId: plan.id,
    circleId: plan.circleId,
    circleName: circle.name,
    planCode: plan.shortCode,
    planState: plan.state,
    planZone: plan.zone,
    revision: plan.revision,
    organiserUserId: plan.organiserUserId,
    organiserName: row.organiser_name ?? undefined,
    cancelNote: (row.plan['cancel_note'] as string | null) ?? undefined,
    confirmation: row.confirmation,
    supersededConfirmation: row.superseded_confirmation,
    bestCandidate:
      row.best_candidate === null
        ? null
        : {
            startsAt: row.best_candidate.starts_at,
            availableCount: row.best_candidate.available_count,
          },
    zoneOf: (userId) => zones.get(userId) ?? circle.zone,
    contactsOf: (userId) => subscribed.get(userId) ?? [],
    eligibility,
  };
}
