import type { CircleId, PlanId } from '@circles/contracts';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import type { PlanDetails } from '../../data/planning';
import { shareMessage } from '../../platform/share';
import { isOffline } from '../identity/join/failure';
import { CancelledOrgScreen } from './CancelledOrgScreen';
import * as fixture from './fixtures';
import { cancelledDay, cancelledUpdate } from './messages';
import { usePlanDetails } from './usePlanDetails';
import { useOrigin } from './useOrigin';

/**
 * `/circles/:id/plan/:planId/cancelled` — the plan is off, for whoever called
 * it off (spec §5.7). Somebody else in the circle is sent to the member's
 * screen, which has the note and no message to paste: the update is the
 * organiser's to send.
 */
export function CancelledFlow({ id, planId }: { id: string; planId: string }) {
  const router = useRouter();
  const query = usePlanDetails({ planId });
  const plan = query.data ?? undefined;

  const toCircle = () => router.dismissTo({ pathname: '/circles/[id]', params: { id } });

  // Not the organiser or the owner: the member's screen, once, on a fresh read.
  const member =
    plan !== undefined && plan.state === 'cancelled' && !plan.isOrganiser && !plan.isOwner;
  const fresh = query.isFetchedAfterMount && !query.isError;
  const focused = useIsFocused();
  const sent = useRef(false);
  useEffect(() => {
    if (!member || !fresh || !focused || sent.current || plan === undefined) return;
    sent.current = true;
    router.replace({ pathname: '/p/[code]/cancelled', params: { code: plan.code } });
  }, [member, fresh, focused, plan, router]);

  if (!hasBackend()) return <Cancelled plan={fixture.cancelled} onBack={() => router.back()} />;
  if (query.isPending || member) return <CancelledOrgScreen state="loading" onBack={toCircle} />;
  // Only when there is nothing to show. A background refetch that fails
  // keeps the plan it had, and swapping a half-edited form for an error
  // screen would throw the organiser's changes away.
  if (query.isError && query.data === undefined) {
    return (
      <CancelledOrgScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void query.refetch()}
        onBack={toCircle}
      />
    );
  }
  if (plan === undefined || plan.state !== 'cancelled') {
    return <CancelledOrgScreen state="denied" onBack={toCircle} />;
  }
  return <Cancelled plan={plan} onBack={toCircle} />;
}

function Cancelled({ plan, onBack }: { plan: PlanDetails; onBack: () => void }) {
  const router = useRouter();
  const origin = useOrigin();
  const [notice, setNotice] = useState<string>();
  const message = origin === undefined ? undefined : cancelledUpdate(plan, origin);
  const ids = { circle_id: plan.circleId as CircleId, plan_id: plan.planId as PlanId };

  return (
    <CancelledOrgScreen
      circleName={plan.circleName}
      day={cancelledDay(plan)}
      message={message}
      shareNotice={notice}
      onNext={() => {
        if (message === undefined) return;
        setNotice(undefined);
        void shareMessage(message).then((result) => {
          // The sheet opened, not that a message was sent (§5.8).
          if (result === 'sheet' || result === 'dismissed' || result === 'copied') {
            track('share_opened', { ...ids, kind: 'cancelled' });
          }
          if (result === 'copied') setNotice(t('cancelledOrg', 'copied'));
          if (result === 'failed') setNotice(t('cancelledOrg', 'couldnt_copy'));
        });
      }}
      onPlanAnother={() =>
        router.replace({ pathname: '/circles/[id]/plan/setup', params: { id: plan.circleId } })
      }
      onBack={onBack}
    />
  );
}
