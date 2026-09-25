import type { ShortCode } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { track } from '../../analytics/track';
import { useSession } from '../../data/auth/session';
import { planToAnswer } from '../../data/availability';
import { ownNameIn } from '../../data/membership';
import { ContinueAsScreen } from '../identity/ContinueAsScreen';
import { SavePlaceByEmail } from '../identity/SavePlaceByEmail';
import { ReattachedNudgeScreen } from './ReattachedNudgeScreen';
import { useNudge } from './useNudge';

/**
 * "Keep your place for good?" (spec §5.11), between a Continue-as from the
 * list and the page the person was opening.
 *
 * **Only after a list reattach.** The emailed way back in (`/a#…`) is a token
 * reattach and lands straight on its page; `MembershipGate` draws this only
 * when `ContinueAsFlow` says the list was used.
 *
 * **Never before an answer.** A member who has not answered this plan is on
 * their way to doing so, and nothing may stand in front of that; they see the
 * page. "Your times are still here" is then also true of everybody who does
 * see it.
 *
 * **Once.** `record-nudge` records it against the plan they came back through,
 * and that row travels with the membership on the next reattach — so the
 * second time is not this prompt again. (The app sheet is the second time's,
 * in Slice 3; until then, nothing.)
 */
export function ReattachedNudgeFlow({
  code,
  onDone,
  children,
}: {
  code: string;
  /** Answered, skipped or saved: the page underneath is next. */
  onDone: () => void;
  children: ReactNode;
}) {
  const session = useSession();
  const [step, setStep] = useState<'nudge' | 'email'>('nudge');

  const question = useQuery({
    queryKey: ['plan-to-answer', code, session.userId],
    queryFn: () => planToAnswer(code as ShortCode),
    enabled: session.userId !== undefined,
    staleTime: 30_000,
  });
  const plan = question.data?.plan;
  const answered = question.data?.answer !== null && question.data?.answer !== undefined;
  const name = useQuery({
    queryKey: ['own-name', plan?.circleId, session.userId],
    queryFn: () => ownNameIn(plan?.circleId as string),
    enabled: plan !== undefined,
    staleTime: Infinity,
  });
  const nudge = useNudge('reattached_save_place', { planId: plan?.id, enabled: answered });

  const loading = <ContinueAsScreen circleName={plan?.circleName} state="loading" />;
  if (question.isPending) return loading;
  // A read that failed or found nothing is not a reason to hold the page.
  if (question.isError || plan === undefined || !answered || nudge.showing === 'skip') {
    return <>{children}</>;
  }
  if (nudge.showing === 'pending' || name.isPending) return loading;

  const carryOn = () => {
    nudge.dismiss();
    onDone();
  };

  if (step === 'email') {
    return (
      <SavePlaceByEmail
        moment="reattached"
        circleName={plan.circleName}
        onSaved={() => {
          track('account_claimed', { moment: 'reattached' });
          onDone();
        }}
        onNotNow={onDone}
        onBack={() => setStep('nudge')}
      />
    );
  }

  return (
    <ReattachedNudgeScreen
      circleName={plan.circleName}
      name={name.data ?? undefined}
      onNext={() => {
        nudge.tap();
        setStep('email');
      }}
      onNotNow={carryOn}
      onCarryOn={carryOn}
      onBack={carryOn}
    />
  );
}
