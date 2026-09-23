import { useRouter } from 'expo-router';

import { t } from '../../copy';
import { CandidatesScreen } from './CandidatesScreen';
import * as fixture from './fixtures';
import { NoQuorumScreen } from './NoQuorumScreen';
import { reviewLabel, stillToAnswer } from './lines';
import { blockedBy, unlocksOf } from './unlock';
import { cardsOf, headerOf, headlineOf, leadOf, nearMissesOf, nudgeOf } from './view';
import { WaitingScreen } from './WaitingScreen';

/**
 * Sunday Crew's three screens, for a build with no backend: the gallery, the
 * smoke export and anyone reviewing a screen without a stack.
 *
 * The route picks which one — the only thing the route ever decides — and each
 * renders through the real `view.ts`, so a sentence that is wrong here is wrong
 * in the product too.
 */
export type CandidatesRoute = 'candidates' | 'waiting' | 'no-quorum';

export function FixtureCandidates({ which }: { which: CandidatesRoute }) {
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
