import type { ShortCode } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { hasBackend } from '../../data/auth/client';
import { useSession } from '../../data/auth/session';
import { planToAnswer, type AnswerablePlan } from '../../data/availability';
import { requestEmailUpdates, typedAddress } from '../../data/email';
import { answerable } from '../../data/fixtures';
import { newIdempotencyKey } from '../../data/functions';
import { failureOf } from '../identity/join/failure';
import { CheckEmailScreen, type CheckEmailProblem } from './CheckEmailScreen';

/**
 * `/j/:code/check-email` (S1-30). Resend is a new request with a **new key**:
 * the old one would replay the first answer and queue nothing. Three a day per
 * address is the server's limit, and `too_many_requests` is the only thing it
 * will say about it.
 */
export function CheckEmailFlow({ code }: { code: string }) {
  if (!hasBackend()) {
    return <CheckEmail code={code} userId={undefined} plan={answerable.plan} live={false} />;
  }
  return <LiveCheckEmail code={code} />;
}

function LiveCheckEmail({ code }: { code: string }) {
  const session = useSession();
  const question = useQuery({
    queryKey: ['plan-to-answer', code, session.userId],
    queryFn: () => planToAnswer(code as ShortCode),
    enabled: session.userId !== undefined,
    staleTime: 30_000,
  });
  return <CheckEmail code={code} userId={session.userId} plan={question.data?.plan} live />;
}

function CheckEmail({
  code,
  userId,
  plan,
  live,
}: {
  code: string;
  userId: string | undefined;
  plan: AnswerablePlan | undefined;
  live: boolean;
}) {
  const router = useRouter();
  const address = plan === undefined ? undefined : typedAddress(userId ?? '', plan.id);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [problem, setProblem] = useState<CheckEmailProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();

  const resend = async () => {
    if (plan === undefined || address === undefined) return;
    if (!live) {
      setResent(true);
      return;
    }
    setResending(true);
    setProblem(undefined);
    setReference(undefined);
    try {
      await requestEmailUpdates({
        planId: plan.id,
        email: address,
        idempotencyKey: newIdempotencyKey(),
      });
      setResent(true);
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === 'offline') setProblem('offline');
      else if (failure.kind === 'reason' && failure.reason === 'too_many_requests') {
        setProblem('too_many_tries');
      } else {
        setProblem('couldnt_send');
        setReference(failure.reference);
      }
    } finally {
      setResending(false);
    }
  };

  const toPlan = () => router.replace({ pathname: '/p/[code]', params: { code } });

  return (
    <CheckEmailScreen
      circleName={plan?.circleName}
      address={address}
      resent={resent}
      resending={resending}
      problem={problem}
      reference={reference}
      onUseDifferentAddress={() =>
        router.canGoBack()
          ? router.back()
          : router.replace({ pathname: '/j/[code]/sent', params: { code } })
      }
      onResend={() => void resend()}
      onBackToCircle={toPlan}
      onBack={() => (router.canGoBack() ? router.back() : toPlan())}
    />
  );
}
