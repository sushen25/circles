import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { hasBackend } from '../../data/auth/client';
import { useCircles } from '../../data/circles';
import { isOffline } from '../identity/join/failure';
import { useSavedPlace } from '../identity/useSavedPlace';
import { CirclesListScreen } from './CirclesListScreen';
import { EmptyCirclesListScreen } from './EmptyCirclesListScreen';
import { listLine } from './lines';

/**
 * `/circles` — every circle the reader is in (spec §5.2), and where a returning
 * organiser lands after signing in.
 *
 * Nothing yet is the first-run variant, with "Create your first circle", which
 * is the plan-first first run (`/circles/new`, ADR 0026). With circles, each
 * row opens that circle's home by its **real id**: the circle route is gated by
 * id (S1-24), and a slug would land a member on "You need the invite link".
 * "New circle" is the full form (`/circles/create`).
 *
 * Read again on every return to the screen, because what a row says — "5 of 6
 * replied" — changes while the reader is elsewhere.
 */
export function CirclesListFlow() {
  return hasBackend() ? <LiveList /> : <FixtureList />;
}

function FixtureList() {
  const router = useRouter();
  return (
    <CirclesListScreen
      onOpen={() => router.push('/circles/sunday-crew')}
      onNewCircle={() => router.push('/circles/create')}
      onAccount={() => router.push('/settings/account')}
      onBack={() => router.back()}
    />
  );
}

function LiveList() {
  const router = useRouter();
  const gate = useSavedPlace();
  const circles = useCircles({ enabled: gate === 'allow' });

  const { refetch } = circles;
  useFocusEffect(
    useCallback(() => {
      if (gate === 'allow') void refetch();
    }, [gate, refetch]),
  );

  const account = () => router.push('/settings/account');

  if (gate === 'wait' || circles.isPending) {
    return <CirclesListScreen state="loading" onAccount={account} />;
  }
  if (circles.isError) {
    return (
      <CirclesListScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void circles.refetch()}
        onAccount={account}
      />
    );
  }

  if (circles.data.length === 0) {
    return (
      <EmptyCirclesListScreen onNext={() => router.push('/circles/new')} onAccount={account} />
    );
  }

  const now = new Date();
  return (
    <CirclesListScreen
      rows={circles.data.map((summary) => ({
        id: summary.id,
        name: summary.name,
        color: summary.color,
        line: listLine(summary, now),
      }))}
      onOpen={(id) => router.push({ pathname: '/circles/[id]', params: { id } })}
      onNewCircle={() => router.push('/circles/create')}
      onAccount={account}
    />
  );
}
