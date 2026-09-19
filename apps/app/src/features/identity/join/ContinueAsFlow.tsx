import type { GuestMemberOption, IdempotencyKey, ShortCode } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../../analytics/track';
import { useSession } from '../../../data/auth/session';
import { newIdempotencyKey } from '../../../data/functions';
import { circleNameForCode, guestMembersFor, reattachFromList } from '../../../data/membership';
import { ContinueAsScreen, type ContinueProblem } from '../ContinueAsScreen';
import { LinkInvalidScreen } from '../LinkInvalidScreen';
import { failureOf, isOffline } from './failure';
import { useHaveAccount } from './haveAccount';
import { PlanNameFlow } from './PlanNameFlow';

/**
 * "Welcome back. Which one is you?" (ADR 0006, spec §5.1, §6.2), and "I'm new
 * here" (ADR 0022).
 *
 * Shown in place of a plan page when a guest session — or one this page has
 * just made — holds no membership of its circle. An account never sees it: the
 * gate sends one to `JoinAsAccountFlow`.
 *
 * - **A pick reattaches**, and the page underneath is then simply allowed —
 *   nothing navigates, so "resume the original route" is the route the person
 *   never left.
 * - **"I'm new here" asks for a name and joins through the plan's link.**
 *   Whether the plan is still asking is learned from that answer, because a
 *   non-member cannot read the plan to check first; a plan that is not ends at
 *   the ask-for-the-invite state, as does a code that does not exist.
 * - **A circle with no guests skips the question.** There is nobody to be, so
 *   "Which one is you?" would be a question with one answer.
 */
export type ContinueAsFlowProps = {
  code: ShortCode;
  /** This page load had no session and made one, rather than arriving with somebody's. */
  arrivedWithoutSession: boolean;
  /** The membership moved or was made; the gate should ask again. */
  onReattached: () => void;
};

export function ContinueAsFlow({ code, arrivedWithoutSession, onReattached }: ContinueAsFlowProps) {
  const router = useRouter();
  const session = useSession();
  const signedIn = session.status === 'saved' || session.status === 'app';
  const haveAccount = useHaveAccount();

  const [busyKey, setBusyKey] = useState<string | undefined>();
  const [problem, setProblem] = useState<ContinueProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const [askForInvite, setAskForInvite] = useState(false);
  const [imNew, setImNew] = useState(false);
  /**
   * Joined, and waiting for the gate to notice. Until it re-reads membership
   * this page still thinks they are outside, and the list — read again — now
   * holds their own name: "Which one is you?" offering them themselves, for a
   * moment, on the way in. So it holds the loading state instead.
   */
  const [joinedHere, setJoinedHere] = useState(false);
  const keys = useRef(new Map<string, IdempotencyKey>());

  // Once per arrival, and only for an arrival that had no session. The gate
  // knows; see `arrivedWithoutSession` there for why the others are excluded.
  useEffect(() => {
    if (arrivedWithoutSession) track('session_missing_on_return', {});
  }, [arrivedWithoutSession]);

  const circleName = useQuery({
    queryKey: ['circle-name-for-code', code],
    queryFn: () => circleNameForCode(code),
    staleTime: Infinity,
  });

  const guests = useQuery({
    // The user is part of the key because the list is read *as* them, and the
    // limit on it is counted per caller.
    queryKey: ['guest-members', code, session.userId],
    queryFn: () => guestMembersFor(code),
    enabled: !signedIn,
    staleTime: 0,
    retry: 1,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (joinedHere) {
    return (
      <ContinueAsScreen circleName={circleName.data ?? undefined} state="loading" onBack={back} />
    );
  }

  if (askForInvite) {
    return (
      <LinkInvalidScreen
        reason="ask_for_invite"
        onBack={back}
        onWhatIsBrand={() => router.push('/get-the-app')}
      />
    );
  }

  const title = circleName.data ?? undefined;
  const listed = guests.data?.kind === 'listed' ? guests.data.members : [];
  const nobodyToBe = guests.data?.kind === 'listed' && listed.length === 0;

  // Waiting on the name as well, when it is going straight to the name step:
  // that screen's title and its "Someone in {circle}…" need it.
  // The name is the title of every screen here, and the name step quotes it
  // ("Someone in Sunday Crew is already called…"). A failed lookup is an error
  // with a retry, not a screen with a blank where the circle should be.
  if (circleName.isError) {
    return (
      <ContinueAsScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => {
          void circleName.refetch();
          void guests.refetch();
        }}
        onBack={back}
      />
    );
  }

  if ((imNew || nobodyToBe) && !signedIn) {
    if (circleName.isPending) {
      return <ContinueAsScreen circleName={title} state="loading" onBack={back} />;
    }
    return (
      <PlanNameFlow
        code={code}
        circleName={title ?? ''}
        onInactive={() => setAskForInvite(true)}
        onJoined={() => {
          setJoinedHere(true);
          onReattached();
        }}
        // Back to the list when there is one to go back to; otherwise off the page.
        onBack={nobodyToBe ? back : () => setImNew(false)}
      />
    );
  }

  if (!signedIn && guests.isError) {
    return (
      <ContinueAsScreen
        circleName={title}
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void guests.refetch()}
        onBack={back}
      />
    );
  }
  if (!signedIn && guests.isPending) {
    return <ContinueAsScreen circleName={title} state="loading" onBack={back} />;
  }

  const byKey = new Map<string, GuestMemberOption>(listed.map((m) => [m.member_user_id, m]));

  const pick = async (member: GuestMemberOption) => {
    let key = keys.current.get(member.member_user_id);
    if (key === undefined) {
      key = newIdempotencyKey();
      keys.current.set(member.member_user_id, key);
    }

    setBusyKey(member.member_user_id);
    setProblem(undefined);
    setReference(undefined);

    try {
      await reattachFromList({
        circleId: member.circle_id,
        memberUserId: member.member_user_id,
        idempotencyKey: key,
      });
      track('member_reattached', { source: 'list' });
      onReattached();
    } catch (error) {
      const failure = failureOf(error);
      const reason = failure.kind === 'reason' ? failure.reason : undefined;
      switch (reason) {
        case 'already_member':
          // Already in, under this session: the gate's answer was stale.
          onReattached();
          return;
        case 'member_not_found':
          // Moved or removed since the list was read. Read it again.
          void guests.refetch();
          return;
        case 'reattach_limit':
          setProblem({ kind: 'reattach_limit', name: member.display_name });
          return;
        case 'target_is_permanent':
          setProblem({ kind: 'saved_place', name: member.display_name });
          return;
        case 'too_many_requests':
          setProblem({ kind: 'too_many_tries' });
          return;
        default:
          setProblem({ kind: 'couldnt_rejoin' });
          setReference(failure.kind === 'offline' ? undefined : failure.reference);
      }
    } finally {
      setBusyKey(undefined);
    }
  };

  return (
    <ContinueAsScreen
      circleName={title}
      options={listed.map((m) => ({ key: m.member_user_id, name: m.display_name }))}
      signedIn={signedIn}
      problem={guests.data?.kind === 'limited' ? { kind: 'too_many_tries' } : problem}
      reference={reference}
      busyKey={busyKey}
      onPick={(option) => {
        const member = byKey.get(option.key);
        if (member !== undefined) void pick(member);
      }}
      onImNewHere={() => setImNew(true)}
      onSignIn={haveAccount}
      onBack={back}
    />
  );
}
