import type { CircleId, PlanId } from '@circles/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { AttendanceError, setAttendance } from '../../data/confirmation';
import { isOffline } from '../identity/join/failure';

/**
 * "I can't make it after all", and back (spec §5.7).
 *
 * A direct write to the member's own row (S1-17: not an endpoint), then a
 * fresh read, so the count everybody sees and the answer on this screen are
 * the same fact. `attendance_updated` records which way — never who.
 */
export type AttendanceChange = {
  busy: boolean;
  problem: string | undefined;
  change: (status: 'going' | 'cant') => void;
};

export function useAttendance(
  target: { circleId: string; planId: string; confirmationId: string; me: string } | undefined,
  key: string,
): AttendanceChange {
  const client = useQueryClient();
  const [problem, setProblem] = useState<string>();

  const changing = useMutation({
    mutationFn: async (status: 'going' | 'cant') => {
      if (target === undefined) throw new AttendanceError('not_found');
      await setAttendance(target.confirmationId, target.me, status);
    },
    onSuccess: (_nothing, status) => {
      if (target !== undefined) {
        track('attendance_updated', {
          circle_id: target.circleId as CircleId,
          plan_id: target.planId as PlanId,
          status,
        });
      }
      setProblem(undefined);
    },
    onError: (error) => {
      setProblem(
        isOffline()
          ? t('confirmedGuest', 'youre_offline')
          : error instanceof AttendanceError && error.reason !== 'failed'
            ? t('confirmedGuest', 'refused')
            : t('confirmedGuest', 'problem'),
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['plan-confirmation', key] }),
  });

  return {
    busy: changing.isPending,
    problem,
    change: (status) => {
      setProblem(undefined);
      changing.mutate(status);
    },
  };
}
