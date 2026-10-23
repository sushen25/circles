import type { CircleId, PlanId } from '@circles/contracts';
import {
  EN_PREVIEW_TEMPLATES,
  EN_SHARE_TEMPLATES,
  FORTNIGHT_DAYS,
  isWeekend,
  localDate,
  newPlanMessage,
  ogDescription,
  ogTitle,
  windowDays,
  withoutLink,
} from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { appOrigin } from '../../data/links/origin';
import { planDetails, planLink, planToShare, type PlanToShare } from '../../data/planning';
import { copyText, shareMessage } from '../../platform/share';
import { isOffline } from '../identity/join/failure';
import { SourceCard } from '../identity/SourceCard';
import { FirstShareScreen } from './FirstShareScreen';
import { justReopened } from './messages';
import { PlanSharedScreen } from './PlanSharedScreen';
import { whenWords } from './when';

/**
 * `/circles/:id/plan/:planId/shared` — paste to chat (spec §5.1 step 8).
 *
 * The message is `newPlanMessage` with the plan's short link, which carries no
 * secret (ADR 0022). Share opens the system sheet where there is one and copies
 * where there is not. **Then the organiser answers their own plan** (ADR 0026):
 * the way on is the availability editor for the plan just made, so the first
 * session ends with the question asked and one answer in it.
 *
 * The card under the message is the link preview's own two lines (S1-21), so
 * what the screen shows and what the chat draws cannot drift.
 *
 * `plan_shared` is recorded when the message leaves — by the sheet or by a
 * copy — with the plan's id and never its code.
 */
export type FirstRun = {
  /** The organiser's own times are in the plan, or they chose to add them later. */
  answer: 'answered' | 'later';
  /** The arrival was on a tagged link, which answers the source question (SUS-240). */
  tagged: boolean;
};

export function PlanSharedFlow({
  id,
  planId,
  again = false,
  first,
}: {
  id: string;
  planId: string;
  /** After an edit that asks everyone again, or "Change the time" (S1-26). */
  again?: boolean | undefined;
  /** Arrived from the first run: the redesigned share (SUS-247, ADR 0090). */
  first?: FirstRun | undefined;
}) {
  return hasBackend() ? (
    <LivePlanShared id={id} planId={planId} again={again} first={first} />
  ) : (
    <FixturePlanShared first={first !== undefined} />
  );
}

function FixturePlanShared({ first }: { first: boolean }) {
  const router = useRouter();
  if (first) {
    return (
      <FirstShareScreen
        message={t('planShared', 'first_run_message_example')}
        onHome={() => router.push('/circles/sunday-crew')}
        onBack={() => router.back()}
      />
    );
  }
  return (
    <PlanSharedScreen
      // The editor, as the live flow's is: on fixtures this screen's action
      // used to be "Done" and went to the candidates (review round 2).
      onNext={() => router.push('/j/pnsundaycr')}
      onBack={() => router.back()}
    />
  );
}

/**
 * "in the next two weeks" for a fortnight and "this weekend" for a weekend;
 * nothing for any other window, the month included: the message says "catch
 * up" and the link says when (ADR 0090, rule 10).
 */
function windowPhrase(plan: PlanToShare): string | undefined {
  // A fortnight with gaps in it is not "the next two weeks" (ADR 0047).
  if (plan.days !== undefined) return undefined;
  const start = localDate(plan.windowStart);
  const end = localDate(plan.windowEnd);
  const days = windowDays({ start, end });
  if (days === FORTNIGHT_DAYS) return t('planShared', 'in_the_next_two_weeks');
  if (days <= 2 && isWeekend(start) && isWeekend(end)) return t('planShared', 'this_weekend');
  return undefined;
}

function LivePlanShared({
  id,
  planId,
  again,
  first,
}: {
  id: string;
  planId: string;
  again: boolean;
  first: FirstRun | undefined;
}) {
  const router = useRouter();
  const session = useSession();
  const [outcome, setOutcome] = useState<'copied' | 'couldnt_copy' | undefined>();
  // The share sheet has closed: the first run's share turns into "Over to {group}."
  const [done, setDone] = useState(false);

  const plan = useQuery({
    queryKey: ['plan-to-share', planId, session.userId],
    queryFn: () => planToShare(planId),
    staleTime: again ? 0 : 60_000,
  });
  // Asking again says why: the day a reopen took off the table, if it was one.
  const details = useQuery({
    queryKey: ['plan-details', planId, session.userId],
    queryFn: () => planDetails({ planId }),
    enabled: again,
    staleTime: 0,
  });

  // Back to the circle's home the person planned from, rather than a second
  // copy of it on top of the stack; a fresh one if they arrived some other way.
  const home = () => router.dismissTo({ pathname: '/circles/[id]', params: { id } });
  const back = () => (router.canGoBack() ? router.back() : home());

  // Asking again is about the plan as the change left it, so both reads have
  // to have come back since this screen opened: a cached one is the plan
  // before the edit, with the old dates and deadline in it.
  const failed = plan.isError || (again && details.isError);
  const waiting = again
    ? !plan.isFetchedAfterMount || !details.isFetchedAfterMount
    : plan.isPending;
  if (failed || plan.data === null || (again && details.data === null)) {
    return (
      <PlanSharedScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => {
          void plan.refetch();
          if (again) void details.refetch();
        }}
        onBack={back}
      />
    );
  }
  if (waiting || plan.data === undefined) {
    return <PlanSharedScreen state="loading" onBack={back} />;
  }

  const data = plan.data;
  const link = planLink(appOrigin(), data.code);
  const offDay = again && details.data != null ? justReopened(details.data) : undefined;
  // Asking again is an update, not a new plan (spec §5.8's "changed"): the
  // question and its answers were replaced, and the chat should hear so.
  const message = again
    ? EN_SHARE_TEMPLATES.changed({ weekday: offDay, url: link })
    : newPlanMessage({
        circleName: data.circleName,
        windowPhrase: windowPhrase(data),
        url: link,
        templates: EN_SHARE_TEMPLATES,
      });
  const kind = again ? 'changed' : 'plan';
  const ids = { circle_id: data.circleId as CircleId, plan_id: data.id as PlanId };

  if (first !== undefined && !again) {
    const copy = () => {
      setOutcome(undefined);
      void copyText(message).then((copied) => {
        if (copied) track('plan_shared', ids);
        setOutcome(copied ? 'copied' : 'couldnt_copy');
      });
    };
    return (
      <FirstShareScreen
        circleName={data.circleName}
        message={message}
        link={link}
        closes={t('planShared', 'closes_first_run', {
          deadline: whenWords(data.responseDeadline, data.zone),
        })}
        done={done}
        outcome={outcome}
        addMine={first.answer === 'later'}
        source={<SourceCard tagged={first.tagged} enabled={done} />}
        onCopy={copy}
        onShare={() => {
          setOutcome(undefined);
          void shareMessage(message).then((result) => {
            if (result === 'failed') {
              setOutcome('couldnt_copy');
              return;
            }
            if (result === 'sheet' || result === 'dismissed') {
              track('share_opened', { ...ids, kind });
            }
            if (result === 'sheet' || result === 'copied') track('plan_shared', ids);
            if (result === 'copied') setOutcome('copied');
            // The sheet has closed, whichever way: the message is out, or the
            // organiser has let it go, and either way there is nothing left to
            // do here but go on.
            setDone(true);
          });
        }}
        onAddMine={() => router.push({ pathname: '/j/[code]', params: { code: data.code } })}
        onShareAgain={() => {
          setOutcome(undefined);
          setDone(false);
        }}
        onHome={() => router.replace({ pathname: '/circles/[id]', params: { id } })}
      />
    );
  }

  return (
    <PlanSharedScreen
      circleName={data.circleName}
      // Shown without its link, because the card under it is the link: a chat
      // draws exactly that card from the URL in the message it is sent.
      message={withoutLink(message, link)}
      link={link}
      linkTitle={ogTitle(data.circleName, EN_PREVIEW_TEMPLATES)}
      linkSubtitle={ogDescription(EN_PREVIEW_TEMPLATES)}
      closes={t('planShared', 'replies_close', {
        deadline: whenWords(data.responseDeadline, data.zone),
      })}
      outcome={outcome}
      again={
        again
          ? {
              title: t('planShared', 'ask_again_title', { circle: data.circleName }),
              intro:
                offDay === undefined
                  ? t('planShared', 'ask_again_edited')
                  : t('planShared', 'ask_again_changed', { day: offDay }),
            }
          : undefined
      }
      onCopy={() => {
        setOutcome(undefined);
        void copyText(message).then((copied) => {
          if (copied) track('plan_shared', ids);
          setOutcome(copied ? 'copied' : 'couldnt_copy');
        });
      }}
      onShare={() => {
        setOutcome(undefined);
        void shareMessage(message).then((result) => {
          if (result === 'sheet' || result === 'dismissed') {
            track('share_opened', { ...ids, kind });
          }
          if (result === 'sheet' || result === 'copied') track('plan_shared', ids);
          if (result === 'copied') setOutcome('copied');
          if (result === 'failed') setOutcome('couldnt_copy');
        });
      }}
      // The organiser's own times, for the plan they just made. `push`, not
      // `replace`: Back from the editor is this screen, which still has the
      // link in it.
      onNext={() => router.push({ pathname: '/j/[code]', params: { code: data.code } })}
      onBack={back}
    />
  );
}
