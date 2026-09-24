import type { ShortCode } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';

import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { planToAnswer } from '../../data/availability';
import type { PlanDetails } from '../../data/planning';
import { isOffline } from '../identity/join/failure';
import { dateOf, timeOf } from '../scheduling/words';
import { CancelledGuestScreen } from './CancelledGuestScreen';
import { doorFor } from './doors';
import * as fixture from './fixtures';
import { cancelledDay, reopenedDay } from './messages';
import { RescheduledGuestScreen } from './RescheduledGuestScreen';
import { PlanStateScreen } from './states';
import { usePlanDetails } from './usePlanDetails';
import { datesWords } from './words';

/**
 * The member's side of a plan that changed (spec §5.7): `/p/:code` sends a
 * cancelled plan to `/p/:code/cancelled` and a reopened one — to somebody who
 * has not answered the new question — to `/p/:code/rescheduled` first.
 *
 * Redirects happen once, on a read made since the screen mounted and while it
 * is on top, for the reason `CandidatesFlow` gives: a cached state is the state
 * the other door has just sent somebody away from.
 */
function useAnswered(code: string, enabled: boolean): boolean | undefined {
  const session = useSession();
  // The same read and key as `PlanLinkFlow`'s, so the link fetches it once.
  const question = useQuery({
    queryKey: ['plan-to-answer', code, session.userId],
    queryFn: () => planToAnswer(code as ShortCode),
    enabled: enabled && session.userId !== undefined,
    staleTime: 30_000,
  });
  if (question.data === undefined) return undefined;
  return question.data?.answer != null;
}

function nameOf(plan: PlanDetails): string | undefined {
  return plan.roster.find((m) => m.userId === plan.organiserUserId)?.name;
}

export function PlanChangeGate({ code, children }: { code: string; children: ReactNode }) {
  if (!hasBackend()) return <>{children}</>;
  return <LiveGate code={code}>{children}</LiveGate>;
}

function LiveGate({ code, children }: { code: string; children: ReactNode }) {
  const router = useRouter();
  const details = usePlanDetails({ code });
  const plan = details.data ?? undefined;
  const answered = useAnswered(code, plan !== undefined && reopenedDay(plan) !== undefined);
  const door = plan === undefined ? undefined : doorFor(plan, answered);

  const fresh = details.isFetchedAfterMount && !details.isError;
  const focused = useIsFocused();
  const sent = useRef(false);
  useEffect(() => {
    if (door === undefined || door === 'wait' || !fresh || !focused || sent.current) return;
    sent.current = true;
    router.replace(door);
  }, [door, fresh, focused, router]);

  // A failed read is the link's own screen's to report; it has the states.
  if (details.isError) return <>{children}</>;
  if (details.isPending || door !== undefined) return <PlanStateScreen state="loading" />;
  return <>{children}</>;
}

/** `/p/:code/cancelled`. */
export function MemberCancelledFlow({ code }: { code: string }) {
  const router = useRouter();
  const details = usePlanDetails({ code });
  const plan = hasBackend() ? (details.data ?? undefined) : fixture.cancelledAsMember;
  // Not off after all, or off and this is who called it off: their own screen.
  const elsewhere =
    plan === undefined
      ? undefined
      : plan.state !== 'cancelled'
        ? ({ pathname: '/p/[code]', params: { code } } as const)
        : plan.isOrganiser || plan.isOwner
          ? ({
              pathname: '/circles/[id]/plan/[planId]/cancelled',
              params: { id: plan.circleId, planId: plan.planId },
            } as const)
          : undefined;
  useOnce(hasBackend() && elsewhere !== undefined && details.isFetchedAfterMount, () => {
    if (elsewhere !== undefined) router.replace(elsewhere);
  });
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (hasBackend() && details.isError) {
    const state = isOffline() ? 'offline' : 'error';
    return (
      <CancelledGuestScreen state={state} onRetry={() => void details.refetch()} onBack={back} />
    );
  }
  if (plan === undefined || elsewhere !== undefined) {
    return <CancelledGuestScreen state="loading" onBack={back} />;
  }
  return (
    <CancelledGuestScreen
      circleName={plan.circleName}
      day={cancelledDay(plan)}
      organiserName={nameOf(plan)}
      note={plan.cancelNote}
      onBackToCircle={() =>
        router.replace({ pathname: '/circles/[id]', params: { id: plan.circleId } })
      }
      onBack={back}
    />
  );
}

/** `/p/:code/rescheduled`. */
export function RescheduledFlow({ code }: { code: string }) {
  const router = useRouter();
  const details = usePlanDetails({ code });
  const plan = hasBackend() ? (details.data ?? undefined) : fixture.reopened;
  const day = plan === undefined ? undefined : reopenedDay(plan);
  const elsewhere = plan !== undefined && (day === undefined || plan.isOrganiser);
  useOnce(hasBackend() && elsewhere && details.isFetchedAfterMount, () =>
    router.replace({ pathname: '/p/[code]', params: { code } }),
  );
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (hasBackend() && details.isError) {
    const state = isOffline() ? 'offline' : 'error';
    return (
      <RescheduledGuestScreen state={state} onRetry={() => void details.refetch()} onBack={back} />
    );
  }
  if (plan === undefined || elsewhere || plan.lastConfirmation === null) {
    return <RescheduledGuestScreen state="loading" onBack={back} />;
  }
  const last = plan.lastConfirmation;
  return (
    <RescheduledGuestScreen
      circleName={plan.circleName}
      day={day}
      organiserName={nameOf(plan)}
      previously={`${dateOf(last.startsAt, plan.zone)}, ${timeOf(last.startsAt, last.endsAt, plan.zone)}`}
      nowAsking={datesWords({ start: plan.windowStart, end: plan.windowEnd })}
      onNext={() => router.push({ pathname: '/j/[code]', params: { code: plan.code } })}
      onNotThisTime={() => router.push({ pathname: '/j/[code]/none', params: { code: plan.code } })}
      onBack={back}
    />
  );
}

/** Run `act` the first time `when` is true, and never again for this screen. */
function useOnce(when: boolean, act: () => void) {
  const done = useRef(false);
  const focused = useIsFocused();
  useEffect(() => {
    if (!when || !focused || done.current) return;
    done.current = true;
    act();
  });
}
