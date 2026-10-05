import { fromISO } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { t } from '../../copy';
import { hasBackend } from '../../data/auth/client';
import type { DraftPlan, DraftWay } from '../../data/draft';
import { isOffline } from '../identity/join/failure';
import { useOrganiserDraft } from '../circles/useOrganiserDraft';
import { draftCard } from './draftPlan';
import { FIRST_PLAN_PRESETS } from './firstPlan';
import { FirstPlanScreen } from './FirstPlanScreen';
import { presetAvailable, tonightNote } from './form';
import { useDraftZone } from './useDraftZone';
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
 * **Everything on the card can be changed.** The three "When?" chips are one tap;
 * **Change** on the window, the length and the replies opens the full plan setup
 * (`/circles/new/plan/setup`), which works on the device's draft and sends
 * nothing. The card reads the draft whenever it is seen, so what the setup saved
 * is what it shows.
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
      quorumChangeable={false}
      onChange={() => router.push('/circles/sunday-crew/plan/setup')}
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
  const where = useDraftZone();
  const { loaded, draft, save } = useOrganiserDraft();

  // The moment the card was opened: the preview is of a plan made about now,
  // and a clock read during a render would make it a different plan each time.
  const [openedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const missing = loaded && (draft === null || draft.circleName.trim() === '');
  useEffect(() => {
    if (missing) router.replace('/circles/new');
  }, [missing, router]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/circles/new'));

  if (where.state === 'error') {
    // Not a profile with no zone: the card would be worked out in the device's, and
    // the circle is made in the profile's.
    return (
      <FirstPlanScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={where.retry}
        onBack={back}
      />
    );
  }

  if (!loaded || missing || draft === null || where.state === 'loading') {
    return <FirstPlanScreen state="loading" circleName="" onBack={back} />;
  }

  const zone = where.zone;
  const opened = fromISO(new Date(openedAt).toISOString());
  // A plan that has run out since it was chosen (Tonight, late in the evening; a
  // deadline that has passed) is not kept: the card falls back rather than offer
  // a refusal.
  const { plan, words } = draftCard(draft.plan, zone, openedAt);
  const offTonight = tonightNote(plan.band, plan.duration, opened, zone);

  const go = async (way: DraftWay) => {
    if (busy) return;
    setBusy(true);
    // The whole draft, not a patch: a card left on the back stack after the
    // finish has cleared storage must not write a draft with no circle in it.
    await save({
      circleName: draft.circleName,
      cadence: draft.cadence,
      plan,
      way,
      proceed: where.signedIn,
    });
    router.push(where.signedIn ? '/circles/new/finish' : '/circles/new/save');
    setBusy(false);
  };

  return (
    <FirstPlanScreen
      circleName={draft.circleName}
      presets={FIRST_PLAN_PRESETS.map((each) => ({
        key: each,
        label: presetLabel(each),
        selected: each === plan.preset,
        disabled: !presetAvailable(each, plan.band, plan.duration, opened, zone),
        onPress: () => {
          if (busy) return;
          // A different window brings its own dates and its own default deadline;
          // the kind, the hours and the length stay as they were chosen.
          const next: DraftPlan = { ...plan, preset: each };
          delete next.custom;
          delete next.deadline;
          void save({ plan: next });
        },
      }))}
      presetNote={offTonight === undefined ? undefined : tonightNoteWords(offTonight)}
      window={words.window}
      band={words.band}
      duration={words.duration}
      quorum={t('firstPlan', 'most_of_the_group')}
      quorumChangeable={false}
      closesIn={words.closesIn}
      closesAt={words.closesAt}
      onChange={() => router.push('/circles/new/plan/setup')}
      note={where.signedIn ? undefined : t('firstPlan', 'friends_mark_then_sign_in')}
      offerQuiet={false}
      busy={busy}
      onJustInvite={() => void go('invite')}
      onNext={() => void go('ask')}
      onBack={back}
    />
  );
}
