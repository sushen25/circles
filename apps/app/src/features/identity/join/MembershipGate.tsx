import { ShortCode } from '@circles/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { hasBackend } from '../../../data/auth/client';
import { ensureGuestSession } from '../../../data/auth/guest';
import { guard, type Membership } from '../../../data/auth/guards';
import { useSession } from '../../../data/auth/session';
import { readDraft } from '../../../data/availability';
import { askToPlan, circleAccess, planAccess } from '../../../data/membership';
import { ReattachedNudgeFlow } from '../../growth/ReattachedNudgeFlow';
import { ContinueAsScreen } from '../ContinueAsScreen';
import { LinkInvalidScreen } from '../LinkInvalidScreen';
import { ContinueAsFlow } from './ContinueAsFlow';
import { JoinAsAccountFlow } from './JoinAsAccountFlow';
import { isOffline } from './failure';

/**
 * Who gets past a circle or plan route (spec §5.1, architecture §10).
 *
 * The decision is `guard()`'s, not this component's: it is handed the session
 * and one server-answered fact — whether a row came back through RLS — and
 * this renders what it says. The server remains the authority either way; this
 * decides which *screen* somebody sees, so that a guest whose session Safari
 * cleared meets "Which one is you?" rather than an empty page.
 *
 * With no backend configured the route renders as it always has, from
 * fixtures (`hasBackend`), so the gallery and the smoke export are unchanged.
 */

type Target = { kind: 'plan'; code: string } | { kind: 'circle'; id: string };

export function MembershipGate({ target, children }: { target: Target; children: ReactNode }) {
  if (!hasBackend()) return <>{children}</>;
  return <LiveGate target={target}>{children}</LiveGate>;
}

function LiveGate({ target, children }: { target: Target; children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const [sessionFailed, setSessionFailed] = useState(false);
  // Bumped by Try again. The effect below depends on it, because nothing else
  // it depends on changes after a failed attempt: the session is still `none`
  // and the decision still `needs_session`.
  const [sessionAttempt, setSessionAttempt] = useState(0);
  /**
   * This page load found no session at all and had to make one.
   *
   * The closest the client can come to "returned with no session" (§11.2's
   * continuity funnel). A signed-in account opening a friend's plan, or a guest
   * who is in other circles, arrives *with* a session and is not a return, and
   * counting them as one would inflate the very rate the metric exists to read.
   */
  const [arrivedWithoutSession, setArrivedWithoutSession] = useState(false);
  /**
   * A pick from the list just let this person back in. The page is then
   * preceded, once, by "Keep your place for good?" (S2-07) — which decides for
   * itself whether it is owed and otherwise draws the page straight away.
   */
  const [rejoinedFromList, setRejoinedFromList] = useState(false);

  const code = target.kind === 'plan' ? ShortCode.safeParse(target.code) : undefined;
  const malformed = code !== undefined && !code.success;

  const accessKey = ['membership', target.kind, target.kind === 'plan' ? target.code : target.id];
  const access = useQuery({
    queryKey: [...accessKey, session.userId],
    queryFn: async (): Promise<{ membership: Membership; needsAsking: boolean }> => {
      if (target.kind === 'plan') {
        const answer = await planAccess(target.code as ShortCode);
        return answer.membership === 'member'
          ? { membership: 'member', needsAsking: answer.needsAsking }
          : { membership: 'not_member', needsAsking: false };
      }
      const answer = await circleAccess(target.id);
      return { membership: answer.membership, needsAsking: false };
    },
    enabled: !malformed && !session.isLoading && session.status !== 'none',
    staleTime: 30_000,
  });

  const decision = guard({
    route: 'guest',
    session,
    membership: access.data?.membership ?? 'unknown',
  });

  /**
   * A member this plan is not asking, while it is (ADR 0022): somebody who
   * joined the circle after the plan was made. Opening its link asks them,
   * through `join-plan` with no name, which for a member adds the participant
   * row and nothing else — no membership, no announcement. The page shows
   * meanwhile; it is theirs either way, and only the answer depends on this.
   *
   * Once per page and person while it succeeds; `askToPlan` retries a
   * transient failure, and one that outlasts that is tried again on the next
   * read of membership rather than left for the person to meet as a refusal.
   */
  const askedFor = useRef<string | undefined>(undefined);
  const needsAsking = decision.kind === 'allow' && access.data?.needsAsking === true;
  const planCode = target.kind === 'plan' ? target.code : undefined;
  // A dependency so that each fresh read of membership is a chance to try
  // again after a failure; while one has succeeded or is running, `askedFor`
  // makes the re-run a no-op.
  const accessReadAt = access.dataUpdatedAt;
  useEffect(() => {
    if (!needsAsking || planCode === undefined) return;
    const who = `${planCode}:${session.userId ?? ''}`;
    if (askedFor.current === who) return;
    askedFor.current = who;
    void askToPlan(planCode as ShortCode).then((outcome) => {
      if (outcome === 'failed') {
        // Retried already. Forget this attempt, so that the next time the gate
        // reads membership — on focus, or in thirty seconds — it tries again,
        // rather than never for as long as this page is open.
        askedFor.current = undefined;
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['membership', 'plan', planCode] });
    });
  }, [needsAsking, planCode, session.userId, queryClient, accessReadAt]);

  // §10: the session comes first. Continue-as cannot even ask who is in the
  // circle without one, and `ensureGuestSession` is idempotent, so the effect
  // re-running on a re-render cannot mint a second identity.
  useEffect(() => {
    if (decision.kind !== 'needs_session' || malformed || sessionFailed) return;
    ensureGuestSession()
      .then(() => setArrivedWithoutSession(true))
      .catch(() => setSessionFailed(true));
  }, [decision.kind, malformed, sessionFailed, sessionAttempt]);

  /**
   * The server has just said this person is in: a join or a reattachment
   * succeeded. Written into the cache rather than only invalidated, because an
   * invalidated query keeps answering "not a member" while it refetches — and
   * the page that navigation mounts next (`/j/:code`, a new gate) reads that
   * answer, mounts Continue-as again, and shows the person their own name to
   * continue as. The refetch still happens; it confirms rather than decides.
   */
  const becameMember = () => {
    queryClient.setQueryData([...accessKey, session.userId], {
      membership: 'member' as const,
      needsAsking: false,
    });
    void queryClient.invalidateQueries({ queryKey: accessKey });
  };

  /**
   * This person has times for this plan saved on the device (S1-25). A draft
   * is only ever written by a member, so while membership is still being read
   * — or cannot be, because the connection is down — the page is shown rather
   * than a spinner or an error: it is the one screen built to work offline,
   * and a reload in a tunnel should not throw it away. The server still decides
   * everything; if membership comes back "no", the guard's answer replaces it.
   */
  const savedHere = useQuery({
    queryKey: ['answer-draft-here', planCode, session.userId],
    queryFn: async () =>
      (await readDraft(session.userId as string, planCode as string)) !== undefined,
    enabled: planCode !== undefined && session.userId !== undefined,
    staleTime: Infinity,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const whatIsBrand = () => router.push('/get-the-app');

  if (malformed) {
    return <LinkInvalidScreen reason="ask_for_invite" onBack={back} onWhatIsBrand={whatIsBrand} />;
  }

  if (access.data === undefined && savedHere.data === true) return <>{children}</>;

  if (access.isError || sessionFailed) {
    return (
      <ContinueAsScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => {
          if (sessionFailed) {
            setSessionFailed(false);
            setSessionAttempt((n) => n + 1);
          } else {
            void access.refetch();
          }
        }}
        onBack={back}
      />
    );
  }

  switch (decision.kind) {
    case 'allow':
      if (rejoinedFromList && target.kind === 'plan') {
        return (
          <ReattachedNudgeFlow code={target.code} onDone={() => setRejoinedFromList(false)}>
            {children}
          </ReattachedNudgeFlow>
        );
      }
      return <>{children}</>;
    case 'wait':
    case 'needs_session':
      return <ContinueAsScreen state="loading" onBack={back} />;
    case 'needs_saved_place':
      // Not reachable from a `guest` route; guarded against rather than assumed.
      return <ContinueAsScreen state="loading" onBack={back} />;
    case 'join_as_account':
    case 'continue_as':
      if (target.kind === 'circle') {
        // The list and a plan's link are both keyed by a short code, which is
        // what a person arriving from a chat has. A circle page is reached by
        // navigating, not by a link in a chat, and a non-member has no way to
        // learn its code — so the honest answer here is the invite, for an
        // account and a guest alike (ADR 0022 admits through a *plan's* code).
        return (
          <LinkInvalidScreen reason="ask_for_invite" onBack={back} onWhatIsBrand={whatIsBrand} />
        );
      }
      if (decision.kind === 'join_as_account') {
        return <JoinAsAccountFlow code={target.code as ShortCode} onJoined={becameMember} />;
      }
      return (
        <ContinueAsFlow
          code={target.code as ShortCode}
          arrivedWithoutSession={arrivedWithoutSession}
          onReattached={(via) => {
            if (via === 'list') setRejoinedFromList(true);
            becameMember();
          }}
        />
      );
  }
}
