import type { JoinPlanResponse, ShortCode } from '@circles/contracts';
import { useRouter } from 'expo-router';

import { track } from '../../../analytics/track';
import { joinPlan } from '../../../data/membership';
import { NameScreen, type NameProblem } from '../NameScreen';
import { useNameStep } from './useNameStep';

/**
 * The name step in front of a plan link (ADR 0022): "I'm new here", and an
 * account whose own name is already taken in this circle.
 *
 * The same step as the invite's (`useNameStep`), sent to `join-plan` instead of
 * `redeem-invite`. Whether the plan is still asking is learned here, from the
 * answer: a non-member cannot read the plan, so there was nothing to check
 * before, and `invite_inactive` hands back to the caller.
 */
export type PlanNameFlowProps = {
  code: ShortCode;
  circleName: string;
  /** An account naming itself for this circle only (ADR 0022). */
  forAccount?: boolean;
  /** Arriving because a name was refused: the account's own, taken here. */
  refusedName?: string;
  onInactive: () => void;
  onJoined: () => void;
  onBack: () => void;
};

export function PlanNameFlow({
  code,
  circleName,
  forAccount = false,
  refusedName,
  onInactive,
  onJoined,
  onBack,
}: PlanNameFlowProps) {
  const joined = useJoinedFromPlan(code, onJoined);

  const step = useNameStep<JoinPlanResponse>({
    join: (displayName, idempotencyKey) => joinPlan({ code, displayName, idempotencyKey }),
    onJoined: joined,
    onInactive,
    ...(refusedName === undefined
      ? {}
      : {
          initialName: refusedName,
          initialProblem: 'name_taken' as NameProblem,
          initialRefusedName: refusedName,
        }),
  });

  return (
    <NameScreen
      circleName={circleName}
      inviterName={null}
      forAccount={forAccount}
      value={step.name}
      refusedName={step.refusedName}
      problem={step.problem}
      reference={step.reference}
      busy={step.busy}
      onChangeText={step.onChangeText}
      onNext={() => void step.submit()}
      onBack={onBack}
    />
  );
}

/**
 * What happens once `join-plan` has said yes, whoever asked.
 *
 * The gate is told first, so that it asks again and lets the page through;
 * then the availability screen, with `replace` so Back does not return to a
 * form that has been submitted. The event carries the circle and the door and
 * never the code (ADR 0022).
 */
export function useJoinedFromPlan(code: ShortCode, onJoined: () => void) {
  const router = useRouter();
  return (joined: JoinPlanResponse) => {
    track('circle_joined', { circle_id: joined.circle.id, source: 'plan_link' });
    onJoined();
    router.replace({ pathname: '/j/[code]', params: { code } });
  };
}
