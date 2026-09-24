import { useRouter } from 'expo-router';

import { hasBackend } from '../../data/auth/client';
import { isOffline } from '../identity/join/failure';
import type { ConfirmedKey } from './ConfirmedFlow';
import * as fixture from './fixtures';
import { outcomeStageOf } from './morningAfter';
import { OrganiserOutcome } from './OutcomeFlow';
import { OutcomeScreen } from './OutcomeScreen';
import { useConfirmation } from './useConfirmation';
import { MemberAttendance } from './WasThereFlow';

/**
 * The morning after, on any of its doors (spec §5.10):
 *
 * - `/p/:code/outcome` — the organiser's "did it happen?" email;
 * - `/p/:code/attendance` — a member's "were you there?" email, and circle
 *   home's card;
 * - `/circles/:id/plan/:planId/outcome` — circle home's card for the organiser.
 *
 * **Who you are decides the screen, not the door**, as on the confirmed screen:
 * the organiser gets Outcome and everybody else WasThere, whichever link they
 * followed. A forwarded email, or a member tapping the organiser's link in a
 * shared inbox, lands on the question that is theirs to answer — never on one
 * the server would refuse them. The one exception is the organiser's own
 * attendance: once they have reported, the attendance door is theirs as a
 * member.
 */
export function MorningAfterFlow({
  target,
  door = 'outcome',
  fixtureAs = 'organiser',
}: {
  target: ConfirmedKey;
  /**
   * Which link was followed. It decides one thing: an organiser who has
   * already reported and opens the attendance door is answering as the
   * member they also are (review round 2).
   */
  door?: 'outcome' | 'attendance' | undefined;
  /** With no backend: whose screen the fixture shows. */
  fixtureAs?: 'organiser' | 'member' | undefined;
}) {
  if (!hasBackend()) {
    const data = fixtureAs === 'member' ? fixture.morningAfterAsMember : fixture.morningAfter;
    return data.isOrganiser ? (
      <OrganiserOutcome data={data} queryKey="" />
    ) : (
      <MemberAttendance data={data} queryKey="" />
    );
  }
  return <LiveMorningAfter target={target} door={door} />;
}

function LiveMorningAfter({
  target,
  door,
}: {
  target: ConfirmedKey;
  door: 'outcome' | 'attendance';
}) {
  const router = useRouter();
  const query = useConfirmation(target);
  const data = query.data ?? undefined;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const queryKey = 'planId' in target ? target.planId : target.code;

  if (query.isPending) return <OutcomeScreen state="loading" onBack={back} />;
  // A failed *re*-read keeps the screen it had: an answer half given should not
  // be thrown away because a focus refetch met a tunnel.
  if (query.isError && data === undefined) {
    return (
      <OutcomeScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void query.refetch()}
        onBack={back}
      />
    );
  }
  if (data === undefined) return <OutcomeScreen state="denied" onBack={back} />;
  // Organiser or not is the read's answer: `organiser_user_id` against the
  // session, the same test `report_outcome` makes.
  // The outcome first while it is owed: it is the answer that moves "Last
  // caught up", and theirs alone to give.
  const asOrganiser = data.isOrganiser && (door === 'outcome' || outcomeStageOf(data) === 'ask');
  return asOrganiser ? (
    <OrganiserOutcome data={data} queryKey={queryKey} />
  ) : (
    <MemberAttendance data={data} queryKey={queryKey} />
  );
}
