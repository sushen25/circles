import { fromISO } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { t } from '../../copy';
import { CandidatesScreen } from './CandidatesScreen';
import { deadlineHeadline, deadlineLead, extensionOf, lockInLabel } from './deadline';
import { DeadlinePassedScreen } from './DeadlinePassedScreen';
import * as fixture from './fixtures';
import { NoQuorumScreen } from './NoQuorumScreen';
import { reviewLabel, stillToAnswer } from './lines';
import { blockedBy, unlocksOf } from './unlock';
import { cardsOf, headerOf, headlineOf, leadOf, nearMissesOf, nudgeOf } from './view';
import { WaitingScreen } from './WaitingScreen';

/**
 * Sunday Crew's four screens, for a build with no backend: the gallery, the
 * smoke export and anyone reviewing a screen without a stack.
 *
 * The route picks which one — the only thing the route ever decides — and each
 * renders through the real `view.ts`, so a sentence that is wrong here is wrong
 * in the product too.
 */
export type CandidatesRoute = 'candidates' | 'waiting' | 'no-quorum' | 'deadline';

export function FixtureCandidates({ which }: { which: CandidatesRoute }) {
  const router = useRouter();
  // Share says what it did, as the live flow does when it copies.
  const [shareOutcome, setShareOutcome] = useState<string | undefined>();
  const shareAgain = () => setShareOutcome(t('waiting', 'link_copied'));
  const toEdit = () => router.push('/circles/sunday-crew/plan/thu-17/edit');
  const toChangeMine = () => router.push('/j/pnsundaycr');
  const back = () => router.back();
  const toSetTime = () => router.push('/circles/sunday-crew/plan/thu-17/set-time');
  const data =
    which === 'waiting'
      ? fixture.waiting
      : which === 'no-quorum'
        ? fixture.noQuorum
        : fixture.ready;

  if (which === 'deadline') {
    const closed = fixture.deadlinePassed;
    const top = closed.candidates[0]?.id;
    return (
      <DeadlinePassedScreen
        header={headerOf(closed)}
        headline={deadlineHeadline(closed)}
        lead={deadlineLead(closed)}
        cards={cardsOf(closed)}
        selectedId={top}
        lockInLabel={lockInLabel(closed, top)}
        // A moment after replies closed, so the button says what it would give.
        extension={extensionOf(closed, fromISO(closed.responseDeadline))}
        onLockIn={() => router.push('/circles/sunday-crew/plan/thu-17/review')}
        onSetTime={toSetTime}
        onBack={back}
      />
    );
  }
  if (which === 'waiting') {
    return (
      <WaitingScreen
        header={headerOf(data)}
        headline={t('waiting', 'headline')}
        body={t('waiting', 'body', { count: data.quorum })}
        answered={t('waiting', 'answered', { count: data.repliedCount, total: data.askedCount })}
        still={stillToAnswer(data)}
        onShareAgain={shareAgain}
        shareOutcome={shareOutcome}
        onEditPlan={toEdit}
        onChangeMyTimes={toChangeMine}
        onSetTime={toSetTime}
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
        onShareAgain={shareAgain}
        shareOutcome={shareOutcome}
        onChangeMyTimes={toChangeMine}
        onUnlock={(unlock) => {
          if (unlock.kind === 'set') toSetTime();
        }}
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
      onNudge={shareAgain}
      onShareAgain={shareAgain}
      shareOutcome={shareOutcome}
      onEditPlan={toEdit}
      onChangeMyTimes={toChangeMine}
      onNext={() => router.push('/circles/sunday-crew/plan/thu-17/review')}
      onSetTime={toSetTime}
      onBack={back}
    />
  );
}
