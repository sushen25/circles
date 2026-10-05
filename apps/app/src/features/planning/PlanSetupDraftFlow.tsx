import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { samePlan } from '../../data/draft';
import { isOffline } from '../identity/join/failure';
import { useOrganiserDraft } from '../circles/useOrganiserDraft';
import { draftCard, formOf, planOf } from './draftPlan';
import { SetupForm } from './SetupForm';
import { PlanSetupScreen } from './PlanSetupScreen';
import type { FormContext } from './usePlanForm';
import { useDraftZone } from './useDraftZone';

/**
 * `/circles/new/plan/setup` — the full plan setup for a plan that does not exist
 * yet (spec §5.1, ADR 0053): the same screen, controls and validation as
 * `/circles/:id/plan/setup`, over a circle of one.
 *
 * **It reads the device's draft and writes it back, and calls nothing.** There
 * is no circle to read, so there is no `circleHome`; **Save plan** keeps the
 * choices in the draft and returns to the First plan card, and `create-plan`
 * runs at the finish, from whatever the draft holds then.
 *
 * What a circle of one has no answer to is left out rather than disabled: the
 * quorum (the card says "Most of the group", and the server keeps it defaulted,
 * ADR 0026) and the people who must come (nobody else is in the circle).
 *
 * Opening it does not renew the draft's 24 hours; saving a change does.
 */
export function PlanSetupDraftFlow() {
  const router = useRouter();
  const { loaded, draft, save } = useOrganiserDraft();
  const where = useDraftZone();
  // The moment the screen was opened: the setup is of a plan made about now, and a
  // clock read during a render would make it a different plan each time.
  const [openedAt] = useState(() => Date.now());

  const missing = loaded && (draft === null || draft.circleName.trim() === '');
  useEffect(() => {
    if (missing) router.replace('/circles/new');
  }, [missing, router]);

  // Back to the card, which reads the draft again when it is seen.
  const back = () => (router.canGoBack() ? router.back() : router.replace('/circles/new/plan'));

  if (where.state === 'error') {
    return (
      <PlanSetupScreen
        state={isOffline() ? 'offline' : 'error'}
        onRetry={where.retry}
        onBack={back}
      />
    );
  }
  if (!loaded || missing || draft === null || where.state === 'loading') {
    return <PlanSetupScreen state="loading" onBack={back} />;
  }

  // As the card shows it: a window that has gone is not offered to be edited.
  const start = draftCard(draft.plan, where.zone, openedAt).plan;
  const context: FormContext = {
    zone: where.zone,
    people: [],
    me: undefined,
    members: 1,
    quorumShown: 2,
    quorumFollows: true,
    alone: true,
  };

  return (
    <SetupForm
      initial={formOf(start)}
      context={context}
      circleDuration={120}
      now={openedAt}
      freshNow={() => Date.now()}
      startOn="form"
      draft
      onAsk={async (form) => {
        const plan = planOf(form);
        // Only a change is written: saving what is already there must not renew the day.
        if (!samePlan(plan, draft.plan)) await save({ plan });
        back();
      }}
      onBack={back}
    />
  );
}
