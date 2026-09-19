import { ReentryLink } from '@circles/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../../analytics/track';
import { hasBackend } from '../../../data/auth/client';
import { sessionState, signOut } from '../../../data/auth/session';
import { newIdempotencyKey } from '../../../data/functions';
import { heldToken } from '../../../data/links/tokens';
import { arrivalFor, reattachWithToken } from '../../../data/membership';
import { ContinueAsScreen } from '../ContinueAsScreen';
import { LinkInvalidScreen, type LinkInvalidReason } from '../LinkInvalidScreen';
import { failureOf } from './failure';

/**
 * `/a#<token>` — the link in every plan-update email (spec §5.1, ADR 0006). The
 * token is in the fragment and was taken out of the address bar by the entry
 * point before the router loaded (ADR 0023); `heldToken` is where it waits.
 *
 * The same reattachment Continue-as makes, authorised by a single-use token
 * instead of by a pick from the list, so the person never sees the list at all.
 * Then on to the plan that is asking for their times, or the circle.
 *
 * Every failure but one reads the same — "this link has expired, open the plan
 * from the chat" — because the token is unknown, spent or old, and the chat
 * still has a link that works. The exception is a membership that has since
 * saved its place: that link is not broken, it is a link to an account.
 */
export function ReentryFlow({ token = heldToken('reentry') }: { token?: string | undefined } = {}) {
  const router = useRouter();
  const [failed, setFailed] = useState<LinkInvalidReason | undefined>();
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);
  // One key for this link's one attempt. A re-render, or React running the
  // effect twice in development, must not send a second request that the server
  // would treat as a second use of a single-use token.
  const [key] = useState(newIdempotencyKey);

  const parsed = ReentryLink.safeParse({ token });

  useEffect(() => {
    if (!hasBackend() || !parsed.success || started.current === attempt) return;
    started.current = attempt;

    // Read before the call: a saved place that the link names is let straight
    // through, and nothing was reattached for the funnel to count.
    const alreadySaved = sessionState().status === 'saved' || sessionState().status === 'app';

    reattachWithToken(parsed.data.token, key)
      .then(async (moved) => {
        if (!alreadySaved) track('member_reattached', { source: 'email' });
        const arrival = await arrivalFor(moved.circle.id).catch(() => ({
          kind: 'circle' as const,
          id: moved.circle.id,
        }));
        // `replace`: the token is spent, and Back should not return to it.
        if (arrival.kind === 'plan') {
          router.replace({ pathname: '/j/[code]', params: { code: arrival.code } });
        } else {
          router.replace({ pathname: '/circles/[id]', params: { id: arrival.id } });
        }
      })
      .catch((error: unknown) => {
        const failure = failureOf(error);
        // No connection is not an expired link. The same key goes again on retry,
        // so an attempt that did land is answered from the record, not re-spent.
        if (failure.kind === 'offline') {
          setOffline(true);
          return;
        }
        // Signed in, and not as the account this link names — the right account
        // is let through by `reattach_member` itself (architecture §10). A saved
        // place cannot take a guest membership, so the way to use the link is to
        // sign out here, and that is the person's call, not the page's.
        if (failure.kind === 'reason' && failure.reason === 'caller_is_permanent') {
          setFailed('other_account');
          return;
        }
        setFailed(
          failure.kind === 'reason' && failure.reason === 'target_is_permanent'
            ? 'account'
            : 'expired',
        );
      });
  }, [parsed.success, parsed.data?.token, key, router, attempt]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const whatIsBrand = () => router.push('/get-the-app');

  if (!hasBackend() || !parsed.success || failed !== undefined) {
    return (
      <LinkInvalidScreen
        reason={failed ?? 'expired'}
        onSignIn={() => router.replace('/sign-in')}
        onSignOut={() => {
          void signOut().then(() => {
            setFailed(undefined);
            setAttempt((n) => n + 1);
          });
        }}
        onBack={back}
        onWhatIsBrand={whatIsBrand}
      />
    );
  }

  if (offline) {
    return (
      <ContinueAsScreen
        state="offline"
        onRetry={() => {
          setOffline(false);
          setAttempt((n) => n + 1);
        }}
        onBack={back}
      />
    );
  }

  return <ContinueAsScreen state="loading" onBack={back} />;
}
