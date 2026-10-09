import type { CircleId, PlanId } from '@circles/contracts';
import { instant } from '@circles/domain';
import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import { isLockedIn } from '../../data/scheduling';
import { isOffline } from '../identity/join/failure';
import { clockNow, usePlanClock } from '../planning/clock';
import { CandidatesScreen } from './CandidatesScreen';
import { isDeadlinePassed } from './deadline';
import { DeadlinePassedFlow } from './DeadlinePassedFlow';
import { FixtureCandidates, type CandidatesRoute } from './FixtureCandidates';
import { MemberView } from './MemberView';
import { NoQuorumScreen } from './NoQuorumScreen';
import { reviewLabel, stillToAnswer, waitingWords, widerWarning } from './lines';
import { blockedBy, unlocksOf } from './unlock';
import { useShareReminder } from './shareReminder';
import { useCandidates } from './useCandidates';
import { useDeadlinePassed } from './useDeadlinePassed';
import { useResolution } from './useResolution';
import { cardsOf, headerOf, headlineOf, leadOf, nearMissesOf, nudgeOf } from './view';
import { WaitingScreen } from './WaitingScreen';

/**
 * `/circles/:id/plan/:planId/{candidates,waiting,no-quorum}` — the organiser's
 * view of how a plan is going (spec §5.6).
 *
 * **One flow behind three routes**, because which of them is true is a fact
 * about the data and can change while the screen is open: an answer arriving
 * turns waiting into options, and the quorum can move under both without an
 * edit (ADR 0026). So the route decides nothing — it says which screen to show
 * with no backend, and the read decides the rest. `which` is the fixture
 * answer only.
 *
 * A member who follows this link sees the member screen: everyone in the
 * circle may see the options, and only the organiser may confirm (§5.6).
 */
export function CandidatesFlow({
  id,
  planId,
  which = 'candidates',
}: {
  id: string;
  planId: string;
  which?: CandidatesRoute | undefined;
}) {
  return hasBackend() ? (
    <LiveCandidates id={id} planId={planId} />
  ) : (
    <FixtureCandidates which={which} />
  );
}

function LiveCandidates({ id, planId }: { id: string; planId: string }) {
  const router = useRouter();
  const query = useCandidates({ planId });
  const data = query.data ?? undefined;
  const { share: shareAgain, outcome: shareOutcome } = useShareReminder(data);
  const resolution = useResolution({ planId, circleId: id });
  // One more day, which the no-quorum screen offers once replies have closed
  // (S2-05). The replies-closed screen has its own; this is the same hook.
  const closed = useDeadlinePassed({ planId, circleId: id });
  const [clock] = usePlanClock(clockNow, true);
  const [chosen, setChosen] = useState<string>();

  // Once per plan, when there is something to have seen (spec §11's catalogue).
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (data === undefined || data.view !== 'ready') return;
    if (seen.current === data.planId) return;
    seen.current = data.planId;
    track('candidate_viewed', {
      circle_id: id as CircleId,
      plan_id: data.planId as PlanId,
      role: data.isOrganiser ? 'organiser' : 'member',
    });
  }, [data, id]);

  // Locked in: the confirmed screen is this plan's page now (S1-28). Once,
  // guarded by a ref, for the reason `MemberCandidatesFlow` gives.
  // Only on a read made since mount, for the reason `ConfirmedFlow` gives.
  const locked = data !== undefined && isLockedIn(data.state);
  const fresh = query.isFetchedAfterMount && !query.isError;
  // Only while this is the screen on top. After a lock-in the options stay
  // mounted under the confirmed screen and see the same refetch; spending the
  // redirect from there navigates the top screen again and leaves nothing to
  // move on from when somebody swipes back onto the options.
  const focused = useIsFocused();
  const sent = useRef(false);
  useEffect(() => {
    if (!locked || !fresh || !focused || sent.current) return;
    sent.current = true;
    router.replace({ pathname: '/circles/[id]/plan/[planId]/confirmed', params: { id, planId } });
  }, [locked, fresh, focused, id, planId, router]);

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/circles/[id]', params: { id } });

  if (query.isPending || (locked && !query.isError)) {
    return <CandidatesScreen state="loading" onBack={back} />;
  }
  if (query.isError) {
    return (
      <CandidatesScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void query.refetch()}
        onBack={back}
      />
    );
  }
  if (data === undefined) return <CandidatesScreen state="denied" onBack={back} />;

  const header = headerOf(data);
  const toEditor = () => router.push({ pathname: '/j/[code]', params: { code: data.code } });
  // The organiser's own times, and back here afterwards rather than on the sent
  // screen: changing them is part of looking at the options (SUS-158).
  const toChangeMine = () =>
    router.push({ pathname: '/j/[code]', params: { code: data.code, returnTo: 'plan' } });
  const toEdit = () =>
    router.push({ pathname: '/circles/[id]/plan/[planId]/edit', params: { id, planId } });
  // Any day and time, not only an option (ADR 0051). The selected option, when
  // there is one, is where the picker opens.
  const toSetTime = (start?: string, end?: string) =>
    router.push({
      pathname: '/circles/[id]/plan/[planId]/set-time',
      params: { id, planId, mode: 'lock', ...(start === undefined ? {} : { start, end }) },
    });

  if (data.view === 'closed') {
    return <CandidatesScreen state="expired" header={header} onBack={back} />;
  }

  // Everybody sees the options; only the organiser decides (§5.6). Before
  // options exist a member sees nothing of what has come in, which is the
  // view's own rule and not this screen's.
  if (!data.isOrganiser) {
    return (
      <MemberView
        data={data}
        header={header}
        // Only while the plan is still taking answers: `replace_response`
        // refuses one past the deadline, and the plan sits in an answerable
        // state after it so the organiser can decide (spec §8).
        onChangeMyTimes={data.repliesOpen ? toEditor : undefined}
        onShareLink={shareAgain}
        shareOutcome={shareOutcome}
        // The owner may cancel a plan somebody else organises (spec §4.5).
        onCancelPlan={
          data.isOwner
            ? () =>
                router.push({
                  pathname: '/circles/[id]/plan/[planId]/cancel',
                  params: { id, planId },
                })
            : undefined
        }
        onBack={back}
      />
    );
  }

  if (data.view === 'collecting') {
    return (
      <WaitingScreen
        header={header}
        headline={waitingWords(data).headline}
        body={waitingWords(data).body}
        answered={t('waiting', 'answered', { count: data.repliedCount, total: data.askedCount })}
        still={stillToAnswer(data)}
        onShareAgain={shareAgain}
        shareOutcome={shareOutcome}
        onEditPlan={toEdit}
        onChangeMyTimes={data.repliesOpen ? toChangeMine : undefined}
        repliesClosed={!data.repliesOpen}
        onSetTime={() => toSetTime()}
        onBack={back}
      />
    );
  }

  if (data.view === 'no_quorum') {
    return (
      <NoQuorumScreen
        header={header}
        blocked={blockedBy(data)}
        nearMisses={nearMissesOf(data)}
        unlocks={unlocksOf(data, instant(clock))}
        stale={data.stale}
        busy={resolution.busy ?? (closed.busy === 'extend' ? 'extend' : undefined)}
        asking={resolution.asking}
        widerWarning={widerWarning(data, resolution.askedAgain)}
        problem={resolution.problem ?? closed.problem}
        onUnlock={(unlock) => {
          if (unlock.kind === 'lower') resolution.lower(unlock.quorum);
          else if (unlock.kind === 'extend') closed.extend();
          else if (unlock.kind === 'close') resolution.askToClose();
          else if (unlock.kind === 'wider') resolution.askToWiden(unlock.window);
          else if (unlock.kind === 'set') toSetTime();
          // A required member who cannot make it is changed in the editor:
          // `revise-plan`'s `required_member_ids`, which is S1-26's form.
          else toEdit();
        }}
        // Only while replies are open: `replace_response` refuses an answer
        // after the deadline, and a link to nothing is not worth chasing with.
        onShareAgain={shareAgain}
        shareOutcome={shareOutcome}
        onChangeMyTimes={data.repliesOpen ? toChangeMine : undefined}
        repliesClosed={!data.repliesOpen}
        onConfirmClose={() => resolution.close()}
        onConfirmWiden={() => resolution.widen()}
        onKeepAsItIs={() => resolution.keepAsItIs()}
        onBack={back}
      />
    );
  }

  // Replies closed with options on offer and nothing locked in: the three ways
  // out (spec §5.7, S2-05).
  if (isDeadlinePassed(data)) {
    return (
      <DeadlinePassedFlow
        circleId={id}
        data={data}
        header={header}
        onSetTime={() => toSetTime()}
        onBack={back}
      />
    );
  }

  const selectedId =
    chosen !== undefined && data.candidates.some((c) => c.id === chosen)
      ? chosen
      : data.candidates[0]?.id;

  return (
    <CandidatesScreen
      header={header}
      headline={headlineOf(data)}
      lead={leadOf(data)}
      cards={cardsOf(data)}
      selectedId={selectedId}
      reviewLabel={reviewLabel(data, selectedId)}
      nudgeLabel={nudgeOf(data)}
      stale={data.stale}
      // A refusal from the no-quorum screen can land here: lowering the quorum
      // is refused precisely when an answer has just made the plan ready, and
      // the organiser should be told why the tap did nothing rather than only
      // shown a screen that changed under them.
      problem={resolution.problem}
      onSelect={(next) => {
        setChosen(next);
        const rank = data.candidates.find((c) => c.id === next)?.rank;
        if (rank !== undefined) {
          track('candidate_selected', {
            circle_id: id as CircleId,
            plan_id: data.planId as PlanId,
            rank,
          });
        }
      }}
      // The candidate travels as its start instant, which is what
      // `confirm-meetup` takes (S1-16).
      onNext={() =>
        router.push({
          pathname: '/circles/[id]/plan/[planId]/review',
          params: { id, planId, candidate: selectedId ?? '' },
        })
      }
      onSetTime={() => {
        const picked = data.candidates.find((c) => c.id === selectedId);
        toSetTime(picked?.startsAt, picked?.endsAt);
      }}
      onNudge={shareAgain}
      onShareAgain={shareAgain}
      shareOutcome={shareOutcome}
      // Still asking until it is locked in, so still editable (spec §5.3).
      onEditPlan={toEdit}
      onChangeMyTimes={data.repliesOpen ? toChangeMine : undefined}
      repliesClosed={!data.repliesOpen}
      onBack={back}
    />
  );
}

export type { CandidatesRoute };
