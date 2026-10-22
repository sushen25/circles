import type { CircleId, CreatePlanResponse, PlanId } from '@circles/contracts';
import {
  askedDays,
  fromISO,
  fromLocal,
  localDate,
  roundUpToHalfHour,
  toISO,
  toLocal,
  zone as toZone,
  type Instant,
  type LocalDate,
} from '@circles/domain';

import { track } from '../../analytics/track';
import { deviceTimeZone, ownProfile } from '../../data/auth';
import { createCircle, keepInviteSecret } from '../../data/circles';
import { submitAnswer, type Span } from '../../data/availability';
import {
  clearArrivalTag,
  clearDraft,
  readArrivalTag,
  readDraft,
  saveDraft,
  type OrganiserDraft,
} from '../../data/draft';
import { createPlan } from '../../data/planning';
import type { FinishDraftProblem } from './FinishDraftScreen';
import { failureOf } from '../identity/join/failure';
import { formOf, isUntouched } from '../planning/draftPlan';
import { customShape, WINDOW_EVENT } from '../planning/form';
import { categoryLabel } from '../planning/words';

/**
 * Making what the organiser drafted (ADR 0053, ADR 0090): the circle, then the
 * plan, then the organiser's own answer to it, in that order, once each.
 *
 * Run from the code step of the first run, the moment the code is accepted, and
 * from the "Make the link" of an organiser who was signed in already. Nothing
 * here is on a server before it, and nothing here decides who may organise: a
 * session that is not a saved place is refused by `create-circle`, as before.
 *
 * **Safe to run twice.** The three idempotency keys were made with the draft, so
 * a reload in the middle, or a tap on Try again, returns the circle, the plan
 * and the answer the first run made (ADR 0016). The draft is cleared only once
 * all three are done.
 *
 * **The answer is the organiser's own times, on the days they picked** and in
 * the plan's own daily band. Days that went by while they signed in are
 * dropped; when none are left, or they chose to add theirs later, the answer
 * is skipped and the plan is still made and shared (ADR 0090, rule 2). A plan is
 * always at revision 1 when it has just been made, which is the revision the
 * answer is addressed to.
 */
export type Finished = {
  circleId: CircleId;
  planId: PlanId;
  code: string;
  /** The organiser's evenings are in the plan. False: skipped, and "Add my times" stays on the share. */
  answered: boolean;
  /** The arrival was on a tagged link (SUS-240): the source question is answered for them. */
  tagged: boolean;
};

export type Outcome =
  | { kind: 'done'; finished: Finished }
  /** No draft, or one that expired: back to the first screen. */
  | { kind: 'no_draft' }
  /** An account with no name of its own, which the gate did not supply: Your name. */
  | { kind: 'needs_name' };

const FIRST_REVISION = 1;

/** The organiser's answer as willing spans: each picked day, across the plan's band. */
export function answerSpans(
  days: readonly string[],
  window: CreatePlanResponse['window'],
  daily: CreatePlanResponse['daily'],
  zone: string,
  now: Instant,
): Span[] {
  const z = toZone(zone);
  const local = toLocal(now, z);
  const inPlan = new Set<string>(
    askedDays({
      start: localDate(window.start),
      end: localDate(window.end),
      ...(window.days === undefined ? {} : { days: window.days.map(localDate) }),
    }),
  );
  const spans: Span[] = [];
  for (const day of [...days].sort()) {
    // Gone by while the organiser signed in, or not a day the plan asks about.
    if (day < local.date || !inPlan.has(day)) continue;
    // Today's evening is only what is left of it, from the next half hour.
    const from =
      day === local.date
        ? Math.max(daily.startMin, roundUpToHalfHour(local.minutesOfDay))
        : daily.startMin;
    if (from >= daily.endMin) continue;
    spans.push({
      start: toISO(fromLocal(day as LocalDate, from, z)),
      end: toISO(fromLocal(day as LocalDate, daily.endMin, z)),
    });
  }
  return spans;
}

export async function finishDraft(
  at: Instant = fromISO(new Date(Date.now()).toISOString()),
): Promise<Outcome> {
  const draft = await readDraft();
  if (draft === null) return { kind: 'no_draft' };
  if (!draft.proceed) await saveDraft({ proceed: true });

  const profile = await ownProfile();
  if (profile === null || profile.name === null) return { kind: 'needs_name' };
  const zone = profile.zone ?? deviceTimeZone() ?? 'UTC';

  const tag = await readArrivalTag();
  const made = await createCircle({
    name: draft.circleName,
    cadence: draft.cadence,
    timeZone: zone,
    idempotencyKey: draft.keys.circle,
    // The post the organiser came from, when a tagged link brought them
    // (SUS-240): a label for the circle's founder-only cohort row.
    sourceRef: tag,
  });
  const tagged = tag !== undefined;
  await clearArrivalTag();
  keepInviteSecret(made.circle.id, made.invite_secret);
  if (!draft.circleCounted) {
    track('circle_created', { circle_id: made.circle.id });
    await saveDraft({ circleCounted: true });
  }

  const circleId = made.circle.id as CircleId;
  const plan = await makePlan(draft, circleId);
  const answered = await answer(draft, plan, zone, at);

  await clearDraft();
  return {
    kind: 'done',
    finished: {
      circleId,
      planId: plan.plan_id,
      code: plan.short_code,
      answered,
      tagged,
    },
  };
}

async function makePlan(draft: OrganiserDraft, circleId: CircleId): Promise<CreatePlanResponse> {
  const setup = formOf(draft.plan);
  // Only what was chosen is sent, as the plan setup does: a field left at its
  // default is the server's to resolve, and the quorum stays defaulted
  // (ADR 0026). The idempotency key is the draft's, made with it.
  const plan = await createPlan({
    circleId,
    title: categoryLabel(setup.category),
    category: setup.category,
    preset: setup.preset,
    custom: setup.preset === 'custom' ? setup.custom : undefined,
    daily: setup.band,
    durationMinutes: setup.duration === 120 ? undefined : setup.duration,
    responseDeadline: setup.deadline,
    idempotencyKey: draft.keys.plan,
  });
  track('plan_created', {
    circle_id: circleId,
    plan_id: plan.plan_id,
    mode: 'named',
    window: WINDOW_EVENT[setup.preset],
    used_defaults: isUntouched(draft.plan),
    // A custom plan's shape: a flag and a count, never the dates (ADR 0047).
    ...(setup.preset === 'custom' && setup.custom !== undefined ? customShape(setup.custom) : {}),
  });
  return plan;
}

/**
 * The organiser's own answer, after `create-plan`, with its own key. Returns
 * whether it is in. A refusal that is about the answer itself is not a reason
 * to keep the link from the group: the plan exists, and "Add my times" is on
 * the share. A connection that dropped, or a rate limit, is thrown, so the run
 * can be tried again (the keys make that safe).
 */
async function answer(
  draft: OrganiserDraft,
  plan: CreatePlanResponse,
  zone: string,
  now: Instant,
): Promise<boolean> {
  const picked = draft.answer;
  if (picked === undefined || picked.later === true || picked.days.length === 0) return false;
  const windows = answerSpans(picked.days, plan.window, plan.daily, zone, now);
  if (windows.length === 0) return false;
  try {
    await submitAnswer({
      planId: plan.plan_id,
      revision: FIRST_REVISION,
      status: 'windows',
      windows,
      idempotencyKey: draft.keys.answer,
    });
  } catch (error) {
    const failure = failureOf(error);
    if (failure.kind === 'offline') throw error;
    if (failure.kind === 'reason' && failure.reason === 'too_many_requests') throw error;
    return false;
  }
  track('availability_submitted', {
    plan_id: plan.plan_id,
    status: 'windows',
    window_count: windows.length,
    usual_used: false,
  });
  return true;
}

/**
 * The share screen of a first run, with what it needs to know and nothing
 * else: that it is the first run's, whether the organiser's own times are in,
 * and whether the arrival was tagged (the source question is then answered for
 * them).
 */
export function firstShare(finished: Finished) {
  return {
    pathname: '/circles/[id]/plan/[planId]/shared' as const,
    params: {
      id: finished.circleId,
      planId: finished.planId,
      first: finished.answered ? 'answered' : 'later',
      ...(finished.tagged ? { tagged: '1' } : {}),
    },
  };
}

const REASONS: Record<string, FinishDraftProblem> = {
  too_many_requests: 'too_many_tries',
  // Tonight, chosen, and the evening ran out while the gate and the name were done.
  too_late_for_tonight: 'too_late',
  // A window or a deadline chosen on the card, passed while the gate was done.
  window_has_passed: 'time_passed',
  deadline_out_of_range: 'time_passed',
};

/**
 * What a failed finish says to the person: the session stopped being a saved
 * place (back to the gate), or a problem with its reference to quote. Every one
 * of them keeps what was chosen, because the draft is cleared only at the end.
 */
export function finishProblem(
  error: unknown,
): { kind: 'saved_place' } | { kind: 'problem'; problem: FinishDraftProblem; reference?: string } {
  const failure = failureOf(error);
  if (failure.kind === 'reason' && failure.reason === 'requires_saved_place') {
    return { kind: 'saved_place' };
  }
  if (failure.kind === 'offline') return { kind: 'problem', problem: 'offline' };
  if (failure.kind === 'reason' && REASONS[failure.reason] !== undefined) {
    return { kind: 'problem', problem: REASONS[failure.reason]! };
  }
  return {
    kind: 'problem',
    problem: 'couldnt_set_up',
    ...(failure.reference === undefined ? {} : { reference: failure.reference }),
  };
}
