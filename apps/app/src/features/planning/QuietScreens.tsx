import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { t } from '../../copy';
import { useSession } from '../../data/auth';
import type { QuietPlan } from '../../data/planning';
import { useOrganiserGate } from '../growth/InitiateGateFlow';
import { InterestPromptScreen } from './InterestPromptScreen';
import { forgetAsked, quietWhen, rememberAsked, type QuietScreen } from './quiet';
import { SparkExpiredScreen } from './SparkExpiredScreen';
import { SparkOpenedMemberScreen } from './SparkOpenedMemberScreen';
import { SparkWaitingScreen } from './SparkWaitingScreen';
import { PlanStateScreen } from './states';
import { ThresholdRoleScreen } from './ThresholdRoleScreen';
import { useQuietActions } from './useQuietActions';
import { VolunteerScreen } from './VolunteerScreen';
import { whenWords } from './when';
import { WithdrawAskSheet } from './WithdrawAskSheet';

/**
 * One quiet-ask screen, from `quietScreenOf`'s answer, and what its buttons do
 * (spec §5.4). `QuietPlanFlow` reads the ask; this draws it.
 */
export function QuietScreens({
  plan,
  screen,
  circleName,
  members,
  reread,
  onBack,
  toCircle,
}: {
  plan: QuietPlan;
  screen: QuietScreen;
  circleName: string | undefined;
  members: readonly { name: string }[];
  reread: () => Promise<unknown>;
  onBack: () => void;
  toCircle: () => void;
}) {
  const router = useRouter();
  const me = useSession().userId;
  const organiser = useOrganiserGate({ circleId: plan.circleId, circleName });
  const actions = useQuietActions({
    planId: plan.id,
    circleId: plan.circleId,
    circleName,
    onChanged: reread,
  });
  const [changing, setChanging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const params = { id: plan.circleId, planId: plan.id };

  // The initiator's own screen says so; this device remembers it, in memory,
  // so the ask opening in front of them offers them the initiator's choice.
  useEffect(() => {
    if (screen.kind === 'waiting') rememberAsked(plan.id, me);
  }, [screen.kind, plan.id, me]);

  // Somebody organises it and it is this reader: the organiser's own screens,
  // once. A named plan behind this URL is simply a plan.
  const sent = useRef(false);
  const away = screen.kind === 'organising' || screen.kind === 'not_quiet';
  useEffect(() => {
    if (!away || sent.current) return;
    sent.current = true;
    router.replace({
      pathname: '/circles/[id]/plan/[planId]/candidates',
      params: { id: plan.circleId, planId: plan.id },
    });
  }, [away, router, plan.circleId, plan.id]);

  if (organiser.gate !== null) return organiser.gate;

  const circle = circleName ?? t('quiet', 'this_circle');
  const backTo = t('quiet', 'back_to', { circle });
  const when = quietWhen(plan.preset);
  const total = members.length;
  const toTimes = () => router.push({ pathname: '/j/[code]', params: { code: plan.code } });
  // "I'll organise" / "I'll pick the time": a saved place first (ADR 0004),
  // and the same tap once it is saved. Then the ask-for-times message.
  const take = () =>
    organiser.require(() => {
      void actions.accept().then((done) => {
        if (done) router.replace({ pathname: '/circles/[id]/plan/[planId]/shared', params });
      });
    });

  switch (screen.kind) {
    case 'organising':
    case 'not_quiet':
      return <PlanStateScreen state="loading" onBack={onBack} />;

    case 'waiting':
      return (
        <SparkWaitingScreen
          circleName={circle}
          headline={t('sparkWaiting', 'checking', { when })}
          closes={whenWords(screen.closesAt, plan.zone)}
          opensWhen={t('sparkWaiting', 'threshold_of', { threshold: screen.threshold, total })}
          backLabel={backTo}
          onBack={onBack}
          onBackToSundayCrew={toCircle}
          onWithdrawTheAsk={() => setConfirming(true)}
          sheet={
            <WithdrawAskSheet
              visible={confirming}
              busy={actions.busy}
              problem={actions.problem}
              onDismiss={() => setConfirming(false)}
              onWithdraw={() =>
                void actions.withdraw().then((done) => {
                  if (!done) return;
                  setConfirming(false);
                  toCircle();
                })
              }
            />
          }
        />
      );

    case 'prompt': {
      const send = (interested: boolean) =>
        void actions.answer(interested).then((done) => {
          if (done) setChanging(false);
        });
      return (
        <InterestPromptScreen
          circleName={circle}
          question={t('interestPrompt', 'someone_in', { circle, when })}
          members={members}
          closes={t('interestPrompt', 'closes_if_quiet', {
            when: whenWords(screen.closesAt, plan.zone),
          })}
          answered={screen.answered && !changing}
          busy={actions.busy}
          problem={actions.problem}
          onNext={() => send(true)}
          onNotThisTime={() => send(false)}
          onChangeMyAnswer={() => {
            actions.clear();
            setChanging(true);
          }}
          onBack={onBack}
        />
      );
    }

    case 'threshold':
      return (
        <ThresholdRoleScreen
          circleName={circle}
          body={
            screen.keenCount === null
              ? t('thresholdRole', 'keen_body_uncounted', { when })
              : t('thresholdRole', 'keen_body', { count: screen.keenCount, when })
          }
          busy={actions.busy}
          problem={actions.problem}
          onIllOrganise={take}
          onAskForAVolunteer={() => {
            forgetAsked(plan.id);
            toCircle();
          }}
          onBack={onBack}
        />
      );

    case 'volunteer':
      return (
        <VolunteerScreen
          circleName={circle}
          headline={
            screen.keenCount === null
              ? t('volunteer', 'keen_headline_uncounted', { when })
              : t('volunteer', 'keen_headline', { count: screen.keenCount, when })
          }
          keenLine={
            screen.keenCount === null
              ? ''
              : t('volunteer', 'keen_line', { count: screen.keenCount, total })
          }
          busy={actions.busy}
          problem={actions.problem}
          onNext={take}
          onSendMyTimes={toTimes}
          onNotThisOne={toCircle}
          onBack={onBack}
        />
      );

    case 'opened': {
      const deadline = whenWords(plan.responseDeadline, plan.zone);
      return (
        <SparkOpenedMemberScreen
          label={t('sparkOpenedMember', 'label', { circle })}
          headline={t('sparkOpenedMember', 'headline', { when })}
          body={
            screen.organiser === null
              ? t('sparkOpenedMember', 'nobody_yet')
              : t('sparkOpenedMember', 'picking', { name: screen.organiser })
          }
          keenLine={
            screen.keenCount === null
              ? t('sparkOpenedMember', 'replies_close', { deadline })
              : t('sparkOpenedMember', 'keen_line', { count: screen.keenCount, total, deadline })
          }
          onNext={toTimes}
          onNotThisOne={toCircle}
          onBack={onBack}
        />
      );
    }

    case 'closed_notice':
      return (
        <SparkExpiredScreen
          circleName={circle}
          backLabel={backTo}
          onTryAgainAnotherTime={() =>
            router.replace({ pathname: '/circles/[id]/quiet/new', params: { id: plan.circleId } })
          }
          onBackToSundayCrew={toCircle}
          onBack={onBack}
        />
      );

    case 'closed':
      // Withdrawn, expired, or opened and since cancelled: to anybody but the
      // initiator of an ask that ran out of time, these are one screen.
      return (
        <PlanStateScreen
          state="expired"
          title={t('quiet', 'closed_title')}
          action={backTo}
          onAction={toCircle}
          onBack={onBack}
        />
      );
  }
}
