import type { CircleId, IdempotencyKey, PlanId } from '@circles/contracts';
import type { Outcome } from '@circles/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import {
  reportAttendance,
  reportOutcome,
  setAttendanceDismissed,
  type PlanConfirmation,
  type RetrospectiveAnswer,
} from '../../data/confirmation';
import { newIdempotencyKey } from '../../data/functions';
import { failureOf } from '../identity/join/failure';

/**
 * The two morning-after writes, both through `report-outcome` (S1-17), and
 * what each leaves behind.
 *
 * **One key per answer** (ADR 0016). A tap that timed out and is tried again
 * sends the same key, so a report that did land is answered from the record;
 * a *different* answer gets a new key, because the same key with a different
 * body is `idempotency_mismatch`, not a correction.
 *
 * **Everything that shows the circle is read again** on success: circle home's
 * "Last caught up" moves only on `happened`, and it moves on the server, so the
 * home has to ask rather than be told.
 *
 * **`in_progress` lets the next tap go under a new key** (review round 3). The
 * server holds a claimed key as in flight until its request finishes, and one
 * that died without a classifiable error never does — so the same key would be
 * refused for ever. A fresh key is safe here because both writes are idempotent
 * on the answer itself: `report_outcome` returns the report already made for
 * the same outcome, and the same attendance twice is a no-op. Meanwhile the
 * plan is read again, in case the first attempt did land.
 *
 * Refusals that mean "this meetup is not what you were looking at" — rescheduled,
 * cancelled, already reported — read the plan again as well as saying so, so
 * the screen underneath the notice becomes the right one.
 */

const CIRCLE_READS = [['circle-home'], ['circles']] as const;

function keyFor(
  ref: { current: { answer: string; key: IdempotencyKey } | undefined },
  answer: string,
) {
  if (ref.current?.answer !== answer) ref.current = { answer, key: newIdempotencyKey() };
  return ref.current.key;
}

function idsOf(data: PlanConfirmation) {
  return { circle_id: data.circleId as CircleId, plan_id: data.planId as PlanId };
}

const CHANGED_UNDERNEATH = new Set([
  'outcome_already_reported',
  'confirmation_not_active',
  'confirmation_not_found',
  'stale_confirmation',
  'not_the_organiser',
  'attendance_confirmation_missing',
  'attendance_confirmation_not_live',
  'attendance_not_a_participant',
  'attendance_not_reversible',
]);

export type OutcomeReport = {
  busy: boolean;
  notice: string | undefined;
  save: (outcome: Outcome, movedOutside: boolean, note: string) => void;
};

export function useReportOutcome(
  data: PlanConfirmation | undefined,
  queryKey: string,
  onReported: () => void,
): OutcomeReport {
  const client = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const key = useRef<{ answer: string; key: IdempotencyKey }>(undefined);

  const reporting = useMutation({
    mutationFn: async ({
      outcome,
      movedOutside,
      note,
    }: {
      outcome: Outcome;
      movedOutside: boolean;
      note: string;
    }) => {
      const confirmationId = data?.confirmation?.id;
      if (confirmationId === undefined) throw new Error('no confirmation');
      return reportOutcome({
        confirmationId,
        outcome,
        movedOutside,
        note,
        key: keyFor(key, `${outcome}\n${String(movedOutside)}\n${note.trim()}`),
      });
    },
    onSuccess: async (_evidence, { outcome }) => {
      if (data !== undefined) track('outcome_reported', { ...idsOf(data), outcome });
      setNotice(undefined);
      await Promise.all(
        [...CIRCLE_READS, ['plan-confirmation']].map((k) =>
          client.invalidateQueries({ queryKey: k }),
        ),
      );
      onReported();
    },
    onError: (error) => {
      const failure = failureOf(error);
      if (failure.kind === 'offline') return setNotice(t('outcome', 'save_offline'));
      if (failure.kind === 'reason' && failure.reason === 'in_progress') {
        key.current = undefined;
        setNotice(t('outcome', 'save_in_progress'));
        void client.invalidateQueries({ queryKey: ['plan-confirmation', queryKey] });
        return;
      }
      if (failure.kind === 'reason' && failure.reason === 'outcome_too_early') {
        return setNotice(t('outcome', 'save_early'));
      }
      if (failure.kind === 'reason' && CHANGED_UNDERNEATH.has(failure.reason)) {
        setNotice(t('outcome', 'save_changed'));
        void client.invalidateQueries({ queryKey: ['plan-confirmation', queryKey] });
        return;
      }
      setNotice(t('outcome', 'save_problem'));
    },
  });

  return {
    busy: reporting.isPending,
    notice,
    save: (outcome, movedOutside, note) => {
      setNotice(undefined);
      reporting.mutate({ outcome, movedOutside, note });
    },
  };
}

export type AttendanceReport = {
  saving: RetrospectiveAnswer | undefined;
  notice: string | undefined;
  answer: (answer: RetrospectiveAnswer) => void;
  notNow: () => Promise<void>;
};

export function useReportAttendance(
  data: PlanConfirmation | undefined,
  queryKey: string,
  /** With the answer: only "I was there" is the after-attendance moment (S2-07). */
  onAnswered: (answer: RetrospectiveAnswer) => void,
): AttendanceReport {
  const client = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const key = useRef<{ answer: string; key: IdempotencyKey }>(undefined);

  const answering = useMutation({
    mutationFn: async (answer: RetrospectiveAnswer) => {
      const confirmationId = data?.confirmation?.id;
      if (confirmationId === undefined) throw new Error('no confirmation');
      return reportAttendance({ confirmationId, attendance: answer, key: keyFor(key, answer) });
    },
    onSuccess: async (evidence, answer) => {
      // "I was there" is the corroboration the north star counts (§11.1). The
      // count is the server's, from `confirmation_evidence`, and goes to the
      // funnel only — never onto a screen, where it would be a scoreboard.
      // Once per answer: the same answer again is a no-op on the server, and
      // is not a second corroboration (review round 6).
      const before = data?.attendance.find((a) => a.userId === data.me)?.status;
      if (data !== undefined && answer === 'was_there' && before !== 'was_there') {
        track('attendance_confirmed', { ...idsOf(data), attended_count: evidence.was_there });
      }
      setNotice(undefined);
      await Promise.all(
        [...CIRCLE_READS, ['plan-confirmation']].map((k) =>
          client.invalidateQueries({ queryKey: k }),
        ),
      );
      onAnswered(answer);
    },
    onError: (error) => {
      const failure = failureOf(error);
      if (failure.kind === 'offline') return setNotice(t('wasThere', 'save_offline'));
      if (failure.kind === 'reason' && failure.reason === 'in_progress') {
        key.current = undefined;
        setNotice(t('wasThere', 'save_in_progress'));
        void client.invalidateQueries({ queryKey: ['plan-confirmation', queryKey] });
        return;
      }
      if (failure.kind === 'reason' && failure.reason === 'attendance_too_early') {
        return setNotice(t('wasThere', 'early_body'));
      }
      if (failure.kind === 'reason' && CHANGED_UNDERNEATH.has(failure.reason)) {
        setNotice(t('wasThere', 'save_refused'));
        void client.invalidateQueries({ queryKey: ['plan-confirmation', queryKey] });
        return;
      }
      setNotice(t('wasThere', 'save_problem'));
    },
  });

  return {
    saving: answering.isPending ? answering.variables : undefined,
    notice,
    answer: (answer) => {
      setNotice(undefined);
      answering.mutate(answer);
    },
    notNow: async () => {
      const confirmationId = data?.confirmation?.id;
      if (data?.me !== undefined && confirmationId !== undefined) {
        await setAttendanceDismissed(data.me, confirmationId);
      }
      await client.invalidateQueries({ queryKey: ['circle-home'] });
    },
  };
}
