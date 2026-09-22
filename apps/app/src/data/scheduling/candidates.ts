import {
  ANSWERABLE_STATES,
  type ExplanationCode,
  type NearMissReason,
  type PlanState,
  type UserId,
} from '@circles/domain';

import { authClient } from '../auth/client';

/**
 * What the candidates, waiting and no-quorum screens read (spec §5.6).
 *
 * Every row here is readable through RLS by an active member of the circle, so
 * this calls no function: `plans`, `circles`, `circle_members`,
 * `plan_participants`, `candidate_sets` and `candidates` each have a
 * member-select policy, and `response_summaries` is the definer view that says
 * **who has answered and with what status, never what they said** (migration
 * 0004). Nobody's windows are readable but their own, which is why the reply
 * count comes from the engine's own `responded_count` — the same source circle
 * home uses, so the two screens cannot disagree (S1-22).
 *
 * Throws without the plan's id or short code in the message: a plan's code is
 * enough to join it while it is asking (ADR 0022), so it stays out of logs.
 */

const FAILED = 'candidates lookup failed';

/** Which screen the plan is on (S1-16's four states). */
export type SchedulingView = 'ready' | 'no_quorum' | 'collecting' | 'closed';

export type CandidateRow = {
  /**
   * The candidate's id **is its start instant** as ISO, not the row id:
   * `confirm-meetup` takes it that way and it survives a recalculation, which
   * a row id would not (S1-16).
   */
  id: string;
  startsAt: string;
  endsAt: string;
  rank: number;
  /**
   * In the plan's audience order, and never a non-responder — the dashed marks
   * are people who have not answered and are never inside "can make it" (§5.6).
   */
  availableUserIds: string[];
  /** `null` when the database holds a code this build does not know. */
  explanationCode: ExplanationCode | null;
  explanationCount: number;
  /** One rule, not a list. Only ever set on a near-miss. */
  nearMissReason: NearMissReason | null;
};

export type RosterMember = {
  userId: string;
  name: string;
  /**
   * Whether they are still in the circle. A required member who has left is
   * still named by a `required_missing` near-miss (spec §9), so the roster is
   * read without a status filter and the flag carries the difference.
   */
  active: boolean;
};

export type CandidateSetRead = {
  id: string;
  inputVersion: number;
  eligibleCount: number;
  respondedCount: number;
  activeMemberCount: number;
};

export type PlanCandidates = {
  planId: string;
  code: string;
  circleId: string;
  circleName: string;
  title: string;
  zone: string;
  state: PlanState;
  revision: number;
  inputVersion: number;
  /**
   * The quorum **as it is now**. A plan nobody chose one for follows the circle
   * and moves on every join, with no edit and no event (ADR 0026), so this is
   * read on every fetch rather than held from an earlier render.
   */
  quorum: number;
  /** `quorum_source = 'chosen'`: the organiser owns the number from here on. */
  quorumChosen: boolean;
  responseDeadline: string;
  /** Judged by the database's clock, never this device's. */
  repliesOpen: boolean;
  organiserUserId: string | null;
  me: string | undefined;
  isOrganiser: boolean;
  /** Everybody the circle has ever had, oldest first; `active` says who is in. */
  roster: RosterMember[];
  /**
   * Who is being asked, this revision, in the engine's own order.
   *
   * Exactly `engine_input`'s `active_member_ids`: participants of the current
   * revision who are still active members, by `plan_participants.joined_at`.
   * Deliberately not the circle's roster — somebody who joined after the plan
   * was made was never asked, and somebody who has left is not being asked
   * either. Reading the roster here is the bug `engine_input` names in as many
   * words: "4 of 7" with a dashed mark against a person `replace_response`
   * would refuse an answer from.
   */
  participants: string[];
  /**
   * Who has answered, when that is readable. `null` means the view said
   * nothing — a member before options exist, which is deliberate (§5.6: "who
   * has answered is the organiser's to chase, not the circle's to watch").
   */
  responded: string[] | null;
  /** The engine's own count, which is readable even when the summaries are not. */
  repliedCount: number;
  askedCount: number;
  set: CandidateSetRead | null;
  /**
   * The stored set was computed from an older input than the plan now has —
   * somebody answered, or the quorum moved. The options on screen may not be
   * the ones on offer, so nothing is confirmed from them until a fresh read.
   */
  stale: boolean;
  candidates: CandidateRow[];
  nearMisses: CandidateRow[];
  view: SchedulingView;
};

/**
 * Codes this build knows. Written as an exhaustive record rather than a list,
 * so that a code added to the engine fails to compile here instead of arriving
 * on a screen with no sentence for it.
 */
const KNOWN_CODES: Record<ExplanationCode, true> = {
  best_attendance: true,
  same_attendance_weekend: true,
  same_attendance_sooner: true,
  same_attendance_later: true,
  one_fewer_weekend: true,
  one_fewer_sooner: true,
  one_fewer_later: true,
  also_n_sooner: true,
  also_n_later: true,
  closest: true,
};

function codeOf(value: string): ExplanationCode | null {
  return Object.hasOwn(KNOWN_CODES, value) ? (value as ExplanationCode) : null;
}

/** The stored reason, or `null` for anything this build cannot read. */
export function reasonOf(value: unknown): NearMissReason | null {
  if (typeof value !== 'object' || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'quorum_short') {
    const by = (value as { by?: unknown }).by;
    return typeof by === 'number' ? { kind: 'quorum_short', by } : null;
  }
  if (kind === 'required_missing') {
    const userId = (value as { userId?: unknown }).userId;
    // The engine's own branded id; the database stores it as a plain uuid.
    return typeof userId === 'string'
      ? { kind: 'required_missing', userId: userId as unknown as UserId }
      : null;
  }
  return null;
}

/** Which of the four states the plan is in, from the rows a screen will show. */
export function viewOf(
  state: PlanState,
  candidates: readonly CandidateRow[],
  nearMisses: readonly CandidateRow[],
): SchedulingView {
  if (!ANSWERABLE_STATES.includes(state)) return 'closed';
  if (candidates.length > 0) return 'ready';
  if (nearMisses.length > 0) return 'no_quorum';
  return 'collecting';
}

/** The plan behind an id, or behind its short code. `null` when it is neither. */
export async function planCandidates(
  key: { planId: string } | { code: string },
): Promise<PlanCandidates | null> {
  const client = authClient();

  const columns =
    'id, short_code, circle_id, title, state, revision, input_version, time_zone, quorum, quorum_source, response_deadline, organiser_user_id';
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

  const [circle, roster, participants, sets, summaries, open] = await Promise.all([
    client.from('circles').select('name').eq('id', plan.circle_id).maybeSingle(),
    // No status filter: a required member who has left the circle is still
    // named by a near-miss, and a name for their id has to come from somewhere.
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
      .from('candidate_sets')
      .select('id, input_version, eligible_count, responded_count, active_member_count')
      .eq('plan_id', plan.id)
      .eq('revision', plan.revision)
      .order('generated_at', { ascending: false })
      .limit(1),
    client
      .from('response_summaries')
      .select('user_id')
      .eq('plan_id', plan.id)
      .eq('revision', plan.revision),
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
    sets.error !== null ||
    summaries.error !== null ||
    open.error !== null
  ) {
    throw new Error(FAILED);
  }

  const active = new Set(roster.data.filter((m) => m.status === 'active').map((m) => m.user_id));
  const audience = participants.data.map((p) => p.user_id).filter((id) => active.has(id));

  const set = sets.data[0];
  const candidates: CandidateRow[] = [];
  const nearMisses: CandidateRow[] = [];
  if (set !== undefined) {
    const { data: rows, error: rowsError } = await client
      .from('candidates')
      .select(
        'starts_at, ends_at, rank, is_near_miss, available_user_ids, explanation_code, explanation_count, near_miss_reason',
      )
      .eq('candidate_set_id', set.id)
      .order('rank', { ascending: true });
    if (rowsError !== null) throw new Error(FAILED);

    const order = new Map(audience.map((id, index) => [id, index]));
    for (const row of rows) {
      const mapped: CandidateRow = {
        id: row.starts_at,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        rank: row.rank,
        // Re-sorted into the audience's order, so the marks under a card sit in
        // the same order as the marks in the header. The engine stores them in
        // that order already; this makes it true whatever it stored.
        availableUserIds: [...row.available_user_ids].sort(
          (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
        ),
        explanationCode: codeOf(row.explanation_code),
        explanationCount: row.explanation_count,
        nearMissReason: row.is_near_miss ? reasonOf(row.near_miss_reason) : null,
      };
      if (row.is_near_miss) nearMisses.push(mapped);
      else candidates.push(mapped);
    }
  }

  const state = plan.state as PlanState;
  const isOrganiser = me !== undefined && plan.organiser_user_id === me;
  const summariesVisible = isOrganiser || summaries.data.length > 0;
  const rosterMembers: RosterMember[] = roster.data.map((m) => ({
    userId: m.user_id,
    name: m.display_name_snapshot,
    active: m.status === 'active',
  }));

  return {
    planId: plan.id,
    code: plan.short_code,
    circleId: plan.circle_id,
    circleName: circle.data?.name ?? '',
    title: plan.title,
    zone: plan.time_zone,
    state,
    revision: plan.revision,
    inputVersion: plan.input_version,
    quorum: plan.quorum,
    quorumChosen: plan.quorum_source === 'chosen',
    responseDeadline: plan.response_deadline,
    repliesOpen: ANSWERABLE_STATES.includes(state) && open.data !== null,
    organiserUserId: plan.organiser_user_id,
    me,
    isOrganiser,
    roster: rosterMembers,
    participants: audience,
    // An empty array from the view is not the same as no answers: to a member
    // before options exist it returns nothing at all (§5.6), and reading that
    // as "nobody has replied" would contradict the count beside it. The
    // organiser sees the summaries always, so for them empty means empty.
    responded: summariesVisible
      ? summaries.data.flatMap((r) => (r.user_id === null ? [] : [r.user_id]))
      : null,
    repliedCount: set?.responded_count ?? 0,
    askedCount: audience.length,
    set:
      set === undefined
        ? null
        : {
            id: set.id,
            inputVersion: set.input_version,
            eligibleCount: set.eligible_count,
            respondedCount: set.responded_count,
            activeMemberCount: set.active_member_count,
          },
    stale: set !== undefined && set.input_version !== plan.input_version,
    candidates,
    nearMisses,
    view: viewOf(state, candidates, nearMisses),
  };
}
