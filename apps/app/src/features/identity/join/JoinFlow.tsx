import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { track } from '../../../analytics/track';
import { ensureGuestSession } from '../../../data/auth/guest';
import {
  fetchInvitePreview,
  heldInvite,
  inviteGeneration,
  subscribeInvite,
  takeInviteOpen,
} from '../../../data/membership';
import { LinkInvalidScreen } from '../LinkInvalidScreen';
import { MainScreen } from '../MainScreen';
import { isOffline } from './failure';

/**
 * `/join#<secret>` — somebody tapped a circle invite in a chat (spec §5.1, §6.2).
 *
 * The order is the privacy promise. The fragment is taken out of the address
 * bar before the app has started (`captureInviteFragment`, in the root layout) — so it is
 * not in the history a shared device keeps, not in a screenshot of the URL, and
 * not re-sent anywhere by a copy of the link from this tab. From then on the
 * secret lives in memory only (`holdInvite`), and nothing derived from it goes
 * into a query key, a log or an event.
 */

// On the web the held invite changes only by a page load. In the app a second
// invite can arrive while this page is open (S3-01a), so the page listens.
const clientInvite = (): string | null => heldInvite() ?? null;
const serverInvite = (): undefined => undefined;

export function JoinFlow() {
  const router = useRouter();

  /**
   * `undefined` while hydrating, then the held invite or `null`.
   *
   * `index.ts` took the secret out of the fragment before the router started
   * (`captureInviteFragment`). The server rendered this page with no `window`
   * and no invite, and a first client render that disagreed would be a
   * hydration error in front of the one page that must not look broken — so
   * the server snapshot is `undefined`, and React swaps in the client's answer
   * once hydration is done.
   */
  const secret = useSyncExternalStore(subscribeInvite, clientInvite, serverInvite);

  useEffect(() => {
    if (typeof secret === 'string' && takeInviteOpen()) track('circle_join_opened', {});
  }, [secret]);

  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);

  const preview = useQuery({
    // No secret in the key. The cache, devtools and any error report read keys,
    // and there is only ever one invite in hand per tab.
    // The generation tells a second invite from the first without naming it.
    queryKey: ['invite-preview', inviteGeneration()],
    queryFn: () => fetchInvitePreview(secret as string),
    enabled: typeof secret === 'string',
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const whatIsBrand = () => router.push('/get-the-app');

  if (secret === undefined) return <MainScreen state="loading" onBack={back} />;

  if (secret === null) {
    return <LinkInvalidScreen reason="open_again" onBack={back} onWhatIsBrand={whatIsBrand} />;
  }

  if (preview.isError || startFailed) {
    return (
      <MainScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => {
          setStartFailed(false);
          void preview.refetch();
        }}
        onBack={back}
      />
    );
  }

  if (preview.isPending) return <MainScreen state="loading" onBack={back} />;

  if (preview.data === null) {
    return <LinkInvalidScreen reason="inactive" onBack={back} onWhatIsBrand={whatIsBrand} />;
  }

  const { circle_name, inviter_name, member_initials } = preview.data;

  return (
    <MainScreen
      invite={{
        circleName: circle_name,
        inviterName: inviter_name,
        memberInitials: member_initials,
      }}
      busy={starting}
      onBack={back}
      onWhatIsBrand={whatIsBrand}
      onNext={() => {
        // "Choose my times creates an anonymous session tied to that browser and
        // asks for a display name" (§5.1). The session first, so the Name step
        // has one to redeem with; idempotent, so a returning guest keeps theirs.
        setStarting(true);
        ensureGuestSession()
          .then(() => router.push('/join/name'))
          .catch(() => setStartFailed(true))
          .finally(() => setStarting(false));
      }}
    />
  );
}
