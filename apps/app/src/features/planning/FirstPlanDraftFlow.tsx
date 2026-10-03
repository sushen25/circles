import { fromISO } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { t } from '../../copy';
import { deviceTimeZone, guard, useSession } from '../../data/auth';
import { hasBackend } from '../../data/auth/client';
import type { DraftPreset, DraftWay } from '../../data/draft';
import { useOrganiserDraft } from '../circles/useOrganiserDraft';
import { FIRST_PLAN_PRESETS, firstPlanPreview } from './firstPlan';
import { firstPlanCardWords } from './firstPlanCard';
import { FirstPlanScreen } from './FirstPlanScreen';
import { tonightNote } from './form';
import { presetLabel, tonightNoteWords } from './words';

/**
 * `/circles/new/plan` — the first plan, drafted before there is a circle
 * (spec §5.1 step 2 of 2, ADR 0053).
 *
 * The same card as `FirstPlanFlow`, worked out from the same rules, over a
 * circle of one in the device's zone with no default of its own — which is what
 * the server will resolve when the circle is made. The quorum is said in words,
 * "Most of the group", because a number is a guess nobody can judge on a circle
 * with one person in it; it follows the people who join (ADR 0026).
 *
 * **Ask the group** and **Just invite people for now** record which one in the
 * draft and go on. Somebody with a saved place goes straight to the finish; a
 * guest, or nobody, goes to **Save your place** — the one gate, after the plan
 * and before it is shared. "See if people are keen instead" is not offered: a
 * brand-new circle has nobody to ask quietly (`nobody_to_ask`).
 */
export function FirstPlanDraftFlow() {
  return hasBackend() ? <LiveFirstPlanDraft /> : <FixtureFirstPlanDraft />;
}

/** No backend: the gallery and the fixture journey, which carry on to Save your place. */
function FixtureFirstPlanDraft() {
  const router = useRouter();
  return (
    <FirstPlanScreen
      presets={FIRST_PLAN_PRESETS.map((each) => ({
        key: each,
        label: presetLabel(each),
        selected: each === 'next_14_days',
        onPress: () => undefined,
      }))}
      quorum={t('firstPlan', 'most_of_the_group')}
      changeable={false}
      note={t('firstPlan', 'friends_mark_then_sign_in')}
      offerQuiet={false}
      onNext={() => router.push('/circles/new/save')}
      onJustInvite={() => router.push('/circles/new/save')}
      onBack={() => router.back()}
    />
  );
}

function LiveFirstPlanDraft() {
  const router = useRouter();
  const session = useSession();
  const signedIn = guard({ route: 'saved', session }).kind === 'allow';
  const { loaded, draft, save } = useOrganiserDraft();

  // The moment the card was opened: the preview is of a plan made about now,
  // and a clock read during a render would make it a different plan each time.
  const [openedAt] = useState(() => Date.now());
  const [preset, setPreset] = useState<DraftPreset | undefined>();
  const [busy, setBusy] = useState(false);

  const missing = loaded && (draft === null || draft.circleName.trim() === '');
  useEffect(() => {
    if (missing) router.replace('/circles/new');
  }, [missing, router]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/circles/new'));

  if (!loaded || missing || draft === null || session.isLoading) {
    return <FirstPlanScreen state="loading" circleName="" onBack={back} />;
  }

  const chosen = preset ?? draft.preset;
  const zone = deviceTimeZone() ?? 'UTC';
  const opened = fromISO(new Date(openedAt).toISOString());
  const input = { zone, defaultDurationMinutes: 120, defaultQuorum: null, members: 1 };
  const preview = firstPlanPreview(input, opened, chosen);
  const words = firstPlanCardWords(preview, chosen, zone, openedAt);
  const offTonight = tonightNote(undefined, preview.durationMinutes, opened, zone);

  const go = async (way: DraftWay) => {
    if (busy) return;
    setBusy(true);
    await save({ preset: chosen, way, proceed: signedIn });
    router.push(signedIn ? '/circles/new/finish' : '/circles/new/save');
    setBusy(false);
  };

  return (
    <FirstPlanScreen
      circleName={draft.circleName}
      presets={FIRST_PLAN_PRESETS.map((each) => ({
        key: each,
        label: presetLabel(each),
        selected: each === chosen,
        disabled: !firstPlanPreview(input, opened, each).available,
        onPress: () => {
          if (busy) return;
          setPreset(each);
          void save({ preset: each });
        },
      }))}
      presetNote={offTonight === undefined ? undefined : tonightNoteWords(offTonight)}
      window={words.window}
      band={words.band}
      duration={words.duration}
      quorum={t('firstPlan', 'most_of_the_group')}
      closesIn={words.closesIn}
      closesAt={words.closesAt}
      changeable={false}
      note={signedIn ? undefined : t('firstPlan', 'friends_mark_then_sign_in')}
      offerQuiet={false}
      busy={busy}
      onJustInvite={() => void go('invite')}
      onNext={() => void go('ask')}
      onBack={back}
    />
  );
}
