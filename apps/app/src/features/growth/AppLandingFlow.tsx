import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { hasBackend } from '../../data/auth/client';
import { ownDisplayName } from '../../data/auth';
import { useCircles } from '../../data/circles';
import { useFixture } from '../../data/fixtures/useFixture';
import { listLine } from '../circles/lines';
import { isOffline } from '../identity/join/failure';
import { useSavedPlace } from '../identity/useSavedPlace';
import { AppLandingScreen } from './AppLandingScreen';

/**
 * `/get-the-app/welcome` — the installed app's first open, signed in (S3-01a).
 * Sign-in sends somebody here once, on the sign-in `mark-app-installed` said
 * was the first (`destinationAfterSignIn`), and only when they are in a circle
 * already: a first circle is the first run's to make, not this screen's.
 *
 * Their circles are the circles list's, with the same state lines
 * (`listLine`), so the two can never describe one circle differently.
 */
export function AppLandingFlow() {
  return hasBackend() ? <LiveLanding /> : <FixtureLanding />;
}

function FixtureLanding() {
  const router = useRouter();
  const fixture = useFixture();
  return <AppLandingScreen fixture={fixture} onBack={() => router.back()} />;
}

function LiveLanding() {
  const router = useRouter();
  const gate = useSavedPlace();
  const circles = useCircles({ enabled: gate === 'allow' });
  const name = useQuery({
    queryKey: ['own-display-name'],
    queryFn: ownDisplayName,
    enabled: gate === 'allow',
    staleTime: 60_000,
  });

  const open = (id: string) => router.replace({ pathname: '/circles/[id]', params: { id } });

  if (gate !== 'allow' || circles.isPending) return <AppLandingScreen state="loading" />;
  if (circles.isError) {
    return (
      <AppLandingScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void circles.refetch()}
      />
    );
  }

  const now = new Date();
  const rows = circles.data
    .filter((summary) => summary.status !== 'archived')
    .map((summary) => ({
      id: summary.id,
      name: summary.name,
      color: summary.color,
      line: listLine(summary, now),
    }));
  const first = rows[0];

  return (
    <AppLandingScreen
      name={name.data ?? null}
      rows={rows}
      onOpen={open}
      onNext={() => (first === undefined ? router.replace('/circles') : open(first.id))}
    />
  );
}
