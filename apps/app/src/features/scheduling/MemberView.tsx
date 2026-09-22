import { t } from '../../copy';
import type { PlanCandidates } from '../../data/scheduling';
import { CandidatesMemberScreen } from './CandidatesMemberScreen';
import { cardsOf, headlineOf, type HeaderView } from './view';

/**
 * What a member sees, on either door — `/p/:code` and the organiser's own
 * route, which everyone in the circle may open (spec §5.6).
 *
 * No primary: only the organiser confirms. With no options yet this is where
 * "members see nothing until options exist" lands, and §3.5 decides how it
 * reads — waiting for people, never a group that has failed.
 */
export function MemberView({
  data,
  header,
  onChangeMyTimes,
  onRetry,
  onBack,
}: {
  data: PlanCandidates;
  header: HeaderView;
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
      // The same warning the ready view gets. An old no-quorum set outlives
      // the answer that may already have broken the deadlock, and "there
      // wasn't enough overlap" is the one sentence on these screens that must
      // never be said before it is true.
      stale={data.stale}
      onChangeMyTimes={onChangeMyTimes}
      onRetry={onRetry}
      onBack={onBack}
    />
  );
}
