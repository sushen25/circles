import type { CircleId, PlanId } from '@circles/contracts';
import { EN_SHARE_TEMPLATES, waitingMessage } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import { appOrigin } from '../../data/links/origin';
import { planLink } from '../../data/planning';
import { shareMessage } from '../../platform/share';
import { isOffline } from '../identity/join/failure';
import { CandidatesScreen } from './CandidatesScreen';
import { FixtureCandidates, type CandidatesRoute } from './FixtureCandidates';
import { MemberView } from './MemberView';
import { NoQuorumScreen } from './NoQuorumScreen';
import { reviewLabel, stillToAnswer, widerWarning } from './lines';
import { blockedBy, unlocksOf } from './unlock';
import { useCandidates } from './useCandidates';
import { useResolution } from './useResolution';
import { cardsOf, headerOf, headlineOf, leadOf, nearMissesOf, notAnswered, nudgeOf } from './view';
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
  const resolution = useResolution({ planId, circleId: id });
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

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: '/circles/[id]', params: { id } });

  if (query.isPending) return <CandidatesScreen state="loading" onBack={back} />;
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
  const toEdit = () =>
    router.push({ pathname: '/circles/[id]/plan/[planId]/edit', params: { id, planId } });

  if (data.view === 'closed') {
    return <CandidatesScreen state="expired" header={header} onBack={back} />;
  }

  // How many replies are still out, from the summaries the organiser always
  // sees rather than from the set's own count — that belongs to the set, and a
  // set one answer behind would have a message saying so.
  const waiting = notAnswered(data);
  const remaining =
    data.responded === null ? Math.max(0, data.askedCount - data.repliedCount) : waiting.length;
  const ids = { circle_id: id as CircleId, plan_id: data.planId as PlanId };
  const shared = (kind: 'plan' | 'reminder') => (result: string) => {
    if (result === 'sheet' || result === 'dismissed' || result === 'copied') {
      track('share_opened', { ...ids, kind });
    }
  };

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
        onBack={back}
      />
    );
  }

  if (data.view === 'collecting') {
    const link = planLink(appOrigin(), data.code);
    return (
      <WaitingScreen
        header={header}
        headline={
          data.repliedCount === 0 ? t('waiting', 'headline_first') : t('waiting', 'headline')
        }
        body={t('waiting', 'body', { count: data.quorum })}
        answered={t('waiting', 'answered', { count: data.repliedCount, total: data.askedCount })}
        still={stillToAnswer(data)}
        onShareAgain={() => {
          // The waiting message, not the original ask: the link has already
          // been in the chat, and `waitingMessage` is the domain's sentence
          // for exactly this screen — "a count, never names", because a
          // message pasted into a group chat is read by everyone.
          const message = waitingMessage({ remaining, url: link, templates: EN_SHARE_TEMPLATES });
          void shareMessage(message).then(shared('reminder'));
        }}
        onEditPlan={toEdit}
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
        unlocks={unlocksOf(data)}
        stale={data.stale}
        busy={resolution.busy}
        asking={resolution.asking}
        widerWarning={widerWarning(data, resolution.askedAgain)}
        problem={resolution.problem}
        onUnlock={(unlock) => {
          if (unlock.kind === 'lower') resolution.lower(unlock.quorum);
          else if (unlock.kind === 'close') resolution.askToClose();
          else if (unlock.kind === 'wider') resolution.askToWiden(unlock.window);
          // A required member who cannot make it is changed in the editor:
          // `revise-plan`'s `required_member_ids`, which is S1-26's form.
          else toEdit();
        }}
        onConfirmClose={() => resolution.close()}
        onConfirmWiden={() => resolution.widen()}
        onKeepAsItIs={() => resolution.keepAsItIs()}
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
      // `confirm-meetup` takes (S1-16). The review screen is S1-28's.
      onNext={() =>
        router.push({
          pathname: '/circles/[id]/plan/[planId]/review',
          params: { id, planId, candidate: selectedId ?? '' },
        })
      }
      onNudge={() => {
        const message = waitingMessage({
          remaining,
          url: planLink(appOrigin(), data.code),
          templates: EN_SHARE_TEMPLATES,
        });
        void shareMessage(message).then(shared('reminder'));
      }}
      onBack={back}
    />
  );
}

export type { CandidatesRoute };
