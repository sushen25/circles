import type { CircleId, PlanId } from '@circles/contracts';
import {
  EN_PREVIEW_TEMPLATES,
  EN_SHARE_TEMPLATES,
  MAX_WINDOW_DAYS,
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
import { planLink, planToShare, type PlanToShare } from '../../data/planning';
import { copyText, shareMessage } from '../../platform/share';
import { isOffline } from '../identity/join/failure';
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
export function PlanSharedFlow({ id, planId }: { id: string; planId: string }) {
  return hasBackend() ? <LivePlanShared id={id} planId={planId} /> : <FixturePlanShared />;
}

function FixturePlanShared() {
  const router = useRouter();
  return (
    <PlanSharedScreen
      // The editor, as the live flow's is: on fixtures this screen's action
      // used to be "Done" and went to the candidates (review round 2).
      onNext={() => router.push('/j/pnsundaycr')}
      onBack={() => router.back()}
    />
  );
}

/** "in the next two weeks" for the first-run fortnight; nothing for any other window. */
function windowPhrase(plan: PlanToShare): string | undefined {
  const days = windowDays({ start: localDate(plan.windowStart), end: localDate(plan.windowEnd) });
  return days === MAX_WINDOW_DAYS ? t('planShared', 'in_the_next_two_weeks') : undefined;
}

function LivePlanShared({ id, planId }: { id: string; planId: string }) {
  const router = useRouter();
  const session = useSession();
  const [outcome, setOutcome] = useState<'copied' | 'couldnt_copy' | undefined>();
  // Whether the chat has it. Until then the way on is a quiet tertiary; after
  // it, the screen's job is done and it becomes a button.
  const [shared, setShared] = useState(false);

  const plan = useQuery({
    queryKey: ['plan-to-share', planId, session.userId],
    queryFn: () => planToShare(planId),
    staleTime: 60_000,
  });

  // Back to the circle's home the person planned from, rather than a second
  // copy of it on top of the stack; a fresh one if they arrived some other way.
  const home = () => router.dismissTo({ pathname: '/circles/[id]', params: { id } });
  const back = () => (router.canGoBack() ? router.back() : home());

  if (plan.isPending) return <PlanSharedScreen state="loading" onBack={back} />;
  if (plan.isError || plan.data === null) {
    return (
      <PlanSharedScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void plan.refetch()}
        onBack={back}
      />
    );
  }

  const data = plan.data;
  const link = planLink(appOrigin(), data.code);
  const message = newPlanMessage({
    circleName: data.circleName,
    windowPhrase: windowPhrase(data),
    url: link,
    templates: EN_SHARE_TEMPLATES,
  });
  const ids = { circle_id: data.circleId as CircleId, plan_id: data.id as PlanId };

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
      shared={shared}
      outcome={outcome}
      onCopy={() => {
        setOutcome(undefined);
        void copyText(message).then((copied) => {
          if (copied) {
            track('plan_shared', ids);
            setShared(true);
          }
          setOutcome(copied ? 'copied' : 'couldnt_copy');
        });
      }}
      onShare={() => {
        setOutcome(undefined);
        void shareMessage(message).then((result) => {
          if (result === 'sheet' || result === 'dismissed') {
            track('share_opened', { ...ids, kind: 'plan' });
          }
          if (result === 'sheet' || result === 'copied') {
            track('plan_shared', ids);
            setShared(true);
          }
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
