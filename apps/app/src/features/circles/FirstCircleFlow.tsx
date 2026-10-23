import { isValidDisplayName, normaliseDisplayName } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { guard, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { useOrganiserDraft } from './useOrganiserDraft';
import { FirstCircleScreen, type FirstCircleProblem } from './FirstCircleScreen';

/**
 * `/circles/new`, and `/` for somebody with no saved place — screen 1 of the
 * first run (spec §5.1, SUS-247): who the plan is for.
 *
 * **Nothing is created here, and nobody has to sign in** (ADR 0053). The name is
 * held on this device as a draft, and the circle is made after the code is
 * accepted (`finishDraft`). So there is no gate on this route: anybody can type
 * a group's name, and the organiser gate is two screens on.
 *
 * Somebody with no saved place is at the front of the product, and sees the
 * wordmark and a quiet **Sign in** for a returning organiser, with "1 of 3". A
 * signed-in organiser arrives from their circles list and sees the same screen
 * with a way back and "1 of 2": they have no gate to pass.
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
  return (
    <FirstCircleScreen
      name={name}
      onNameChange={setName}
      onNext={(go) => go(() => router.push('/circles/new/plan'))}
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
  const [problem, setProblem] = useState<FirstCircleProblem | undefined>();
  const hydrated = useRef(false);
  const typedBeforeLoad = useRef(false);
  // Only an edit is written: reopening the form with a draft must not renew it.
  const edited = useRef(false);

  // What was typed before a reload comes back, once, unless the person has
  // already started typing again.
  useEffect(() => {
    if (!loaded || hydrated.current) return;
    hydrated.current = true;
    if (draft === null || typedBeforeLoad.current) return;
    setName(draft.circleName);
  }, [loaded, draft]);

  // Written after the person pauses. Nothing is written for an empty form that
  // has no draft behind it, so a visitor who only looked leaves nothing.
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!hydrated.current || !edited.current) return;
    if (name.trim() === '' && draft === null) return;
    pending.current = setTimeout(() => void save({ circleName: name }), SAVE_AFTER_MS);
    return () => clearTimeout(pending.current);
    // `draft` is not a dependency: writing it would write again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, loaded]);

  const next = async (go: (navigate: () => void) => void) => {
    const clean = normaliseDisplayName(name);
    if (!isValidDisplayName(clean)) {
      setProblem('name_unusable');
      return;
    }
    clearTimeout(pending.current);
    await save({ circleName: clean });
    go(() => router.push('/circles/new/plan'));
  };

  return (
    <FirstCircleScreen
      name={name}
      problem={problem}
      steps={signedIn ? 2 : 3}
      onNameChange={(text) => {
        typedBeforeLoad.current = true;
        edited.current = true;
        setName(text);
        if (problem === 'name_unusable') setProblem(undefined);
      }}
      onNext={(go) => void next(go)}
      onBack={
        signedIn ? () => (router.canGoBack() ? router.back() : router.replace('/')) : undefined
      }
      onSignIn={signedIn ? undefined : () => router.push('/sign-in')}
    />
  );
}
