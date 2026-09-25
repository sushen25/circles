import type { CircleId, PlanId } from '@circles/contracts';
import { instant } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { track } from '../../analytics/track';
import type { PlanCandidates } from '../../data/scheduling';
import { clockNow, usePlanClock } from '../planning/clock';
import {
  deadlineHeadline,
  deadlineLead,
  extensionOf,
  handOffRowsOf,
  lockInLabel,
} from './deadline';
import { DeadlinePassedScreen } from './DeadlinePassedScreen';
import { useDeadlinePassed } from './useDeadlinePassed';
import { cardsOf, type HeaderView } from './view';

/**
 * The organiser's view of a plan whose replies have closed with options on
 * offer and nothing locked in (spec §5.7). `CandidatesFlow` hands over to this
 * when the read says so — on the database's clock, never this device's — and
 * takes it back when it stops being true: one more day reopens replies and the
 * options screen returns; a hand-off makes the reader a member.
 */
export function DeadlinePassedFlow({
  circleId,
  data,
  header,
  onBack,
}: {
  circleId: string;
  data: PlanCandidates;
  header: HeaderView;
  onBack: () => void;
}) {
  const router = useRouter();
  const actions = useDeadlinePassed({ planId: data.planId, circleId });
  // "Reopens replies until Wed 6 pm" moves with the clock while the screen is
  // open, because the day is counted from now.
  const [clock] = usePlanClock(clockNow, true);
  const [chosen, setChosen] = useState<string>();
  const selectedId =
    chosen !== undefined && data.candidates.some((c) => c.id === chosen)
      ? chosen
      : data.candidates[0]?.id;
  const ids = { circle_id: circleId as CircleId, plan_id: data.planId as PlanId };

  return (
    <DeadlinePassedScreen
      header={header}
      headline={deadlineHeadline(data)}
      lead={deadlineLead(data)}
      cards={cardsOf(data)}
      selectedId={selectedId}
      lockInLabel={lockInLabel(data, selectedId)}
      extension={extensionOf(data, instant(clock))}
      stale={data.stale}
      busy={actions.busy}
      problem={actions.problem}
      sheet={actions.sheet}
      rows={
        actions.members === undefined
          ? undefined
          : handOffRowsOf(actions.members, data.organiserUserId)
      }
      rowsState={actions.membersState}
      targetName={actions.target?.name}
      onSelect={setChosen}
      // Locking in is ConfirmReview's, as it is from the options screen; the
      // candidate travels as its start instant (S1-16).
      onLockIn={() => {
        track('deadline_passed_action', { ...ids, action: 'confirm_anyway' });
        router.push({
          pathname: '/circles/[id]/plan/[planId]/review',
          params: { id: circleId, planId: data.planId, candidate: selectedId ?? '' },
        });
      }}
      onHandOff={actions.openHandOff}
      onExtend={actions.extend}
      onChoose={(userId) => {
        const member = actions.members?.find((m) => m.userId === userId);
        if (member !== undefined) actions.choose(member);
      }}
      onConfirmHandOff={actions.handOff}
      onBackToList={actions.backToList}
      onDismissSheet={actions.dismiss}
      onBack={onBack}
    />
  );
}
