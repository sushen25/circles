/**
 * Whether a plan with no workable time can really be said to have missed.
 *
 * The engine answers "is there a time that reaches the quorum?". It does not
 * answer "has anybody had the chance to make one?", and the second question is
 * the one that decides whether "there wasn't enough overlap" is true or a
 * nervous organiser is told their plan has failed before it has started
 * (manifesto §3.5).
 *
 * A plan has missed only when the asking is over, or when at least the quorum's
 * worth of people have answered and still nothing reaches it. Anything short of
 * that is a plan still waiting: a circle of one that has just shared its link
 * carries a defaulted quorum of 3 (ADR 0026), and with only the organiser's own
 * times in, the closest anything gets is "1 of 3" by arithmetic, not by
 * anybody's answer.
 *
 * This is only meaningful once the engine has found nothing eligible; whoever
 * asks has already established that.
 */
export function hasMissed(plan: {
  /** The quorum as it is now, chosen or defaulted. */
  readonly quorum: number;
  /** How many of the audience have answered, the organiser included. */
  readonly answeredCount: number;
  /** Whether the plan is still taking answers. */
  readonly repliesOpen: boolean;
}): boolean {
  return !plan.repliesOpen || plan.answeredCount >= plan.quorum;
}
