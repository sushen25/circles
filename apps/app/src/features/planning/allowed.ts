import { transitionsFrom, type PlanAction, type PlanState } from '@circles/domain';

/**
 * Whether a plan in this state can be edited, reopened or cancelled by its
 * organiser or the circle's owner — asked of the domain's transition table,
 * the one `revise-plan` and `cancel-plan` ask (non-negotiable 2), so the
 * screens cannot drift from what the server allows.
 *
 * A quiet ask's cancel is the initiator's (spec §5.4), not these screens', so
 * only the organiser-or-owner cancel counts.
 */
export function allows(
  state: PlanState,
  action: Extract<PlanAction, 'edit' | 'reopen' | 'cancel'>,
) {
  return transitionsFrom(state).some(
    (t) => t.action === action && (action !== 'cancel' || t.guards.includes('organiser_or_owner')),
  );
}
