import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';

import { deviceTimeZone, ownProfile, saveProfile, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { belongsToAnyCircle } from '../../data/circles';
import { afterNaming } from './afterSignIn';
import { isOffline } from './join/failure';
import { TimeZoneScreen } from './TimeZoneScreen';
import { useSavedPlace } from './useSavedPlace';
import { YourNameScreen, type YourNameProblem } from './YourNameScreen';
import { filterZones, groupZones, supportedZones, zoneLabel } from './zones';

/**
 * `/name` — what friends call you, and your time zone (spec §5.1 step 3).
 *
 * The name is the first of the flow's two typed inputs. The zone is the
 * device's, already chosen; "Change" opens the picker, and nothing about it
 * asks for a permission. Both are saved to `profiles` together, then the person
 * goes on to their circles, or to their first one.
 */
export function YourNameFlow() {
  return hasBackend() ? <LiveYourName /> : <FixtureYourName />;
}

/** No backend: the gallery and the fixture journey, which carry on to FirstCircle. */
function FixtureYourName() {
  const router = useRouter();
  return (
    <YourNameScreen
      onNext={() => router.push('/circles/new')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}

function LiveYourName() {
  const router = useRouter();
  const session = useSession();
  const gate = useSavedPlace();

  const profile = useQuery({
    queryKey: ['own-profile', session.userId],
    queryFn: ownProfile,
    enabled: gate === 'allow',
    staleTime: 0,
  });

  const device = deviceTimeZone();
  const [typed, setTyped] = useState<string | undefined>();
  const [chosenZone, setChosenZone] = useState<string | undefined>();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<YourNameProblem | undefined>();
  const saving = useRef(false);

  const name = typed ?? profile.data?.name ?? '';
  const zone = chosenZone ?? profile.data?.zone ?? device ?? 'UTC';
  const groups = useMemo(() => groupZones(supportedZones(), zone), [zone]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (gate === 'wait' || profile.isPending) {
    return <YourNameScreen state="loading" onBack={back} />;
  }
  if (profile.isError) {
    return (
      <YourNameScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={() => void profile.refetch()}
        onBack={back}
      />
    );
  }

  if (picking) {
    return (
      <TimeZoneScreen
        groups={filterZones(groups, query)}
        selected={zone}
        query={query}
        onQueryChange={setQuery}
        onPick={(picked) => {
          setChosenZone(picked);
          setPicking(false);
          setQuery('');
        }}
        onBack={() => setPicking(false)}
      />
    );
  }

  const save = async () => {
    if (saving.current) return;
    const clean = normaliseDisplayName(name);
    if (!isValidDisplayName(clean)) {
      setProblem('name_unusable');
      return;
    }
    saving.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      await saveProfile({ name: clean, zone });
    } catch {
      setProblem(isOffline() ? 'offline' : 'couldnt_save');
      setBusy(false);
      saving.current = false;
      return;
    }
    let hasCircles = false;
    try {
      hasCircles = await belongsToAnyCircle();
    } catch {
      // Not knowing sends them to make a first circle, which is where a new
      // organiser is going anyway; their circles are one tap from there.
    }
    router.replace(afterNaming(hasCircles));
  };

  return (
    <YourNameScreen
      name={name}
      zoneLabel={zoneLabel(zone)}
      zoneFromDevice={zone === device}
      problem={problem}
      busy={busy}
      onNameChange={(text) => {
        setTyped(text);
        if (problem === 'name_unusable') setProblem(undefined);
      }}
      onChangeZone={() => setPicking(true)}
      onNext={() => void save()}
      onBack={back}
    />
  );
}
