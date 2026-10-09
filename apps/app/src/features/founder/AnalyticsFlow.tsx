import {
  emptyFounderAnalytics,
  founderAnalyticsFixture,
  sinceFor,
  type FounderPeriod,
} from '@circles/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { reportClientError } from '../../analytics/clientError';
import { useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { NotFounderError, fetchFounderAnalytics, founderKeys } from '../../data/founder';
import { isOffline } from '../identity/join/failure';
import { AnalyticsScreen } from './AnalyticsScreen';

/**
 * `/founder/analytics`. Behind the allowlist, which is the database's: the
 * function refuses everybody else, and a refusal (or no saved account at all)
 * is the not-found screen and nothing that says the route is there.
 *
 * Nothing is tracked: viewing this would only count the founder.
 */
export function AnalyticsFlow() {
  return hasBackend() ? <LiveAnalytics /> : <FixtureAnalytics />;
}

/** No backend (the smoke build): the scenario's own numbers, to try the screen. */
function FixtureAnalytics() {
  const router = useRouter();
  const [period, setPeriod] = useState<FounderPeriod>(30);
  return (
    <AnalyticsScreen
      data={period === 7 ? emptyFounderAnalytics : founderAnalyticsFixture}
      period={period}
      onPeriod={setPeriod}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}

function LiveAnalytics() {
  const router = useRouter();
  const session = useSession();
  const [period, setPeriod] = useState<FounderPeriod>(30);
  // A day's resolution, so the key does not change under a screen left open.
  const since = useMemo(() => sinceFor(period, new Date()), [period]);
  const signedIn = !session.isLoading && (session.status === 'saved' || session.status === 'app');

  const query = useQuery({
    queryKey: founderKeys.analytics(session.userId, since),
    queryFn: () => fetchFounderAnalytics(since),
    enabled: signedIn,
    staleTime: 0,
    retry: (count, error) => !(error instanceof NotFounderError) && count < 2,
    // The last period's numbers while the next arrives, and only for the same
    // person: another account signing in on this tab must not be shown the
    // previous one's answer while its own is on the way (review round 1).
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === session.userId ? previous : undefined,
  });
  const reference = useMemo(
    () =>
      query.isError && !(query.error instanceof NotFounderError)
        ? reportClientError('boundary', query.error)
        : undefined,
    [query.isError, query.error],
  );

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (session.isLoading) return <AnalyticsScreen state="loading" onBack={back} />;
  // Somebody with no saved place cannot be on the allowlist: no question to ask.
  if (!signedIn || query.error instanceof NotFounderError) {
    return <AnalyticsScreen state="denied" />;
  }
  // Asked but not sent, because the browser is offline: not a wait to sit through.
  if (query.fetchStatus === 'paused' && query.data === undefined) {
    return <AnalyticsScreen state="offline" onRetry={() => void query.refetch()} onBack={back} />;
  }
  if (query.isPending) return <AnalyticsScreen state="loading" onBack={back} />;
  if (query.isError && query.data === undefined) {
    return (
      <AnalyticsScreen
        state={isOffline() ? 'offline' : 'error'}
        reference={reference}
        onRetry={() => void query.refetch()}
        onBack={back}
      />
    );
  }
  return <AnalyticsScreen data={query.data} period={period} onPeriod={setPeriod} onBack={back} />;
}
