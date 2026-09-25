import type { IdempotencyKey } from '@circles/contracts';
import {
  instant,
  isValidDisplayName,
  normaliseDisplayName,
  startedCircleFromPrompt,
} from '@circles/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { deviceTimeZone, ownProfile, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { DEFAULT_CIRCLE_COLOR, createCircle, keepInviteSecret } from '../../data/circles';
import { newIdempotencyKey } from '../../data/functions';
import { ownNudgeHistory } from '../../data/growth';
import { InitiateGateFlow } from '../growth/InitiateGateFlow';
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
  // A guest in a circle already meets the organiser gate here rather than
  // Welcome: the circle they start keeps the place and the name they have
  // (S2-07). The gate is drawn in place of the form, and the form follows.
  const gate = useSavedPlace({ gateGuests: true });
  // Adjusted while rendering, not in an effect: the gate is the next frame
  // either way, and an effect would draw the form for one frame in between.
  const [gating, setGating] = useState(false);
  if (gate === 'gate' && !gating) setGating(true);
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
      // "Start a circle", the morning after, within 30 days (§11.2's growth
      // row): the prompt's tap is in `nudge_states`, so the credit is read
      // from there rather than carried through a navigation.
      void ownNudgeHistory()
        .then((history) => {
          if (startedCircleFromPrompt(history, instant(Date.now()))) {
            track('guest_started_circle', { circle_id: made.circle.id });
          }
        })
        .catch(() => undefined);
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

  // Held until the gate says it is finished, not only until the session is
  // saved: the gate names the profile after the membership once the save is
  // through, and the circle made next takes its owner's name from there.
  if (gate === 'gate' || gating) {
    return (
      <InitiateGateFlow
        intent="circle"
        onSaved={() => setGating(false)}
        onNotNow={() => {
          setGating(false);
          back();
        }}
      />
    );
  }
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
