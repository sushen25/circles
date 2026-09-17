import { ShortCode } from '@circles/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';

import { hasBackend } from '../../../data/auth/client';
import { ensureGuestSession } from '../../../data/auth/guest';
import { guard, type Membership } from '../../../data/auth/guards';
import { useSession } from '../../../data/auth/session';
import { circleAccess, planAccess } from '../../../data/membership';
import { ContinueAsScreen } from '../ContinueAsScreen';
import { LinkInvalidScreen } from '../LinkInvalidScreen';
import { ContinueAsFlow } from './ContinueAsFlow';
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

  const code = target.kind === 'plan' ? ShortCode.safeParse(target.code) : undefined;
  const malformed = code !== undefined && !code.success;

  const accessKey = ['membership', target.kind, target.kind === 'plan' ? target.code : target.id];
  const access = useQuery({
    queryKey: [...accessKey, session.userId],
    queryFn: async (): Promise<Membership> => {
      const answer =
        target.kind === 'plan'
          ? await planAccess(target.code as ShortCode)
          : await circleAccess(target.id);
      return answer.membership;
    },
    enabled: !malformed && !session.isLoading && session.status !== 'none',
    staleTime: 30_000,
  });

  const decision = guard({
    route: 'guest',
    session,
    membership: access.data ?? 'unknown',
  });

  // §10: the session comes first. Continue-as cannot even ask who is in the
  // circle without one, and `ensureGuestSession` is idempotent, so the effect
  // re-running on a re-render cannot mint a second identity.
  useEffect(() => {
    if (decision.kind !== 'needs_session' || malformed || sessionFailed) return;
    ensureGuestSession().catch(() => setSessionFailed(true));
  }, [decision.kind, malformed, sessionFailed, sessionAttempt]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const whatIsBrand = () => router.push('/get-the-app');

  if (malformed) {
    return <LinkInvalidScreen reason="ask_for_invite" onBack={back} onWhatIsBrand={whatIsBrand} />;
  }

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
      return <>{children}</>;
    case 'wait':
    case 'needs_session':
      return <ContinueAsScreen state="loading" onBack={back} />;
    case 'needs_saved_place':
      // Not reachable from a `guest` route; guarded against rather than assumed.
      return <ContinueAsScreen state="loading" onBack={back} />;
    case 'continue_as':
      if (target.kind === 'circle') {
        // The list is keyed by a short code, which is what a person arriving from
        // a link has. A circle page is reached by navigating, not by a link in a
        // chat, and a non-member has no way to learn its code — so the honest
        // answer here is the invite.
        return (
          <LinkInvalidScreen reason="ask_for_invite" onBack={back} onWhatIsBrand={whatIsBrand} />
        );
      }
      return (
        <ContinueAsFlow
          code={target.code as ShortCode}
          onReattached={() => void queryClient.invalidateQueries({ queryKey: accessKey })}
        />
      );
  }
}
