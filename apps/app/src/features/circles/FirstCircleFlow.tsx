import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { guard, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { useOrganiserDraft } from './useOrganiserDraft';
import {
  FirstCircleScreen,
  type CircleCadence,
  type FirstCircleProblem,
} from './FirstCircleScreen';

/**
 * `/circles/new`, and `/` for somebody with no saved place — the first circle
 * (spec §5.1 step 1 of 2).
 *
 * **Nothing is created here, and nobody has to sign in** (ADR 00YY). The name
 * and the cadence are held on this device as a draft, and the circle is made
 * after the plan is ready and the place is saved (`FinishDraftFlow`). So there
 * is no gate on this route: anybody can type a circle's name, and the organiser
 * gate is the screen after the plan.
 *
 * Somebody with no saved place is at the front of the product, and sees the
 * wordmark and a quiet **Sign in** for a returning organiser. A signed-in
 * organiser arrives from their circles list and sees the same form with a way
 * back.
 *
 * The draft is written as the name is typed (after a pause) and when the person
 * moves on, so a reload, or the round trip to an email code, brings it back.
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
      onNext={() => router.push('/circles/new/plan')}
      onSignIn={() => router.push('/sign-in')}
    />
  );
}

/** How long a typed name waits for the next keystroke before it is written down. */
const SAVE_AFTER_MS = 300;

function LiveFirstCircle() {
  const router = useRouter();
  const session = useSession();
  const signedIn = guard({ route: 'saved', session }).kind === 'allow';
  const { loaded, draft, save } = useOrganiserDraft();

  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<CircleCadence>('monthly');
  const [problem, setProblem] = useState<FirstCircleProblem | undefined>();
  const hydrated = useRef(false);
  const typedBeforeLoad = useRef(false);

  // What was typed before a reload comes back, once, unless the person has
  // already started typing again.
  useEffect(() => {
    if (!loaded || hydrated.current) return;
    hydrated.current = true;
    if (draft === null || typedBeforeLoad.current) return;
    setName(draft.circleName);
    setCadence(draft.cadence);
  }, [loaded, draft]);

  // Written after the person pauses. Nothing is written for an empty form that
  // has no draft behind it, so a visitor who only looked leaves nothing.
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!hydrated.current) return;
    if (name.trim() === '' && draft === null) return;
    pending.current = setTimeout(() => void save({ circleName: name, cadence }), SAVE_AFTER_MS);
    return () => clearTimeout(pending.current);
    // `draft` is not a dependency: writing it would write again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, cadence, loaded]);

  const next = async () => {
    const clean = normaliseDisplayName(name);
    if (!isValidDisplayName(clean)) {
      setProblem('name_unusable');
      return;
    }
    clearTimeout(pending.current);
    await save({ circleName: clean, cadence });
    router.push('/circles/new/plan');
  };

  return (
    <FirstCircleScreen
      name={name}
      cadence={cadence}
      problem={problem}
      onNameChange={(text) => {
        typedBeforeLoad.current = true;
        setName(text);
        if (problem === 'name_unusable') setProblem(undefined);
      }}
      onCadenceChange={(value) => {
        typedBeforeLoad.current = true;
        setCadence(value);
      }}
      onNext={() => void next()}
      onBack={
        signedIn ? () => (router.canGoBack() ? router.back() : router.replace('/')) : undefined
      }
      onSignIn={signedIn ? undefined : () => router.push('/sign-in')}
    />
  );
}
