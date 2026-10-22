import type { GuestMemberOption, IdempotencyKey, ShortCode } from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../../analytics/track';
import { useSession } from '../../../data/auth/session';
import { newIdempotencyKey } from '../../../data/functions';
import { circleNameForCode, guestMembersFor, reattachFromList } from '../../../data/membership';
import { ContinueAsScreen, type ContinueProblem } from '../ContinueAsScreen';
import { LinkInvalidScreen } from '../LinkInvalidScreen';
import { failureOf, isOffline } from './failure';
import { useHaveAccount } from './haveAccount';
import { JoinAsAccountFlow } from './JoinAsAccountFlow';
import { nameStepBack, NAME_STEP, nameStepPushed, rememberNameStepPushed } from './nameStepBack';
import { PlanNameFlow } from './PlanNameFlow';

/**
 * "Have you answered this before?" (ADR 0006, spec §5.1, §6.2), and "I'm new
 * here" (ADR 0022).
 *
 * Shown in place of a plan page when a session holds no membership of its
 * circle: a guest's, one this page has just made, or a signed-in account's.
 * An account sees the same names, and a pick moves that guest's place onto it
 * (ADR 0088). For an account, "I'm new here" — and a circle with no guests —
 * is `JoinAsAccountFlow`'s one tap, "Join [circle] as [name]", rather than the
 * name step.
 *
 * - **A pick reattaches**, and the page underneath is then simply allowed —
 *   nothing navigates, so "resume the original route" is the route the person
 *   never left.
 * - **"I'm new here" asks for a name and joins through the plan's link.**
 *   Whether the plan is still asking is learned from that answer, because a
 *   non-member cannot read the plan to check first; a plan that is not ends at
 *   the ask-for-the-invite state, as does a code that does not exist.
 * - **A code that is no longer live ends at "this link isn't active".** The
 *   circle's name is what says so (`preview_for_code` answers null for a plan
 *   that is cancelled, expired or long past, and for an archived circle), and
 *   the list for such a code is empty for the same reason (ADR 0049).
 * - **A circle with no guests skips the question.** There is nobody to be, so
 *   "Have you answered this before?" would be a question with one answer.
 */
export type ContinueAsFlowProps = {
  code: ShortCode;
  /** This page load had no session and made one, rather than arriving with somebody's. */
  arrivedWithoutSession: boolean;
  /**
   * The membership moved or was made; the gate should ask again. `'list'` when
   * it was a pick from "Have you answered this before?" — the one reattach the "save your
   * place" prompt follows (S2-07).
   */
  onReattached: (via?: 'list') => void;
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
  // "I'm new here" is a step in the browser's history, not only in this
  // component: it is the `?step=name` of the plan link's own address, so the
  // browser's Back returns to the list, and a reload stays on the name step.
  const { step } = useLocalSearchParams<{ step?: string }>();
  const pathname = usePathname();
  const imNew = step === NAME_STEP;
  // Bumped by Back from a name step with nothing before it: the field starts empty again.
  const [nameAttempt, setNameAttempt] = useState(0);
  /**
   * Joined, and waiting for the gate to notice. Until it re-reads membership
   * this page still thinks they are outside, and the list — read again — now
   * holds their own name: "Have you answered this before?" offering them themselves, for a
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
    // Not for ever: the name is also the answer to "is this link still live?", and a
    // plan can be cancelled, expire or pass the fourteen days while a tab is open.
    staleTime: 30_000,
  });

  const guests = useQuery({
    // The user is part of the key because the list is read *as* them, and the
    // limit on it is counted per caller.
    queryKey: ['guest-members', code, session.userId],
    queryFn: () => guestMembersFor(code),
    staleTime: 0,
    retry: 1,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const openNameStep = () => {
    rememberNameStepPushed(code);
    router.push({ pathname, params: { step: NAME_STEP } } as Parameters<typeof router.push>[0]);
  };

  /** Back from the name step: the step before it on this plan link, never the website. */
  const backFromNameStep = (nobodyToBe: boolean) => {
    switch (
      nameStepBack({ nobodyToBe, pushedHere: nameStepPushed(code), canGoBack: router.canGoBack() })
    ) {
      case 'pop':
        router.back();
        return;
      case 'to_list':
        router.replace({ pathname } as Parameters<typeof router.replace>[0]);
        return;
      case 'start_over':
        setNameAttempt((n) => n + 1);
        return;
    }
  };

  if (joinedHere) {
    return (
      <ContinueAsScreen circleName={circleName.data ?? undefined} state="loading" onBack={back} />
    );
  }

  if (askForInvite) {
    return <LinkInvalidScreen reason="ask_for_invite" onBack={back} />;
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

  // No circle behind this code *now*: the plan was cancelled or expired, its
  // meetup is long past, or the circle is archived (ADR 0049). The name lookup
  // answers null for all of those and for a code that never existed, so the
  // person is told the link is not active rather than asked for a name that
  // could join nobody.
  if (circleName.data === null) {
    return <LinkInvalidScreen reason="plan_inactive" onBack={back} />;
  }

  // An account that is new here joins as itself, in one tap (ADR 0022). Its
  // Back, from the `?step=name` entry, returns to the list.
  if ((imNew || nobodyToBe) && signedIn) {
    return <JoinAsAccountFlow code={code} onJoined={() => onReattached()} />;
  }

  if (imNew || nobodyToBe) {
    if (circleName.isPending) {
      return <ContinueAsScreen circleName={title} state="loading" onBack={back} />;
    }
    return (
      <PlanNameFlow
        key={nameAttempt}
        isHistoryEntry={imNew && nameStepPushed(code)}
        code={code}
        circleName={title ?? ''}
        onInactive={() => setAskForInvite(true)}
        onJoined={() => {
          setJoinedHere(true);
          onReattached();
        }}
        onBack={() => backFromNameStep(nobodyToBe)}
      />
    );
  }

  if (guests.isError) {
    return (
      <ContinueAsScreen
        circleName={title}
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void guests.refetch()}
        onBack={back}
      />
    );
  }
  if (guests.isPending) {
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
      // The circle goes on the event so the founder's gate can count it in its
      // cohort (ADR 0058); the person does not.
      track('member_reattached', { source: 'list', circle_id: member.circle_id });
      // "Keep your place for good?" follows a guest's pick only: an account's
      // place is already kept.
      onReattached(signedIn ? undefined : 'list');
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
      onImNewHere={openNameStep}
      onSignIn={haveAccount}
      onBack={back}
    />
  );
}
