import { useEffect, useState } from 'react';

import type { FormResolved } from './usePlanForm';

/**
 * The plan forms' clock: plan setup's and Plan another's (S2-04 review
 * round 1). The server resolves a preset when it makes the plan, so a form
 * left open past midnight, or past tonight's last start, would otherwise send
 * a window it no longer shows. Both keep time on screen, and both ask again at
 * the tap (`movedOn`).
 */

/** How often a plan form's clock moves on. */
export const TICK_MS = 60_000;

/** The clock at a tap: read in a handler, never during a render. */
export function clockNow(): number {
  return Date.now();
}

/**
 * The time a plan form reads, moving on every minute while `live`. `start` is
 * the moment it opened, or a function read once for it.
 */
export function usePlanClock(
  start: number | (() => number),
  live: boolean,
): [number, (at: number) => void] {
  const [clock, setClock] = useState(start);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setClock(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [live]);
  return [clock, setClock];
}

/** Whether the form means something different now from when it was drawn. */
export function movedOn(shown: FormResolved, now: FormResolved, defaultDeadline: boolean): boolean {
  if (!shown.ok || !now.ok) return shown.ok !== now.ok;
  return (
    shown.window.start !== now.window.start ||
    shown.window.end !== now.window.end ||
    shown.band.startMin !== now.band.startMin ||
    shown.band.endMin !== now.band.endMin ||
    // The server counts a default deadline from the moment it makes the plan.
    // The screen keeps up to the minute; anything further has not been shown.
    (defaultDeadline &&
      Math.abs(Date.parse(shown.deadline) - Date.parse(now.deadline)) > TICK_MS + 30_000)
  );
}
