import type { IdempotencyKey, ShortCode } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { ownDisplayName } from '../../../data/auth/profile';
import { newIdempotencyKey } from '../../../data/functions';
import { circleNameForCode, joinPlan } from '../../../data/membership';
import { JoinAsAccountScreen, type JoinAsAccountProblem } from '../JoinAsAccountScreen';
import { LinkInvalidScreen } from '../LinkInvalidScreen';
import { failureOf, isOffline } from './failure';
import { PlanNameFlow, useJoinedFromPlan } from './PlanNameFlow';

/**
 * An account on a plan link to a circle it is not in (ADR 0022, Decision 3).
 *
 * One tap joins under the profile's name, and nothing is sent that could rename
 * the profile. Three ways off the one-tap path:
 *
 * - **Its name is taken in this circle** (`duplicate_name`): the name step,
 *   which names the membership here and leaves the account alone.
 * - **It has no name yet** — the profile still says the trigger's `Guest`:
 *   straight to the name step, rather than joining a circle of friends as
 *   "Guest".
 * - **The plan is not asking** (`invite_inactive`): ask for the circle's invite
 *   link, the same end as a guest's.
 */
export type JoinAsAccountFlowProps = {
  code: ShortCode;
  /** The membership changed; the gate should ask again. */
  onJoined: () => void;
};

const REASONS: Record<string, JoinAsAccountProblem> = {
  circle_full: 'circle_full',
  too_many_requests: 'too_many_tries',
};

export function JoinAsAccountFlow({ code, onJoined }: JoinAsAccountFlowProps) {
  const router = useRouter();
  const joined = useJoinedFromPlan(code, onJoined);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<JoinAsAccountProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [inactive, setInactive] = useState(false);
  /** Set when the name step is needed, holding the name that was refused if any. */
  const [naming, setNaming] = useState<{ refused: string | undefined } | undefined>();
  // One request, so one key: a retry of the tap is the same join.
  const key = useRef<IdempotencyKey | undefined>(undefined);

  const circleName = useQuery({
    queryKey: ['circle-name-for-code', code],
    queryFn: () => circleNameForCode(code),
    staleTime: Infinity,
  });
  const personName = useQuery({
    queryKey: ['own-display-name'],
    queryFn: ownDisplayName,
    staleTime: 60_000,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const whatIsBrand = () => router.push('/get-the-app');

  // No circle behind the code: unknown, or archived. Nothing new is said by
  // saying so — `preview_for_code` already answers this for any code, to every
  // chat app that unfurls the link — and a join button for no circle would be
  // a button that can only fail.
  if (inactive || circleName.data === null) {
    return <LinkInvalidScreen reason="ask_for_invite" onBack={back} onWhatIsBrand={whatIsBrand} />;
  }

  if (circleName.isError || personName.isError) {
    return (
      <JoinAsAccountScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => {
          void circleName.refetch();
          void personName.refetch();
        }}
        onBack={back}
      />
    );
  }
  if (circleName.isPending || personName.isPending) {
    return <JoinAsAccountScreen state="loading" onBack={back} />;
  }

  const title = circleName.data;

  if (naming !== undefined) {
    return (
      <PlanNameFlow
        code={code}
        circleName={title}
        forAccount
        {...(naming.refused === undefined ? {} : { refusedName: naming.refused })}
        onInactive={() => setInactive(true)}
        onJoined={onJoined}
        onBack={() => setNaming(undefined)}
      />
    );
  }

  const join = async () => {
    // No name of its own yet: ask, rather than joining as the placeholder.
    if (personName.data === null) {
      setNaming({ refused: undefined });
      return;
    }
    key.current ??= newIdempotencyKey();

    setBusy(true);
    setProblem(undefined);
    setReference(undefined);
    try {
      joined(await joinPlan({ code, idempotencyKey: key.current }));
    } catch (error) {
      const failure = failureOf(error);
      const reason = failure.kind === 'reason' ? failure.reason : undefined;
      if (reason === 'invite_inactive') {
        setInactive(true);
      } else if (reason === 'duplicate_name') {
        setNaming({ refused: personName.data });
      } else if (failure.kind === 'offline') {
        setProblem('offline');
      } else if (reason !== undefined && REASONS[reason] !== undefined) {
        setProblem(REASONS[reason]);
      } else {
        setProblem('couldnt_join');
        setReference(failure.reference);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <JoinAsAccountScreen
      circleName={title}
      personName={personName.data}
      problem={problem}
      reference={reference}
      busy={busy}
      onJoin={() => void join()}
      onNotNow={back}
      onBack={back}
    />
  );
}
