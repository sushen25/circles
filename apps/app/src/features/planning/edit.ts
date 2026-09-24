import { fromISO, isDeadlineAllowed, type Instant } from '@circles/domain';

import type { PlanDetails, Revision } from '../../data/planning';
import { deadlineFor, latestStartOf, windowOf, type Band, type DateRange } from './form';
import type { PlanDraft, ResolveProblem } from './form';

/**
 * EditPlan and ChangeTime, as data (spec §5.3, §5.7).
 *
 * The draft starts as the plan and the request is **the difference**: a field
 * sent unchanged is refused as `nothing_to_change` when it is all there is,
 * and the server derives from what differs whether this is the cheap
 * adjustment or a new revision that asks everybody again (ADR 0017). The
 * screen never decides that; it reads `bumps_revision` off the preview.
 *
 * **A new question needs a deadline still ahead.** `revise_plan` refuses an
 * edit or a reopen whose deadline has passed (`deadline_out_of_range`),
 * because a fresh ask nobody may answer is not an ask. So when the dates
 * move, the deadline moves with them to the preset's own default — the
 * artboard's "Moved to match the new dates" — unless the organiser chose one.
 */
/**
 * The draft an edit opens on: the plan as it is, its dates as a custom range
 * and its hours as a chosen band, so that nothing differs until somebody
 * changes something.
 */
export function editDraftFrom(plan: PlanDetails): PlanDraft {
  return {
    category: plan.category,
    preset: 'custom',
    custom: { start: plan.windowStart, end: plan.windowEnd },
    band: plan.band,
    duration: plan.durationMinutes,
    quorum: plan.quorum,
    required: [...plan.required],
    deadline: undefined,
  };
}

export type EditResolved =
  | {
      ok: true;
      window: DateRange;
      band: Band;
      latestStart: string;
      deadline: string;
      /** The deadline was moved to fit the new dates, not chosen. */
      deadlineMoved: boolean;
      /** What to send: only what differs from the plan. */
      revision: Revision;
      /** The question changes: window, band or duration, or a reopen. */
      asksAgain: boolean;
    }
  | { ok: false; problem: ResolveProblem };

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

export function resolveEdit(
  plan: PlanDetails,
  draft: PlanDraft,
  now: Instant,
  options: { reopen?: boolean } = {},
): EditResolved {
  const kept = { start: plan.windowStart, end: plan.windowEnd };
  // The plan's own dates go through the same resolution as a custom window:
  // a band that no longer fits, or dates that have gone by, are refused here
  // exactly as the server would refuse them.
  const shape = windowOf(draft.preset, draft.custom, draft.band, draft.duration, now, plan.zone);
  if (typeof shape === 'string') return { ok: false, problem: shape };

  const windowChanged = shape.window.start !== kept.start || shape.window.end !== kept.end;
  const bandChanged =
    shape.band.startMin !== plan.band.startMin || shape.band.endMin !== plan.band.endMin;
  const durationChanged = draft.duration !== plan.durationMinutes;
  const asksAgain = options.reopen === true || windowChanged || bandChanged || durationChanged;
  const latestStart = latestStartOf(shape.window, shape.band, draft.duration, plan.zone);

  let deadline = plan.responseDeadline;
  let deadlineMoved = false;
  const current = fromISO(plan.responseDeadline);
  const currentStands = !windowChanged && isDeadlineAllowed(current, fromISO(latestStart), now);
  if (draft.deadline !== undefined || (asksAgain && !currentStands)) {
    const next = deadlineFor(draft.preset, draft.deadline, latestStart, now);
    if (typeof next === 'string') return { ok: false, problem: next };
    deadline = next.deadline;
    deadlineMoved = next.isDefault;
  }

  const revision: Revision = {};
  if (options.reopen === true) revision.reopen = true;
  if (windowChanged) revision.window = shape.window;
  if (bandChanged) revision.daily = shape.band;
  if (durationChanged) revision.durationMinutes = draft.duration;
  if (draft.quorum !== undefined && draft.quorum !== plan.quorum) revision.quorum = draft.quorum;
  if (draft.required !== undefined && !sameSet(draft.required, plan.required)) {
    revision.requiredMemberIds = [...draft.required];
  }
  if (fromISO(deadline) !== current) revision.responseDeadline = deadline;

  return {
    ok: true,
    window: shape.window,
    band: shape.band,
    latestStart,
    deadline,
    deadlineMoved,
    revision,
    asksAgain,
  };
}

/** Whether a resolved edit changes anything at all. */
export function changesSomething(revision: Revision): boolean {
  return Object.keys(revision).length > 0;
}

/**
 * The names of some user ids, with the reader written as "you" and put first:
 * an organiser is usually in their own re-ask list, and a screen that reads
 * their own name back looks like it is talking about somebody else (S1-27).
 */
export function namesWithYou(
  plan: Pick<PlanDetails, 'roster' | 'me'>,
  ids: readonly string[],
  words: { you: string; someone: string },
): string[] {
  const names = new Map(plan.roster.map((m) => [m.userId, m.name]));
  const mine = plan.me !== undefined && ids.includes(plan.me);
  return [
    ...(mine ? [words.you] : []),
    ...ids.filter((id) => id !== plan.me).map((id) => names.get(id) ?? words.someone),
  ];
}
