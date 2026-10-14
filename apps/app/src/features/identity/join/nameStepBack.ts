import type { ShortCode } from '@circles/contracts';

/**
 * Where Back goes from a plan link's name step (SUS-208).
 *
 * A guest who has mistyped a name taps Back and must still be on the plan
 * link: the website (`/`) is never the answer, because a phone that came from
 * a chat has no way back to the link but the chat.
 *
 * - **There is a list before it** ("Have you answered this before?"): Back
 *   returns to it. When this flow pushed the name step (`pushedHere`) that is
 *   the browser's own Back; otherwise the address was opened straight on the
 *   name step (a reload, a pasted link) and what is behind it in the history
 *   is not ours, so the step is replaced by the list.
 * - **There is nothing before it** (`nobodyToBe`): the name step is the plan
 *   link's landing. Back stays on it and starts the field again.
 */
export type NameStepBack = 'pop' | 'to_list' | 'start_over';

export const NAME_STEP = 'name';

export function nameStepBack({
  nobodyToBe,
  pushedHere,
  canGoBack,
}: {
  nobodyToBe: boolean;
  pushedHere: boolean;
  canGoBack: boolean;
}): NameStepBack {
  if (nobodyToBe) return 'start_over';
  return pushedHere && canGoBack ? 'pop' : 'to_list';
}

/**
 * Which plan's name step this page load pushed. A module variable, not state,
 * because pushing the step remounts the screen; a reload clears it, which is
 * the point. It is not cleared by going back: the entry stays reachable by the
 * browser's Forward, and is still ours when it comes back.
 */
let pushedFor: ShortCode | undefined;

export function rememberNameStepPushed(code: ShortCode): void {
  pushedFor = code;
}

export function nameStepPushed(code: ShortCode): boolean {
  return pushedFor === code;
}

/**
 * Whether the name step's entry is the one on screen right now. Kept in step
 * with the address by `ContinueAsFlow`, which outlives the step, so a join that
 * finishes after Back (or after the browser's Back) finds it closed and
 * dismisses nothing.
 */
let openFor: ShortCode | undefined;

export function setNameStepOpen(code: ShortCode, open: boolean): void {
  if (open) openFor = code;
  else if (openFor === code) openFor = undefined;
}

export function nameStepOpen(code: ShortCode): boolean {
  return openFor === code;
}
