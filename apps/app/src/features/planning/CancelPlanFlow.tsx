import type { CircleId, IdempotencyKey, PlanId } from '@circles/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import { newIdempotencyKey } from '../../data/functions';
import { cancelPlan } from '../../data/planning';
import { isOffline } from '../identity/join/failure';
import { weekdayOf } from '../scheduling/words';
import { allows } from './allowed';
import { CancelPlanScreen } from './CancelPlanScreen';
import * as fixture from './fixtures';
import { refusalOf, type Refused } from './problems';
import { usePlanDetails } from './usePlanDetails';

/**
 * `/circles/:id/plan/:planId/cancel` — "Cancel this plan" (spec §5.7). The
 * organiser or the circle's owner (§4.5); `cancel-plan` picks which event
 * goes out from the state the plan was in, so this screen does not say.
 * Then the paste-ready update on CancelledOrg.
 */
export function CancelPlanFlow({ id, planId }: { id: string; planId: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const query = usePlanDetails({ planId });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refused>();
  // One key per request: the same note again is the same request.
  const key = useRef<{ for: string; key: IdempotencyKey } | undefined>(undefined);
  const inFlight = useRef(false);

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/circles/[id]', params: { id } });
  const toCancelled = () =>
    router.replace({ pathname: '/circles/[id]/plan/[planId]/cancelled', params: { id, planId } });

  // Already off — cancelled from another tab, or by the owner: the screen to
  // be on is the one that says so, once.
  const plan = query.data ?? undefined;
  const alreadyOff = plan?.state === 'cancelled' && !busy;
  const sent = useRef(false);
  useEffect(() => {
    if (!alreadyOff || sent.current) return;
    sent.current = true;
    router.replace({ pathname: '/circles/[id]/plan/[planId]/cancelled', params: { id, planId } });
  }, [alreadyOff, id, planId, router]);

  if (!hasBackend()) {
    const data = fixture.lockedIn;
    return (
      <CancelPlanScreen
        day={weekdayOf(data.lastConfirmation!.startsAt, data.zone)}
        lockedIn
        note={note}
        onNote={setNote}
        onNext={() => router.push('/circles/sunday-crew/plan/thu-17/cancelled')}
        onKeepIt={back}
        onBack={back}
      />
    );
  }
  if (query.isPending || alreadyOff) return <CancelPlanScreen state="loading" onBack={back} />;
  if (query.isError) {
    return (
      <CancelPlanScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void query.refetch()}
        onBack={back}
      />
    );
  }
  if (plan === undefined) return <CancelPlanScreen state="denied" onBack={back} />;
  if (!plan.isOrganiser && !plan.isOwner) {
    return (
      <CancelPlanScreen
        statement={{ title: t('cancelPlan', 'not_yours'), body: '' }}
        onBack={back}
      />
    );
  }
  if (!allows(plan.state, 'cancel')) {
    return (
      <CancelPlanScreen
        statement={{ title: t('planSetup', 'problem_finished'), body: '' }}
        onBack={back}
      />
    );
  }

  const lockedIn = plan.state === 'confirmed' && plan.lastConfirmation?.status === 'active';
  const cancel = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRefused(undefined);
    // One tap, one cancellation: a retry after a timeout is the same request.
    if (key.current?.for !== note) key.current = { for: note, key: newIdempotencyKey() };
    try {
      await cancelPlan(planId, note, key.current.key);
      track('plan_cancelled', {
        circle_id: plan.circleId as CircleId,
        plan_id: planId as PlanId,
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plan-details', planId] }),
        client.invalidateQueries({ queryKey: ['circle-home', plan.circleId] }),
        client.invalidateQueries({ queryKey: ['plan-candidates'] }),
        client.invalidateQueries({ queryKey: ['plan-confirmation'] }),
      ]);
      toCancelled();
    } catch (error) {
      const answer = refusalOf(error);
      setRefused(answer);
      // A dropped response may have cancelled it; only a settled refusal
      // makes the next tap a new request (ADR 0016).
      if (answer.conclusive) key.current = undefined;
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <CancelPlanScreen
      day={lockedIn ? weekdayOf(plan.lastConfirmation!.startsAt, plan.zone) : undefined}
      lockedIn={lockedIn}
      note={note}
      onNote={setNote}
      refused={refused?.message}
      reference={refused?.reference}
      busy={busy}
      onNext={() => void cancel()}
      onKeepIt={back}
      onBack={back}
    />
  );
}
