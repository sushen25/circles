import type { PlanId } from '@circles/contracts';
import { fromISO, toLocal, toParts, zone as toZone } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import type { AnswerablePlan, OwnAnswer } from '../../data/availability';
import type { Nudge } from '../growth/useNudge';
import type { OneStep, OneStepStage } from './oneStep';
import { SentScreen, type SentOutcome } from './SentScreen';
import { useEmailOffer } from './useEmailOffer';

type SentViewProps = {
  code: string;
  userId: string | undefined;
  plan: AnswerablePlan;
  answer: OwnAnswer | null;
  name: string | null;
  live: boolean;
  /** The "Save my place" switch is for a guest: a saved place has nothing to save. */
  canSave: boolean;
  /**
   * The session's confirmed sign-in address: the card is one button, with no
   * field and no switch (SUS-164).
   */
  confirmedEmail?: string | undefined;
  /** The email card's prompt: whether to show it, and where its answer goes. */
  offer?: Nudge | undefined;
  one: OneStep;
};

export function Sent({
  code,
  userId,
  plan,
  answer,
  name,
  live,
  canSave,
  confirmedEmail,
  offer,
  one,
}: SentViewProps) {
  const router = useRouter();
  const organising = plan.organiserUserId !== null && plan.organiserUserId === userId;
  // Without a backend (the gallery), always offered to anybody but the organiser.
  const { stage } = one;
  // When the emails failed the card is back for the emails alone, whatever the
  // once-per-plan nudge said; "Not now" still takes it away.
  const [dismissed, setDismissed] = useState(
    organising || (stage.kind !== 'partial' && offer !== undefined && offer.showing !== 'show'),
  );
  // After the place is saved and the emails are on, the card is gone.
  const ended = stage.kind === 'done' || stage.kind === 'joined' || stage.kind === 'suppressed';
  const offerEmail = ended ? false : !dismissed;
  const switchShown = canSave && stage.kind === 'card';
  const { problem, reference, busy, send, cancel } = useEmailOffer({
    code,
    plan,
    userId,
    live,
    canSave: switchShown,
    confirmedEmail,
    offer,
    one,
  });

  // The offer was made: once per visit, and only while it is on screen.
  const offered = useRef(false);
  useEffect(() => {
    if (!offerEmail || offered.current) return;
    offered.current = true;
    track('email_updates_offered', { plan_id: plan.id as PlanId });
  }, [offerEmail, plan.id]);

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
      email={one.email}
      problem={problem}
      reference={reference}
      busy={busy}
      savePlace={switchShown ? one.save : undefined}
      confirmedEmail={confirmedEmail}
      outcome={outcomeOf(stage)}
      emailsFailed={stage.kind === 'partial'}
      onEmailChange={one.setEmail}
      onSavePlaceChange={one.setSave}
      onTerms={() => router.push('/terms')}
      onPrivacy={() => router.push('/privacy')}
      onSubmit={() => void send()}
      onNotNow={() => {
        cancel();
        offer?.dismiss();
        setDismissed(true);
      }}
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

/** How the card ended, if it has: the line, and the address it is about. */
function outcomeOf(stage: OneStepStage): SentOutcome | undefined {
  switch (stage.kind) {
    case 'done':
      return { kind: 'saved_and_on', address: stage.address };
    case 'joined':
      return { kind: 'on', address: stage.address };
    case 'suppressed':
      return { kind: stage.saved ? 'cant_saved' : 'cant_member', address: stage.address };
    default:
      return undefined;
  }
}

/** "Tuesday": the day replies close, on the plan's own clock, in the device's words. */
function closingDay(plan: AnswerablePlan): string {
  const { date } = toLocal(fromISO(plan.responseDeadline), toZone(plan.zone));
  const { year, month, day } = toParts(date);
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
}
