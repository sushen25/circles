import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { guard, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import { finishDraft, firstShare } from '../circles/finishDraft';
import { useOrganiserDraft } from '../circles/useOrganiserDraft';
import { FINISH_PATH } from './afterSignIn';
import { SignInFlow, type GateOutcome } from './SignInFlow';
import { WelcomeScreen } from './WelcomeScreen';
import { WhosAskingScreen } from './WhosAskingScreen';

/**
 * `/circles/new/save` — **Who's asking?** and the code, the organiser gate of
 * the first run (spec §5.1, ADR 0053, ADR 0090). Screens 3 and 4: a first name
 * with an email, then the six digits, and when the code is accepted the name is
 * saved and what was drafted is made, inside the code step. Nothing was created
 * before it, so a person who leaves leaves nothing.
 *
 * It is the ordinary email-and-code sign-in (`SignInFlow`), in its gate form;
 * Apple and Google join it with SUS-77.
 *
 * It needs a draft with a circle's name. Without one (an expired draft, a typed
 * address) it goes back to the first screen. With a saved place already — the
 * person signed in and came back to this screen — it goes straight on.
 *
 * `organiser_gate_shown` is counted once, when the form is drawn for somebody
 * who has to sign in; `organiser_gate_passed` when the code is through. Neither
 * carries anything.
 */
export function SavePlaceFlow() {
  return hasBackend() ? <LiveSavePlace /> : <FixtureSavePlace />;
}

/** No backend: the gallery and the fixture journey, which carry on to the share. */
function FixtureSavePlace() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  return (
    <WhosAskingScreen
      circleName={t('firstPlan', 'sunday_crew')}
      name={name}
      email={email}
      onNameChange={setName}
      onEmailChange={setEmail}
      onSendCode={(go) => go(() => router.push('/circles/sunday-crew/plan/thu-17/shared'))}
      onTerms={() => router.push('/terms')}
      onPrivacy={() => router.push('/privacy')}
      onBack={() => router.back()}
    />
  );
}

function LiveSavePlace() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const { loaded, draft, save } = useOrganiserDraft();
  const signedIn = guard({ route: 'saved', session }).kind === 'allow';
  const shown = useRef(false);
  // Whether the person was signed in when they arrived. Signing in on this very
  // screen flips the session underneath `SignInFlow`, which is already sending
  // them on; only an arrival with a place already saved is sent on from here.
  const [arrivedSignedIn, setArrivedSignedIn] = useState<boolean | undefined>();

  const missing = loaded && (draft === null || draft.circleName.trim() === '');
  const ready = loaded && !missing && !session.isLoading;
  // Adjusted while rendering, so no frame of the form is drawn for somebody who
  // is about to be sent on.
  if (ready && arrivedSignedIn === undefined) setArrivedSignedIn(signedIn);
  const skip = ready && arrivedSignedIn === true;

  useEffect(() => {
    if (missing) router.replace('/circles/new');
  }, [missing, router]);

  // Already signed in, and back on this screen: nothing to ask.
  useEffect(() => {
    if (!skip) return;
    void save({ proceed: true }).then(() => router.replace(FINISH_PATH));
  }, [skip, save, router]);

  useEffect(() => {
    if (!ready || arrivedSignedIn === undefined || skip || shown.current) return;
    shown.current = true;
    track('organiser_gate_shown', {});
  }, [ready, skip, arrivedSignedIn]);

  if (!ready || arrivedSignedIn === undefined || skip || draft === null) {
    return <WelcomeScreen state="loading" />;
  }

  return (
    <SignInFlow
      gate={{
        circle: draft.circleName,
        onBackToPlan: () => router.replace('/circles/new/plan'),
        onPassed: async (): Promise<GateOutcome> => {
          await save({ proceed: true });
          track('organiser_gate_passed', {});
          const outcome = await finishDraft();
          if (outcome.kind === 'no_draft') return { kind: 'go', to: '/circles/new' };
          if (outcome.kind === 'needs_name') return { kind: 'go', to: '/name' };
          void queryClient.invalidateQueries({
            queryKey: ['circle-home', outcome.finished.circleId],
          });
          return { kind: 'go', to: firstShare(outcome.finished) };
        },
      }}
    />
  );
}
