import { fromISO } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { track } from '../../analytics/track';
import { t } from '../../copy';
import { deviceTimeZone, guard, useSession } from '../../data/auth';
import { useOrganiserDraft } from '../circles/useOrganiserDraft';
import { firstPlanPreview } from '../planning/firstPlan';
import { firstPlanCardWords } from '../planning/firstPlanCard';
import { FINISH_PATH } from './afterSignIn';
import { hasBackend } from '../../data/auth/client';
import { SignInFlow } from './SignInFlow';
import { SignInScreen } from './SignInScreen';
import { WelcomeScreen } from './WelcomeScreen';

/**
 * `/circles/new/save` — **Save your place**, the organiser gate of the first run
 * (spec §5.1, ADR 0053). After the plan is drafted and before it is shared: "Your
 * plan's ready. Save your place", with the plan summarised so that nothing feels
 * lost. It is the ordinary email-and-code sign-in (`SignInFlow`), in its gate
 * wording; Apple and Google join it with SUS-77.
 *
 * It needs a draft with a way chosen. Without one (an expired draft, a typed
 * address) it goes back to the first circle. With a saved place already — the
 * person signed in and came back to this screen — it goes straight on.
 *
 * `organiser_gate_shown` is counted once, when the form is drawn for somebody
 * who has to sign in; `organiser_gate_passed` when the code is through. Neither
 * carries anything.
 */
export function SavePlaceFlow() {
  return hasBackend() ? <LiveSavePlace /> : <FixtureSavePlace />;
}

/** No backend: the gallery and the fixture journey, which carry on to Your name. */
function FixtureSavePlace() {
  const router = useRouter();
  return (
    <SignInScreen
      place={{
        circle: t('firstPlan', 'sunday_crew'),
        kind: 'plan',
        title: t('firstPlan', 'catch_up_next_14_days'),
        detail: t('savePlace', 'detail', {
          band: t('firstPlan', 'evenings_and_weekend_days'),
          duration: t('firstPlan', 'about_2_hours'),
          closes: t('firstPlan', 'tue_15_sep_6_pm'),
        }),
      }}
      onNext={() => router.push('/name')}
      onTerms={() => router.push('/terms')}
      onPrivacy={() => router.push('/privacy')}
      onBack={() => router.back()}
    />
  );
}

function LiveSavePlace() {
  const router = useRouter();
  const session = useSession();
  const { loaded, draft, save } = useOrganiserDraft();
  const signedIn = guard({ route: 'saved', session }).kind === 'allow';
  const shown = useRef(false);
  // Whether the person was signed in when they arrived. Signing in on this very
  // screen flips the session underneath `SignInFlow`, which is already sending
  // them on; only an arrival with a place already saved is sent on from here.
  const [arrivedSignedIn, setArrivedSignedIn] = useState<boolean | undefined>();
  // The moment this screen was opened: the plan's words are about then.
  const [openedAt] = useState(() => Date.now());

  const missing = loaded && (draft === null || draft.way === undefined);
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

  const place = useMemo(() => {
    if (draft === null || draft.way === undefined) return undefined;
    if (draft.way === 'invite') {
      return {
        circle: draft.circleName,
        kind: 'invite' as const,
        title: draft.circleName,
        detail: t('savePlace', 'just_the_invite'),
      };
    }
    const zone = deviceTimeZone() ?? 'UTC';
    const now = openedAt;
    const preview = firstPlanPreview(
      { zone, defaultDurationMinutes: 120, defaultQuorum: null, members: 1 },
      fromISO(new Date(now).toISOString()),
      draft.preset,
    );
    const words = firstPlanCardWords(preview, draft.preset, zone, now);
    return {
      circle: draft.circleName,
      kind: 'plan' as const,
      title: words.window,
      detail: t('savePlace', 'detail', {
        band: words.band,
        duration: words.duration,
        closes: words.closesAt,
      }),
    };
  }, [draft, openedAt]);

  if (!ready || arrivedSignedIn === undefined || skip || place === undefined)
    return <WelcomeScreen state="loading" />;

  return (
    <SignInFlow
      gate={{
        place,
        onPassed: async () => {
          await save({ proceed: true });
          track('organiser_gate_passed', {});
        },
      }}
    />
  );
}
