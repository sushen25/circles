import type { CircleId, PlanId } from '@circles/contracts';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { track } from '../../analytics/track';
import { hasBackend } from '../../data/auth/client';
import { isLockedIn } from '../../data/scheduling';
import { isOffline } from '../identity/join/failure';
import { MemberView } from './MemberView';
import { CandidatesMemberScreen } from './CandidatesMemberScreen';
import * as fixture from './fixtures';
import { useCandidates } from './useCandidates';
import { headerOf } from './view';

/**
 * `/p/:code` — the plan page, for a member (spec §5.6).
 *
 * `PlanLinkFlow` has already sent anybody who still owes an answer to the
 * editor, so whoever reaches this has answered, or the plan has stopped
 * asking. They see the options if there are any and a waiting line if there
 * are not; the one thing they can still do is change their own times.
 *
 * **The organiser is sent to their own screen.** The same plan, but with a
 * decision on it — and one organiser surface rather than two that have to be
 * kept in step.
 */
export function MemberCandidatesFlow({ code }: { code: string }) {
  return hasBackend() ? <LiveMember code={code} /> : <FixtureMember />;
}

function FixtureMember() {
  const router = useRouter();
  const data = fixture.readyAsMember;
  return (
    <MemberView
      data={data}
      header={headerOf(data)}
      onChangeMyTimes={() => router.push('/j/pnsundaycr')}
      onBack={() => router.back()}
    />
  );
}

function LiveMember({ code }: { code: string }) {
  const router = useRouter();
  const query = useCandidates({ code });
  const data = query.data ?? undefined;

  // Once, and guarded by a ref rather than by the effect's dependencies:
  // `useRouter` hands back a new object on some renders, and a `replace` in an
  // effect that re-runs on that is a navigation loop.
  const sent = useRef(false);
  const circleId = data?.isOrganiser === true ? data.circleId : undefined;
  const planId = data?.isOrganiser === true ? data.planId : undefined;
  useEffect(() => {
    if (circleId === undefined || planId === undefined || sent.current) return;
    sent.current = true;
    router.replace({
      pathname: '/circles/[id]/plan/[planId]/candidates',
      params: { id: circleId, planId },
    });
  }, [circleId, planId, router]);

  // Locked in: the confirmed screen, with their own answer on it (S1-28).
  const locked = data !== undefined && !data.isOrganiser && isLockedIn(data.state);
  const fresh = query.isFetchedAfterMount && !query.isError;
  const focused = useIsFocused();
  const confirmed = useRef(false);
  useEffect(() => {
    // On a read made since mount, and while on top, as `CandidatesFlow` explains.
    if (!locked || !fresh || !focused || confirmed.current) return;
    confirmed.current = true;
    router.replace({ pathname: '/p/[code]/confirmed', params: { code } });
  }, [locked, fresh, focused, code, router]);

  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (data === undefined || data.view !== 'ready' || data.isOrganiser) return;
    if (seen.current === data.planId) return;
    seen.current = data.planId;
    track('candidate_viewed', {
      circle_id: data.circleId as CircleId,
      plan_id: data.planId as PlanId,
      role: 'member',
    });
  }, [data]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (query.isPending) return <CandidatesMemberScreen state="loading" onBack={back} />;
  if (query.isError) {
    return (
      <CandidatesMemberScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void query.refetch()}
        onBack={back}
      />
    );
  }
  if (data === undefined) return <CandidatesMemberScreen state="denied" onBack={back} />;
  // On its way to the organiser's screen, or to the confirmed one; nothing of
  // theirs belongs here.
  if (data.isOrganiser || locked) return <CandidatesMemberScreen state="loading" onBack={back} />;

  if (data.view === 'closed') {
    return <CandidatesMemberScreen state="expired" header={headerOf(data)} onBack={back} />;
  }

  return (
    <MemberView
      data={data}
      header={headerOf(data)}
      onChangeMyTimes={
        data.repliesOpen
          ? () => router.push({ pathname: '/j/[code]', params: { code } })
          : undefined
      }
      // The owner may cancel any plan in the circle (spec §4.5); the organiser
      // does it from their own screens, where this page sends them.
      onCancelPlan={
        data.isOwner
          ? () =>
              router.push({
                pathname: '/circles/[id]/plan/[planId]/cancel',
                params: { id: data.circleId, planId: data.planId },
              })
          : undefined
      }
      onRetry={() => void query.refetch()}
      onBack={back}
    />
  );
}
