import type { PlanId, ShortCode } from '@circles/contracts';
import { fromISO, toLocal, toParts, zone as toZone } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import { takeSavedWith } from '../../data/auth/saved';
import { useSession } from '../../data/auth/session';
import { planToAnswer, type AnswerablePlan, type OwnAnswer } from '../../data/availability';
import { normaliseAddress, rememberTypedAddress, requestEmailUpdates } from '../../data/email';
import { answerable } from '../../data/fixtures';
import { newIdempotencyKey } from '../../data/functions';
import { ownNameIn } from '../../data/membership';
import { useNudge, type Nudge } from '../growth/useNudge';
import { failureOf, isOffline } from '../identity/join/failure';
import { SentScreen, type SentProblem } from './SentScreen';

/**
 * `/j/:code/sent` — after an answer (spec §5.1, §5.8, S1-30).
 *
 * The email offer: one address, `request-email-updates`, then Check your email.
 * **Not now asks for nothing** — no contact, no consent, no email — and the
 * card goes; `record-nudge` hears that it was turned down, which is how the
 * card is offered at most once per plan on every device (spec §5.11, S2-07).
 * A new idempotency key per tap: the same key would replay the first answer
 * and queue nothing.
 */
export function SentFlow({ code }: { code: string }) {
  if (!hasBackend()) {
    return (
      <Sent
        code={code}
        userId={undefined}
        plan={answerable.plan}
        answer={answerable.answer}
        name="Priya"
        live={false}
      />
    );
  }
  return <LiveSent code={code} />;
}

function LiveSent({ code }: { code: string }) {
  const router = useRouter();
  const session = useSession();
  const question = useQuery({
    queryKey: ['plan-to-answer', code, session.userId],
    queryFn: () => planToAnswer(code as ShortCode),
    enabled: session.userId !== undefined,
    staleTime: 30_000,
  });
  const circleId = question.data?.plan.circleId;
  const name = useQuery({
    queryKey: ['own-name', circleId, session.userId],
    queryFn: () => ownNameIn(circleId as string),
    enabled: circleId !== undefined,
    staleTime: Infinity,
  });

  const plan = question.data?.plan;
  // The organiser hears about their own plan already — the organiser kinds go
  // to them by email when they have no app (§5.8) — so the card is an offer of
  // what they have. **Everybody else is offered it, account or not**: a
  // per-plan subscription is the only way a web member gets the confirmed
  // time, and a saved place is an account, not a subscription (review round 1).
  const organising =
    plan !== undefined && plan.organiserUserId !== null && plan.organiserUserId === session.userId;
  // Once per plan, on every device (spec §5.11): the record is `record-nudge`'s.
  // Asked only once there is an answer, and shown if the server cannot be
  // asked — the card is how a web member hears the confirmed time, which is
  // the core loop, not a conversion.
  const offer = useNudge('sent_save_access', {
    planId: plan?.id,
    enabled:
      plan !== undefined &&
      !organising &&
      question.data?.answer !== null &&
      question.data?.answer !== undefined,
    failOpen: true,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (question.isError || question.data === null) {
    return (
      <SentScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void question.refetch()}
        onBack={back}
      />
    );
  }
  if (question.data === undefined || name.isPending || offer.showing === 'pending') {
    return <SentScreen state="loading" onBack={back} />;
  }
  if (question.data.answer === null) {
    // No answer to the current question: straight after a send the read may
    // not have caught up, and otherwise the person is here without having
    // answered — from history, or after the organiser changed the plan. Never
    // "your times are in" to somebody whose times are not.
    if (question.isFetching) return <SentScreen state="loading" onBack={back} />;
    return <Redirect href={{ pathname: '/j/[code]', params: { code } }} />;
  }

  return (
    <Sent
      code={code}
      userId={session.userId}
      plan={question.data.plan}
      answer={question.data.answer}
      name={name.data ?? null}
      live
      offerSaveAccess={session.status === 'guest'}
      offer={offer}
    />
  );
}

type SentInnerProps = {
  code: string;
  userId: string | undefined;
  plan: AnswerablePlan;
  answer: OwnAnswer | null;
  name: string | null;
  live: boolean;
  offerSaveAccess?: boolean;
  /** The email card's prompt: whether to show it, and where its answer goes. */
  offer?: Nudge | undefined;
};

function Sent({
  code,
  userId,
  plan,
  answer,
  name,
  live,
  offerSaveAccess = false,
  offer,
}: SentInnerProps) {
  const router = useRouter();
  const organising = plan.organiserUserId !== null && plan.organiserUserId === userId;
  // Without a backend (the gallery), always offered to anybody but the organiser.
  const [offerEmail, setOfferEmail] = useState(
    !organising && (offer === undefined || offer.showing === 'show'),
  );
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<SentProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // Taken when this screen comes back into view, not when it first mounts: on
  // the web stack Sent stays mounted under SaveAccess, and the note is written
  // only once that succeeds.
  const [savedWith, setSavedWith] = useState<string | undefined>();
  useFocusEffect(
    useCallback(() => {
      const address = takeSavedWith(code);
      if (address !== undefined) setSavedWith(address);
    }, [code]),
  );

  // The offer was made: once per visit, and only while it is on screen.
  const offered = useRef(false);
  useEffect(() => {
    if (!offerEmail || offered.current) return;
    offered.current = true;
    track('email_updates_offered', { plan_id: plan.id as PlanId });
  }, [offerEmail, plan.id]);

  const send = async () => {
    const address = normaliseAddress(email);
    if (address === null) {
      setProblem('not_an_address');
      setReference(undefined);
      return;
    }
    if (!live) {
      rememberTypedAddress(userId ?? '', plan.id, address);
      router.push({ pathname: '/j/[code]/check-email', params: { code } });
      return;
    }
    setBusy(true);
    setProblem(undefined);
    setReference(undefined);
    try {
      await requestEmailUpdates({
        planId: plan.id,
        email: address,
        idempotencyKey: newIdempotencyKey(),
      });
      track('email_submitted', { plan_id: plan.id as PlanId });
      offer?.tap();
      rememberTypedAddress(userId ?? '', plan.id, address);
      // The card stays, address and all: "Use a different one" on Check your
      // email comes back here, and there must be somewhere to type it.
      router.push({ pathname: '/j/[code]/check-email', params: { code } });
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
      setBusy(false);
    }
  };

  const gaveTimes = answer === null || answer.status === 'windows' || answer.status === 'flexible';
  const headline =
    name === null
      ? t('sent', gaveTimes ? 'thanks_times_in_anonymous' : 'thanks_answer_in_anonymous')
      : t('sent', gaveTimes ? 'thanks_times_in' : 'thanks_answer_in', { name });
  const day = closingDay(plan);
  const body =
    plan.organiserName === null
      ? t('sent', 'time_gets_picked', { day })
      : t('sent', 'organiser_picks', { name: plan.organiserName, day });

  return (
    <SentScreen
      circleName={plan.circleName}
      headline={headline}
      body={body}
      offerEmail={offerEmail}
      email={email}
      problem={problem}
      reference={reference}
      busy={busy}
      offerSaveAccess={offerSaveAccess}
      savedWith={savedWith}
      onEmailChange={setEmail}
      onSendVerification={() => void send()}
      onNotNow={() => {
        offer?.dismiss();
        setOfferEmail(false);
      }}
      onSaveAccess={() => router.push({ pathname: '/j/[code]/save-access', params: { code } })}
      onChangeAnswer={
        plan.acceptingAnswers
          ? () => router.push({ pathname: '/j/[code]', params: { code } })
          : undefined
      }
      onSeeCircle={
        organising
          ? () => router.dismissTo({ pathname: '/circles/[id]', params: { id: plan.circleId } })
          : undefined
      }
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}

/** "Tuesday": the day replies close, on the plan's own clock, in the device's words. */
function closingDay(plan: AnswerablePlan): string {
  const { date } = toLocal(fromISO(plan.responseDeadline), toZone(plan.zone));
  const { year, month, day } = toParts(date);
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
}
