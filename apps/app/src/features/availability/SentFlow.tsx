import type { ShortCode } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';

import { track } from '../../analytics/track';
import { hasBackend } from '../../data/auth/client';
import { useSession } from '../../data/auth/session';
import { planToAnswer } from '../../data/availability';
import { requestEmailUpdates } from '../../data/email';
import { answerable } from '../../data/fixtures';
import { newIdempotencyKey } from '../../data/functions';
import { ownNameIn } from '../../data/membership';
import { useNudge } from '../growth/useNudge';
import { EnterCodeScreen } from '../identity/EnterCodeScreen';
import { isOffline } from '../identity/join/failure';
import { SavePlaceByEmail } from '../identity/SavePlaceByEmail';
import { useOneStep, type OneStepStage } from './oneStep';
import { SentScreen } from './SentScreen';
import { Sent } from './SentView';

/**
 * `/j/:code/sent` — after an answer (spec §5.1, §5.8, S1-30).
 *
 * One step, one card (SUS-162): an address, and a switch that keeps the
 * person's place. **On**, a code is emailed, and the right code saves the place
 * (`SavePlaceByEmail`, `savePlace`, `claim-identity`) and then turns on this
 * plan's updates for that address with `request-email-updates`. A confirmed
 * sign-in address is proof on the server, so no verification link is sent and
 * one email arrives: the code. **Off**, today's path: the verification link and
 * Check your email, no account.
 *
 * The step is held in memory outside the components (`oneStep.ts`), because
 * signing in can change the person's user id, which reloads the plan and makes
 * the membership gate above the route replace this component.
 *
 * **Not now asks for nothing** — no contact, no consent, no email — and the
 * card goes; `record-nudge` hears that it was turned down, which is how the
 * card is offered at most once per plan on every device (spec §5.11, S2-07).
 * A new idempotency key per tap: the same key would replay the first answer
 * and queue nothing.
 */
export function SentFlow({ code }: { code: string }) {
  return hasBackend() ? <LiveSent code={code} /> : <FixtureSent code={code} />;
}

/**
 * The gallery: `?state=code|done|partial|member|joined|suppressed|suppressed_saved`
 * opens the card's other states (`member` is the signed-in one-button card).
 */
function fixtureStage(state: string | undefined): OneStepStage {
  const address = 'nina@example.com';
  switch (state) {
    case 'code':
      return {
        kind: 'code',
        start: { address, route: 'new_identity', sentAt: 0 },
        planId: answerable.plan.id,
      };
    case 'done':
      return { kind: 'done', address };
    case 'partial':
      return { kind: 'partial', address };
    case 'joined':
      return { kind: 'joined', address };
    case 'suppressed':
      return { kind: 'suppressed', address, saved: false };
    case 'suppressed_saved':
      return { kind: 'suppressed', address, saved: true };
    default:
      return { kind: 'card' };
  }
}

function FixtureSent({ code }: { code: string }) {
  const { state } = useLocalSearchParams<{ state?: string }>();
  const one = useOneStep(`fixture:${code}:${state ?? ''}`, fixtureStage(state));
  if (one.stage.kind === 'code') {
    const { address } = one.stage.start;
    return (
      <EnterCodeScreen
        address={address}
        code="47"
        onContinue={() => one.toDone(address)}
        onBack={one.toCard}
      />
    );
  }
  return (
    <Sent
      code={code}
      userId={undefined}
      plan={answerable.plan}
      answer={answerable.answer}
      name="Nina"
      live={false}
      one={one}
      canSave={state !== 'member' && state !== 'joined' && state !== 'suppressed'}
      confirmedEmail={
        state === 'member' || state === 'joined' || state === 'suppressed'
          ? 'nina@example.com'
          : undefined
      }
    />
  );
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

  const one = useOneStep(code);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (one.stage.kind === 'code') {
    const { start, planId } = one.stage;
    return (
      <SavePlaceByEmail
        key={start.sentAt}
        moment="after_answer"
        circleName={plan?.circleName}
        start={start}
        onSaved={async (address) => {
          track('account_claimed', { moment: 'after_answer' });
          // Somebody signed out while this was going (another tab, say): whoever
          // is signed in now did not ask for these emails.
          if (!one.stillMine()) return;
          // Or they backed out of the code step while it was being checked: the
          // place is saved, but they did not go on to ask for the emails.
          if (!one.stillCoding(start.sentAt)) return;
          // The place is saved; now this plan's updates, for the address that
          // just proved itself. A new key: this is a new request.
          try {
            const answer = await requestEmailUpdates({
              planId,
              email: address,
              idempotencyKey: newIdempotencyKey(),
            });
            // Backed out while the request was out, and maybe started another:
            // this one does not overwrite what is on screen now.
            if (!one.stillCoding(start.sentAt)) return;
            offer.tap();
            // The address just proved itself, so the server may say the truth
            // about it (SUS-164): a suppressed one is never promised email.
            if (answer.delivery === 'suppressed') one.toSuppressed(address, true);
            else one.toDone(address);
          } catch {
            if (!one.stillCoding(start.sentAt)) return;
            one.toPartial(address);
          }
        }}
        onNotNow={one.toCard}
        onBack={one.toCard}
      />
    );
  }

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
      canSave={session.status === 'guest'}
      confirmedEmail={session.confirmedEmail}
      offer={offer}
      one={one}
    />
  );
}
