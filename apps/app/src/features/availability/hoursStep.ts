import type { EditorState } from './editor';

/**
 * "A time for each day" (and the single-choice "Your hours each evening") is a
 * step of the answer, and an entry of its own in the browser's history (SUS-209).
 *
 * It is the `?step=hours` of the plan link's own address. Browser Back, and the
 * Android web view's hardware Back, then return to the first screen with the
 * answer as it was, and Forward reopens the step.
 *
 * A push to the same route is a second screen with a second editor, and the
 * first stays mounted under it. The answer is therefore handed across (`share`,
 * below): the step starts from the first screen's answer, and every change it
 * makes is handed back when the first screen is in front again.
 *
 * Only this page load's own push counts. A reload (or a pasted address) lands
 * on `?step=hours` with the unsent answer gone, and an empty per-day screen is
 * worse than the first one; the first screen is drawn instead.
 */
export const HOURS_STEP = 'hours';

/** Which plan's hours step this page load pushed; a reload clears it, and Back does not. */
let pushedFor: string | undefined;

export function rememberHoursStepPushed(code: string): void {
  pushedFor = code;
}

export function hoursStepPushed(code: string): boolean {
  return pushedFor === code;
}

/** Whether the step is on show: asked for by the address, and pushed by this page. */
export function hoursStepShown(step: string | undefined, code: string): boolean {
  return step === HOURS_STEP && hoursStepPushed(code);
}

/** The answer as the last editor to change it left it; one plan link's, for this page load. */
export type SharedAnswer = {
  /** The plan link and question it belongs to (`handoffKey`). */
  key: string;
  state: EditorState;
  touched: boolean;
  /** Which of the two editors wrote it. */
  by: 'first' | 'hours';
};

let shared: SharedAnswer | undefined;

export function shareAnswer(answer: SharedAnswer): void {
  shared = answer;
}

/**
 * Whose answer it is: the link and the question as it is asked now, so an
 * answer given to dates the organiser has since changed is never carried onto
 * the new ones (the editor is remounted per revision and set of days).
 */
export function handoffKey(
  code: string,
  plan: {
    id: string;
    revision: number | string;
    windowStart: string;
    windowEnd: string;
    days?: string[] | undefined;
  },
  userId: string | undefined,
): string {
  return [
    userId ?? '',
    code,
    plan.id,
    plan.revision,
    plan.windowStart,
    plan.windowEnd,
    (plan.days ?? []).join(','),
  ].join('|');
}

/** What the step starts from: the first screen's answer, when it is this question's. */
export function sharedFor(key: string): SharedAnswer | undefined {
  return shared?.key === key ? shared : undefined;
}
