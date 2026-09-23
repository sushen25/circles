import type { IdempotencyKey } from '@circles/contracts';
import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { deviceTimeZone, ownProfile, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { DEFAULT_CIRCLE_COLOR, createCircle, keepInviteSecret } from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { failureOf } from '../identity/join/failure';
import { useSavedPlace } from '../identity/useSavedPlace';
import { CreateCircleScreen, type CreateCircleProblem } from './CreateCircleScreen';
import type { CircleCadence } from './FirstCircleScreen';

/**
 * `/circles/create` — "New circle" on the circles list (spec §5.2), through
 * `create-circle` like the first one, with a colour and an area as well.
 *
 * Made, it goes to its own home — with `replace`, so Back does not return to a
 * form that has already made a circle — where "Invite link" shares it. The
 * secret is held in memory for that (`keepInviteSecret`), never stored.
 *
 * One key per request, as FirstCircle: the same values reuse it, so a tap after
 * a timeout returns the circle the first tap made (ADR 0016).
 */
export function CreateCircleFlow() {
  return hasBackend() ? <LiveCreate /> : <FixtureCreate />;
}

function useForm() {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_CIRCLE_COLOR);
  const [cadence, setCadence] = useState<CircleCadence>('monthly');
  const [area, setArea] = useState('');
  return { name, setName, color, setColor, cadence, setCadence, area, setArea };
}

function FixtureCreate() {
  const router = useRouter();
  const form = useForm();
  return (
    <CreateCircleScreen
      name={form.name}
      color={form.color}
      cadence={form.cadence}
      area={form.area}
      onNameChange={form.setName}
      onColorChange={form.setColor}
      onCadenceChange={form.setCadence}
      onAreaChange={form.setArea}
      onNext={() => router.push('/circles/sunday-crew')}
      onBack={() => router.back()}
    />
  );
}

function LiveCreate() {
  const router = useRouter();
  const session = useSession();
  const queryClient = useQueryClient();
  const gate = useSavedPlace();
  const profile = useQuery({
    queryKey: ['own-profile', session.userId],
    queryFn: ownProfile,
    enabled: gate === 'allow',
    staleTime: 60_000,
  });

  const form = useForm();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CreateCircleProblem | undefined>();
  const key = useRef<{ for: string; key: IdempotencyKey } | undefined>(undefined);
  const inFlight = useRef(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/circles'));

  const create = async () => {
    if (inFlight.current) return;
    const clean = normaliseDisplayName(form.name);
    if (!isValidDisplayName(clean)) {
      setProblem('name_unusable');
      return;
    }
    const area = form.area.trim();
    const request = [clean, form.color, form.cadence, area].join('\n');
    if (key.current?.for !== request) key.current = { for: request, key: newIdempotencyKey() };

    inFlight.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      const known = profile.data !== undefined ? profile.data : (await profile.refetch()).data;
      if (known === undefined) throw new Error('profile unavailable');
      const made = await createCircle({
        name: clean,
        color: form.color,
        cadence: form.cadence,
        area,
        timeZone: known?.zone ?? deviceTimeZone() ?? 'UTC',
        idempotencyKey: key.current.key,
      });
      keepInviteSecret(made.circle.id, made.invite_secret);
      track('circle_created', { circle_id: made.circle.id });
      void queryClient.invalidateQueries({ queryKey: ['circles'] });
      router.replace({ pathname: '/circles/[id]', params: { id: made.circle.id } });
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === 'offline') setProblem('offline');
      else if (failure.kind === 'reason' && failure.reason === 'requires_saved_place') {
        router.replace('/');
      } else if (failure.kind === 'reason' && failure.reason === 'display_name_unusable') {
        setProblem('name_unusable');
      } else if (failure.kind === 'reason' && failure.reason === 'too_many_requests') {
        setProblem('too_many');
      } else setProblem('couldnt_create');
      setBusy(false);
    } finally {
      inFlight.current = false;
    }
  };

  if (gate === 'wait') return <CreateCircleScreen state="loading" onBack={back} />;

  return (
    <CreateCircleScreen
      name={form.name}
      color={form.color}
      cadence={form.cadence}
      area={form.area}
      problem={problem}
      busy={busy}
      onNameChange={(text) => {
        form.setName(text);
        if (problem === 'name_unusable') setProblem(undefined);
      }}
      onColorChange={form.setColor}
      onCadenceChange={form.setCadence}
      onAreaChange={form.setArea}
      onNext={() => void create()}
      onBack={back}
    />
  );
}
