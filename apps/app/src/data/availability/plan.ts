import {
  ANSWERABLE_STATES,
  DURATIONS,
  localDate,
  zone,
  type DurationMinutes,
  type PlanCategory,
  type PlanState,
  type PlanTiming,
  type ResponseStatus,
} from '@circles/domain';
import type { ShortCode } from '@circles/contracts';

import { authClient } from '../auth/client';

/**
 * The plan somebody is answering, and what they have said so far (spec §5.5).
 *
 * Plain strings and numbers throughout, not the domain's branded types, because
 * this is also what a draft keeps on the device: somebody who painted their
 * times and lost signal can reload and still see the question they were
 * answering (`drafts.ts`). `timingOf` turns it back into what the domain wants.
 *
 * Read through RLS as the member: `plans` and `circles` are readable by an
 * active member of the circle, and `plan_responses` and `willing_windows` by
 * their owner and nobody else. No function is called to read any of it.
 */
export type AnswerablePlan = {
  id: string;
  code: string;
  circleId: string;
  circleName: string;
  title: string;
  category: PlanCategory;
  state: PlanState;
  /** The question being answered. An answer names it, and an edit moves it. */
  revision: number;
  zone: string;
  windowStart: string;
  windowEnd: string;
  dailyStartMin: number;
  dailyEndMin: number;
  durationMinutes: DurationMinutes;
  /** ISO. Shown, never compared with this device's clock. */
  responseDeadline: string;
  /**
   * Whether the plan was taking answers when it was read, **judged by the
   * database's clock**: an answerable state and a deadline still ahead — the
   * domain's `acceptsAnswers`, with the server's `now` rather than the phone's.
   * A plan stays collecting after its deadline so the organiser can decide
   * (spec §8), so the state alone would let people paint for a plan that is
   * not asking; the device's clock would close it early on a phone that runs
   * fast, and refuse an answer the server would take.
   */
  acceptingAnswers: boolean;
  /** The organiser's name in this circle, or null (a quiet ask has none yet). */
  organiserName: string | null;
  /**
   * Who is organising it, or null. The screens after an answer need to know
   * whether the person reading them is the one who asked: the organiser hears
   * about their own plan already, and everybody else — account or not — has to
   * subscribe for that (§5.8).
   */
  organiserUserId: string | null;
};

export type Span = { start: string; end: string };

/** What this person answered to the current revision, if anything. */
export type OwnAnswer = {
  status: ResponseStatus;
  /** ISO spans, as stored: aligned, merged and inside the plan. */
  windows: Span[];
  submittedAt: string;
};

export type PlanToAnswer = { plan: AnswerablePlan; answer: OwnAnswer | null };

export function timingOf(plan: AnswerablePlan): PlanTiming {
  return {
    window: { start: localDate(plan.windowStart), end: localDate(plan.windowEnd) },
    daily: { startMin: plan.dailyStartMin, endMin: plan.dailyEndMin },
    durationMinutes: plan.durationMinutes,
    zone: zone(plan.zone),
  };
}

/**
 * The plan behind a short code, and this person's answer to its current
 * revision. `null` when no plan comes back, which through RLS means "not a
 * plan you can see" — the gate in front of this route has already sent anybody
 * that is true of somewhere else, so a caller meeting it has raced a removal.
 *
 * Throws on a failed read, never a message carrying the code: the code is
 * enough to join while the plan is asking (ADR 0022), so it stays out of logs.
 */
export async function planToAnswer(code: ShortCode): Promise<PlanToAnswer | null> {
  const client = authClient();

  const { data: row, error } = await client
    .from('plans')
    .select(
      'id, short_code, circle_id, title, category, state, revision, time_zone, window_start, window_end, daily_start_local, daily_end_local, duration_minutes, response_deadline, organiser_user_id',
    )
    .eq('short_code', code)
    .maybeSingle();
  if (error !== null) throw new Error('plan lookup failed');
  if (row === null) return null;

  const { data: me } = await client.auth.getSession();
  const userId = me.session?.user.id;

  const [circle, organiser, response, open] = await Promise.all([
    client.from('circles').select('name').eq('id', row.circle_id).maybeSingle(),
    row.organiser_user_id === null
      ? Promise.resolve({ data: null, error: null })
      : client
          .from('circle_members')
          .select('display_name_snapshot')
          .eq('circle_id', row.circle_id)
          .eq('user_id', row.organiser_user_id)
          .eq('status', 'active')
          .maybeSingle(),
    userId === undefined
      ? Promise.resolve({ data: null, error: null })
      : client
          .from('plan_responses')
          .select('id, status, submitted_at, willing_windows (starts_at, ends_at)')
          .eq('plan_id', row.id)
          .eq('revision', row.revision)
          .eq('user_id', userId)
          .maybeSingle(),
    // `'now'` is Postgres's own input for the current time, so this compares
    // the deadline on the database's clock. The row coming back is the answer.
    client.from('plans').select('id').eq('id', row.id).gt('response_deadline', 'now').maybeSingle(),
  ]);
  if (
    circle.error !== null ||
    organiser.error !== null ||
    response.error !== null ||
    open.error !== null
  ) {
    throw new Error('plan lookup failed');
  }

  // Parsed rather than asserted, as `submit-availability` does: `plans_duration`
  // allows only the four, so anything else is a database that stopped being true.
  const duration = row.duration_minutes as DurationMinutes;
  if (!DURATIONS.includes(duration)) throw new Error('plan lookup failed');

  const plan: AnswerablePlan = {
    id: row.id,
    code: row.short_code,
    circleId: row.circle_id,
    circleName: circle.data?.name ?? '',
    title: row.title,
    category: row.category as PlanCategory,
    state: row.state as PlanState,
    revision: row.revision,
    zone: row.time_zone,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    dailyStartMin: row.daily_start_local,
    dailyEndMin: row.daily_end_local,
    durationMinutes: duration,
    responseDeadline: row.response_deadline,
    organiserName: organiser.data?.display_name_snapshot ?? null,
    organiserUserId: row.organiser_user_id,
    acceptingAnswers: ANSWERABLE_STATES.includes(row.state as PlanState) && open.data !== null,
  };

  const stored = response.data;
  const answer: OwnAnswer | null =
    stored === null
      ? null
      : {
          status: stored.status as ResponseStatus,
          windows: [...(stored.willing_windows ?? [])]
            .map((w) => ({ start: w.starts_at, end: w.ends_at }))
            .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
          submittedAt: stored.submitted_at,
        };

  return { plan, answer };
}
