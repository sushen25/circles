import type { IdempotencyKey } from '@circles/contracts';
import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { deviceTimeZone, ownProfile, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { createCircle, keepInviteSecret } from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { failureOf } from '../identity/join/failure';
import { useSavedPlace } from '../identity/useSavedPlace';
import {
  FirstCircleScreen,
  type CircleCadence,
  type FirstCircleProblem,
} from './FirstCircleScreen';

/**
 * `/circles/new` — the first circle (spec §5.1 step 4), through `create-circle`.
 *
 * On success the invite secret is held in memory for the next screen and the
 * person is sent on to invite the circle, with `replace`, so Back does not
 * return to a form that has already made a circle.
 *
 * **One key per request.** A retry of the same name and cadence reuses the
 * key, so a tap after a timeout returns the circle the first one made; a
 * different name is a different request and gets a new one (ADR 0016).
 */
export function FirstCircleFlow() {
  return hasBackend() ? <LiveFirstCircle /> : <FixtureFirstCircle />;
}

function FixtureFirstCircle() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<CircleCadence>('monthly');
  return (
    <FirstCircleScreen
      name={name}
      cadence={cadence}
      onNameChange={setName}
      onCadenceChange={setCadence}
      onNext={() => router.push('/circles/sunday-crew/invite')}
      onBack={() => router.back()}
    />
  );
}

const REASONS: Record<string, FirstCircleProblem> = {
  display_name_unusable: 'name_unusable',
  too_many_requests: 'too_many_tries',
};

function LiveFirstCircle() {
  const router = useRouter();
  const session = useSession();
  const gate = useSavedPlace();
  const profile = useQuery({
    queryKey: ['own-profile', session.userId],
    queryFn: ownProfile,
    enabled: gate === 'allow',
    staleTime: 60_000,
  });

  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<CircleCadence>('monthly');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FirstCircleProblem | undefined>();
  const [reference, setReference] = useState<string | undefined>();
  const key = useRef<{ for: string; key: IdempotencyKey } | undefined>(undefined);
  const inFlight = useRef(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const create = async () => {
    if (inFlight.current) return;
    const clean = normaliseDisplayName(name);
    if (!isValidDisplayName(clean)) {
      setProblem('name_unusable');
      return;
    }
    const request = `${clean}\n${cadence}`;
    if (key.current?.for !== request) key.current = { for: request, key: newIdempotencyKey() };

    inFlight.current = true;
    setBusy(true);
    setProblem(undefined);
    setReference(undefined);
    try {
      // The zone the person confirmed on Your name — read before anything is
      // made, never guessed while the read is still out (review round 1). Only
      // a profile that has never chosen one falls back to this device's.
      const known = profile.data !== undefined ? profile.data : (await profile.refetch()).data;
      if (known === undefined) throw new Error('profile unavailable');
      const made = await createCircle({
        name: clean,
        cadence,
        timeZone: known?.zone ?? deviceTimeZone() ?? 'UTC',
        idempotencyKey: key.current.key,
      });
      keepInviteSecret(made.circle.id, made.invite_secret);
      track('circle_created', { circle_id: made.circle.id });
      router.replace({ pathname: '/circles/[id]/invite', params: { id: made.circle.id } });
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === 'offline') {
        setProblem('offline');
      } else if (failure.kind === 'reason' && failure.reason === 'requires_saved_place') {
        // The session stopped being a saved place underneath the screen.
        router.replace('/');
      } else if (failure.kind === 'reason' && REASONS[failure.reason] !== undefined) {
        setProblem(REASONS[failure.reason]);
      } else {
        setProblem('couldnt_create');
        setReference(failure.reference);
      }
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  if (gate === 'wait') return <FirstCircleScreen state="loading" onBack={back} />;

  return (
    <FirstCircleScreen
      name={name}
      cadence={cadence}
      problem={problem}
      reference={reference}
      busy={busy}
      onNameChange={(text) => {
        setName(text);
        if (problem === 'name_unusable') setProblem(undefined);
      }}
      onCadenceChange={setCadence}
      onNext={() => void create()}
      onBack={back}
    />
  );
}
