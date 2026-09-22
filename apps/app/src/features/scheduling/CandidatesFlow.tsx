import type { CircleId, PlanId } from '@circles/contracts';
import { EN_SHARE_TEMPLATES, newPlanMessage, waitingMessage } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import { appOrigin } from '../../data/links/origin';
import { planLink } from '../../data/planning';
import type { PlanCandidates } from '../../data/scheduling';
import { shareMessage } from '../../platform/share';
import { isOffline } from '../identity/join/failure';
import { CandidatesMemberScreen } from './CandidatesMemberScreen';
import { CandidatesScreen } from './CandidatesScreen';
import * as fixture from './fixtures';
import { NoQuorumScreen } from './NoQuorumScreen';
import { useCandidates } from './useCandidates';
import { useResolution } from './useResolution';
import { blockedBy, unlocksOf, widerWindow } from './unlock';
import { dateOf } from './words';
import { nameList } from './names';
import { WaitingScreen } from './WaitingScreen';
import {
  cardsOf,
  headerOf,
  listOf,
  headlineOf,
  leadOf,
  nearMissesOf,
  notAnswered,
  namesWithYou,
  nudgeOf,
  weekdayOf,
} from './view';

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
export type CandidatesRoute = 'candidates' | 'waiting' | 'no-quorum';

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

function FixtureCandidates({ which }: { which: CandidatesRoute }) {
  const router = useRouter();
  const back = () => router.back();
  const data =
    which === 'waiting'
      ? fixture.waiting
      : which === 'no-quorum'
        ? fixture.noQuorum
        : fixture.ready;

  if (which === 'waiting') {
    return (
      <WaitingScreen
        header={headerOf(data)}
        headline={t('waiting', 'headline')}
        body={t('waiting', 'body', { count: data.quorum })}
        answered={t('waiting', 'answered', { count: data.repliedCount, total: data.askedCount })}
        still={stillToAnswer(data)}
        onBack={back}
      />
    );
  }
  if (which === 'no-quorum') {
    return (
      <NoQuorumScreen
        header={headerOf(data)}
        blocked={blockedBy(data)}
        nearMisses={nearMissesOf(data)}
        unlocks={unlocksOf(data)}
        onBack={back}
      />
    );
  }
  return (
    <CandidatesScreen
      header={headerOf(data)}
      headline={headlineOf(data)}
      lead={leadOf(data)}
      cards={cardsOf(data)}
      selectedId={data.candidates[0]?.id}
      reviewLabel={reviewLabel(data, data.candidates[0]?.id)}
      nudgeLabel={nudgeOf(data)}
      onNext={() => router.push('/circles/sunday-crew/plan/thu-17/review')}
      onBack={back}
    />
  );
}

/** "Review Thursday" for whichever option is selected. */
function reviewLabel(data: PlanCandidates, selectedId: string | undefined): string | undefined {
  const row = data.candidates.find((c) => c.id === selectedId);
  if (row === undefined) return undefined;
  return t('candidates', 'review', { day: weekdayOf(row.startsAt, data.zone) });
}

/**
 * "Still to answer: you and Tom."
 *
 * The reader is named "you" and put first: the organiser is usually one of the
 * people being asked (ADR 0026 has them answer their own plan right after
 * sharing it), and a screen that reads their own name back at them is a screen
 * that looks like it is talking about somebody else.
 */
function stillToAnswer(data: PlanCandidates): string {
  const waiting = namesWithYou(data, notAnswered(data));
  const list = nameList(waiting);
  switch (list.kind) {
    case 'none':
      return t('waiting', 'still_none');
    case 'one':
      return t('waiting', 'still_one', { name: list.a });
    case 'two':
      return t('waiting', 'still_two', { name: list.a, other: list.b });
    case 'three':
      return t('waiting', 'still_three', { name: list.a, other: list.b, third: list.c });
    case 'many':
      return t('waiting', 'still_many', { name: list.a, other: list.b, count: list.rest });
  }
}

/**
 * "The plan would run to Sun 4 Oct. It becomes a new question, so everyone who
 * has answered is asked again: you, Priya and 4 others."
 *
 * The names are the ones `revise-plan`'s preview returned, not a list this
 * screen worked out: §5.3's promise is about what the server will actually do.
 */
function widerWarning(data: PlanCandidates, askedAgain: string[] | undefined): string | undefined {
  if (askedAgain === undefined) return undefined;
  const day = dateOf(`${widerEnd(data)}T12:00:00.000Z`, 'UTC');
  const names = listOf(namesWithYou(data, askedAgain));
  return names === undefined
    ? t('noQuorum', 'wider_confirm_body_nobody', { day })
    : t('noQuorum', 'wider_confirm_body', { day, name: names });
}

function widerEnd(data: PlanCandidates): string {
  return widerWindow(data)?.end ?? data.windowEnd;
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
          const message = newPlanMessage({
            circleName: data.circleName,
            url: link,
            templates: EN_SHARE_TEMPLATES,
          });
          void shareMessage(message).then((result) => {
            if (result === 'sheet' || result === 'dismissed' || result === 'copied') {
              track('share_opened', {
                circle_id: id as CircleId,
                plan_id: data.planId as PlanId,
                kind: 'plan',
              });
            }
          });
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

  const remaining = Math.max(0, data.askedCount - data.repliedCount);
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
        void shareMessage(message).then((result) => {
          if (result === 'sheet' || result === 'dismissed' || result === 'copied') {
            track('share_opened', {
              circle_id: id as CircleId,
              plan_id: data.planId as PlanId,
              kind: 'reminder',
            });
          }
        });
      }}
      onBack={back}
    />
  );
}

/** What a member sees, on either door. */
export function MemberView({
  data,
  header,
  onChangeMyTimes,
  onRetry,
  onBack,
}: {
  data: PlanCandidates;
  header: ReturnType<typeof headerOf>;
  onChangeMyTimes?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
}) {
  const organiser = data.roster.find((m) => m.userId === data.organiserUserId);

  if (data.view === 'ready') {
    return (
      <CandidatesMemberScreen
        header={header}
        headline={headlineOf(data)}
        lead={
          organiser === undefined
            ? t('candidatesMember', 'lead_no_organiser')
            : t('candidatesMember', 'lead_organiser', { name: organiser.name })
        }
        cards={cardsOf(data)}
        // The same warning the organiser gets: what is on screen was worked
        // out before the newest answer, and a member has no other way to know.
        stale={data.stale}
        onChangeMyTimes={onChangeMyTimes}
        onRetry={onRetry}
        onBack={onBack}
      />
    );
  }

  const overlap = data.view === 'no_quorum';
  return (
    <CandidatesMemberScreen
      header={header}
      headline={t('candidatesMember', overlap ? 'no_overlap_headline' : 'waiting_headline')}
      lead={
        overlap
          ? t('candidatesMember', 'no_overlap_body')
          : t('candidatesMember', 'waiting_body', { count: data.quorum })
      }
      onChangeMyTimes={onChangeMyTimes}
      onRetry={onRetry}
      onBack={onBack}
    />
  );
}
