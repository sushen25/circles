import type { Outcome } from '@circles/domain';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import type { PlanConfirmation } from '../../data/confirmation';
import { attendanceStageOf, morningAfterWords, outcomeStageOf } from './morningAfter';
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
  const [changed, setChanged] = useState<boolean>();

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
      onChoose={(outcome) => {
        setChoice(outcome);
        // Moved outside the app is a plan that changed outside it; the
        // organiser can still say otherwise.
        if (outcome === 'moved_outside' && changed === undefined) setChanged(true);
      }}
      changed={changed}
      onChanged={setChanged}
      note={note}
      onNote={setNote}
      busy={report.busy}
      notice={report.notice}
      onSave={() => {
        if (choice !== undefined && changed !== undefined) report.save(choice, changed, note);
      }}
      onOwnAttendance={
        stage === 'answered' && attendanceStageOf(data).kind === 'ask'
          ? () => router.push({ pathname: '/p/[code]/attendance', params: { code: data.code } })
          : undefined
      }
      onToCircle={toCircle}
      onBack={back}
    />
  );
}
