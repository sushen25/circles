import type { CircleId, PlanId } from '@circles/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { FunctionError } from '../../data/functions';
import {
  type HandOffCandidate,
  extendDeadline,
  handOffCandidates,
  handOffOrganiser,
} from '../../data/scheduling';
import { isOffline } from '../identity/join/failure';

/**
 * The replies-closed screen's two actions that are not locking something in
 * (spec §5.7, S2-05), and the sheet one of them needs.
 *
 * **One more day** is one tap: it costs nobody a second reply and is shown
 * with the deadline it would give, so there is nothing left to confirm. The
 * screen refetches afterwards and, with replies open again, becomes the
 * ordinary options screen.
 *
 * **Hand this to someone else** asks twice — who, then "hand it to Priya?" —
 * because it cannot be taken back by the person doing it: from the moment it
 * lands the plan is somebody else's to decide, and this screen becomes the
 * member's view of it.
 *
 * Refusals are read from `Problem.reason`, never the message.
 */
export type Sheet = 'who' | 'confirm' | undefined;

export type DeadlinePassedActions = {
  sheet: Sheet;
  target: HandOffCandidate | undefined;
  /** Who could take it, once the sheet has asked. */
  members: HandOffCandidate[] | undefined;
  membersState: 'loading' | 'error' | 'ready';
  busy: 'extend' | 'hand_off' | undefined;
  problem: string | undefined;
  extend: () => void;
  openHandOff: () => void;
  choose: (member: HandOffCandidate) => void;
  backToList: () => void;
  handOff: () => void;
  dismiss: () => void;
};

function problemOf(error: unknown): string {
  if (isOffline()) return t('deadlinePassed', 'problem_offline');
  if (!(error instanceof FunctionError)) return t('deadlinePassed', 'problem_generic');
  switch (error.reason) {
    case 'not_the_organiser':
      return t('deadlinePassed', 'problem_not_organiser');
    case 'requires_saved_place':
      return t('deadlinePassed', 'problem_saved_place');
    case 'not_a_member':
      return t('deadlinePassed', 'problem_left');
    case 'plan_is_finished':
    case 'wrong_state':
      return t('deadlinePassed', 'problem_finished');
    case 'already_extended':
      return t('deadlinePassed', 'problem_extended');
    case 'no_time_to_extend':
      return t('deadlinePassed', 'problem_no_time');
    default:
      return t('deadlinePassed', 'problem_generic');
  }
}

export function useDeadlinePassed({
  planId,
  circleId,
}: {
  planId: string;
  circleId: string;
}): DeadlinePassedActions {
  const client = useQueryClient();
  const [sheet, setSheet] = useState<Sheet>();
  const [target, setTarget] = useState<HandOffCandidate>();
  const [problem, setProblem] = useState<string>();

  const ids = { circle_id: circleId as CircleId, plan_id: planId as PlanId };
  const again = () => client.invalidateQueries({ queryKey: ['plan-candidates', planId] });

  // Asked when the sheet opens, not before: who in the circle is a guest is
  // answered to the organiser only, and only when they are choosing.
  const members = useQuery({
    queryKey: ['hand-off-candidates', planId],
    queryFn: () => handOffCandidates(planId),
    enabled: sheet !== undefined,
    staleTime: 0,
  });

  const extending = useMutation({
    mutationFn: () => extendDeadline(planId),
    onSuccess: () => {
      track('deadline_passed_action', { ...ids, action: 'extend' });
      setProblem(undefined);
      void again();
    },
    // Whatever refused it, the plan on screen is older than the refusal.
    onError: (error) => {
      setProblem(problemOf(error));
      void again();
    },
  });

  const handing = useMutation({
    mutationFn: (to: HandOffCandidate) => handOffOrganiser(planId, to.userId),
    onSuccess: () => {
      track('deadline_passed_action', { ...ids, action: 'hand_off' });
      setSheet(undefined);
      setTarget(undefined);
      setProblem(undefined);
      void again();
    },
    // The sheet closes, so the refusal is in front of the organiser rather
    // than behind a modal.
    onError: (error) => {
      setSheet(undefined);
      setTarget(undefined);
      setProblem(problemOf(error));
      void again();
      void client.invalidateQueries({ queryKey: ['hand-off-candidates', planId] });
    },
  });

  return {
    sheet,
    target,
    members: members.data,
    membersState: members.isError ? 'error' : members.data === undefined ? 'loading' : 'ready',
    busy: extending.isPending ? 'extend' : handing.isPending ? 'hand_off' : undefined,
    problem,
    extend: () => {
      setProblem(undefined);
      extending.mutate();
    },
    openHandOff: () => {
      setProblem(undefined);
      setTarget(undefined);
      setSheet('who');
    },
    choose: (member) => {
      setTarget(member);
      setSheet('confirm');
    },
    backToList: () => {
      setTarget(undefined);
      setSheet('who');
    },
    handOff: () => {
      if (target === undefined) return;
      handing.mutate(target);
    },
    dismiss: () => {
      setSheet(undefined);
      setTarget(undefined);
    },
  };
}
