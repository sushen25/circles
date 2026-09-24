import type { Outcome } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import type { PlanConfirmation } from '../../data/confirmation';
import { outcomeStageOf, morningAfterWords } from './morningAfter';
import { OutcomeScreen } from './OutcomeScreen';
import { useReportOutcome } from './useMorningAfter';

/**
 * "Did Thursday's catch-up happen?", for the organiser (spec §5.10).
 *
 * Save reports it and goes to the circle, whose "Last caught up" is then the
 * evening they just said happened — or unchanged, for any other answer. The
 * circle, not Back: the screen underneath is often the confirmed one, which
 * would only say the time has passed.
 */
export function OrganiserOutcome({ data, queryKey }: { data: PlanConfirmation; queryKey: string }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Outcome>();
  const [note, setNote] = useState('');

  const toCircle = () =>
    router.dismissTo({ pathname: '/circles/[id]', params: { id: data.circleId } });
  const back = () => (router.canGoBack() ? router.back() : toCircle());
  const report = useReportOutcome(data, queryKey, toCircle);

  const stage = outcomeStageOf(data);
  const words = morningAfterWords(data);

  return (
    <OutcomeScreen
      state={stage === 'ask' ? 'default' : stage}
      words={words}
      choice={choice}
      onChoose={setChoice}
      note={note}
      onNote={setNote}
      busy={report.busy}
      notice={report.notice}
      onSave={() => {
        if (choice !== undefined) report.save(choice, note);
      }}
      onToCircle={toCircle}
      onBack={back}
    />
  );
}
