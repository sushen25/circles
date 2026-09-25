import type { CircleId, PlanId } from '@circles/contracts';
import { EN_SHARE_TEMPLATES } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import type { CircleHome } from '../../data/circles';
import { appOrigin } from '../../data/links/origin';
import { planLink } from '../../data/planning';
import { shareMessage } from '../../platform/share';
import { QuietAskCard } from '../planning/QuietAskCard';
import { whenWords } from '../planning/when';
import { CircleHomeConfirmedScreen } from './CircleHomeConfirmedScreen';
import { CircleHomeDueScreen } from './CircleHomeDueScreen';
import { CircleHomeJoiningScreen } from './CircleHomeJoiningScreen';
import { CircleHomeScreen } from './CircleHomeScreen';
import { EmptyCircleScreen } from './EmptyCircleScreen';
import { aboutTimeBody, homeState, lockedInWords } from './lines';
import { useMorningAfterCard } from './MorningAfterCard';
import { useNudgeActions } from './useNudgeActions';
import {
  cadenceWords,
  homeSubtitle,
  joiningSubtitle,
  justJoined,
  lastCaughtUp,
  nextOne,
} from './words';

/**
 * One circle home, in whichever state the domain says it is in (spec §5.2).
 *
 * What every state shares is worked out once: the header, the members, and the
 * owner's two ways in — the invite link and settings. **The invite link is the
 * owner's alone** (`get-invite-link` refuses anybody else), so a member's home
 * has no link to offer rather than one that fails when tapped.
 */
export function HomeInState({ home, onBack }: { home: CircleHome; onBack: () => void }) {
  const router = useRouter();
  const [shareOutcome, setShareOutcome] = useState<string | undefined>();
  const id = home.id;
  // The morning after's card, when the reader owes an answer (S1-29). Every
  // state of an active circle can hold it: the next plan may already be
  // finding a time, or locked in, before the last one is reported — and
  // everybody else may have left since.
  const morningAfter = useMorningAfterCard(home);
  // A quiet ask still asking, as the same card for every member (S2-03): under
  // the morning after's question, in whichever state the home is in.
  const quietAsks = home.status === 'archived' ? [] : (home.quietAsks ?? []);
  const prompt =
    quietAsks.length === 0 ? (
      morningAfter
    ) : (
      <>
        {morningAfter}
        {quietAsks.map((ask) => (
          <QuietAskCard
            key={ask.planId}
            ask={ask}
            zone={home.zone}
            onOpen={() =>
              router.push({
                pathname: '/circles/[id]/quiet/[planId]',
                params: { id, planId: ask.planId },
              })
            }
          />
        ))}
      </>
    );
  const nudge = useNudgeActions(home);

  const members = home.members.map((m) => ({ name: m.name }));
  const memberCount =
    home.members.length === 1
      ? t('circleHome', 'one_member_count')
      : t('circleHome', 'member_count', { count: home.members.length });
  const invite = home.isOwner
    ? () => router.push({ pathname: '/circles/[id]/invite', params: { id } })
    : undefined;
  const settings = () => router.push({ pathname: '/circles/[id]/settings', params: { id } });
  const planNew = () => router.push({ pathname: '/circles/[id]/plan/new', params: { id } });
  // "Plan another" is the circle's second plan and after: prefilled from the
  // last meetup that happened, or the full setup when there is none (S2-04).
  const planAnother = () => router.push({ pathname: '/circles/[id]/plan/another', params: { id } });
  const shared = {
    circleName: home.name,
    color: home.color,
    members,
    memberCount,
    onInviteLink: invite,
    onSettings: settings,
    onBack,
  };

  const state = homeState(home);

  // Archived: history and the way back, and nothing that asks anybody
  // anything (spec §5.2). Checked before the states, which describe an active
  // circle.
  if (home.status === 'archived') {
    return (
      <CircleHomeDueScreen
        {...shared}
        archived
        due={false}
        subtitle={homeSubtitle(home)}
        lastCaughtUp={lastCaughtUp(home)}
        nextOne={t('circleHome', 'nothing_yet')}
      />
    );
  }

  if (state === 'finding_a_time' && home.activePlan !== null) {
    const plan = home.activePlan;
    // Started quietly and nobody has taken it on: "started quietly", and the
    // quiet screens, which offer the role to whoever may take it (§5.4).
    const unclaimed = plan.quiet === true && plan.organiserUserId === null;
    return (
      <CircleHomeScreen
        {...shared}
        prompt={prompt}
        subtitle={homeSubtitle(home)}
        label={unclaimed ? t('quiet', 'started_quietly') : undefined}
        planTitle={plan.title}
        closes={t('circleHome', 'replies_close', {
          deadline: whenWords(plan.responseDeadline, home.zone),
        })}
        replied={t('circleHome', 'replied', { count: plan.replied, total: plan.asked })}
        lastCaughtUp={lastCaughtUp(home)}
        nextOne={nextOne(home)}
        onSeeHowItsLooking={() =>
          router.push({
            pathname: unclaimed
              ? '/circles/[id]/quiet/[planId]'
              : '/circles/[id]/plan/[planId]/candidates',
            params: { id, planId: plan.id },
          })
        }
        // Two ways to start now that the quiet ask is on (S2-03); with a plan
        // running, either one shows that plan (ADR 0033).
        onNext={() => router.push({ pathname: '/circles/[id]/plan/mode', params: { id } })}
      />
    );
  }

  if (state === 'locked_in' && home.lockedIn !== null) {
    const meetup = home.lockedIn;
    const words = lockedInWords(home);
    const share = () => {
      setShareOutcome(undefined);
      const message = EN_SHARE_TEMPLATES.lockedIn({
        circleName: home.name,
        date: words.date,
        time: words.time,
        place: meetup.placeName ?? undefined,
        url: planLink(appOrigin(), meetup.code),
      });
      void shareMessage(message).then((result) => {
        if (result === 'sheet' || result === 'dismissed') {
          track('share_opened', {
            circle_id: id as CircleId,
            plan_id: meetup.planId as PlanId,
            kind: 'confirmed',
          });
        } else if (result === 'copied') setShareOutcome(t('circleHomeConfirmed', 'copied'));
        else setShareOutcome(t('circleHomeConfirmed', 'couldnt_copy'));
      });
    };
    return (
      <CircleHomeConfirmedScreen
        {...shared}
        prompt={prompt}
        subtitle={homeSubtitle(home)}
        date={words.date}
        detail={words.detail}
        going={words.going}
        lastCaughtUp={lastCaughtUp(home)}
        shareOutcome={shareOutcome}
        onDetails={() =>
          router.push({
            pathname: '/circles/[id]/plan/[planId]/confirmed',
            params: { id, planId: meetup.planId },
          })
        }
        onShare={share}
        onPlanAnother={planAnother}
      />
    );
  }

  if (state === 'just_you') {
    return (
      <EmptyCircleScreen
        prompt={prompt}
        circleName={home.name}
        color={home.color}
        subtitle={t('emptyCircle', 'just_you', { what: cadenceWords(home.cadence) })}
        onSettings={settings}
        onNext={invite ?? settings}
        onPlanACatchUp={planNew}
        onBack={onBack}
      />
    );
  }

  if (state === 'about_time' || (home.lastMetAt !== null && state !== 'never_met')) {
    return (
      <CircleHomeDueScreen
        {...shared}
        prompt={prompt}
        due={state === 'about_time'}
        subtitle={homeSubtitle(home)}
        body={aboutTimeBody(home)}
        lastCaughtUp={lastCaughtUp(home)}
        nextOne={t('circleHome', 'nothing_yet')}
        onSnoozeAMonth={nudge.onSnoozeAMonth}
        onTurnOffNudges={nudge.onTurnOffNudges}
        notice={nudge.notice}
        onNext={planAnother}
      />
    );
  }

  // Never met, with people in it: the home as it fills up (S1-22).
  return (
    <CircleHomeJoiningScreen
      prompt={prompt}
      circleName={home.name}
      color={home.color}
      subtitle={joiningSubtitle(home)}
      members={members}
      joined={justJoined(home.members, home.me)}
      lastCaughtUp={lastCaughtUp(home)}
      nextOne={nextOne(home)}
      firstPlan={home.lastMetAt === null}
      onShareAgain={invite}
      onSettings={settings}
      onNext={planNew}
      onBack={onBack}
    />
  );
}
