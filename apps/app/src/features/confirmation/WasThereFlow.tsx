import { useRouter } from 'expo-router';
import { useState } from 'react';

import type { PlanConfirmation } from '../../data/confirmation';
import { attendanceStageOf, morningAfterWords } from './morningAfter';
import { WasThereScreen } from './WasThereScreen';
import { useReportAttendance } from './useMorningAfter';

/**
 * "Did you make it to Thursday's catch-up?", for a member (spec §5.10).
 *
 * An answer stays on this screen and says "Thanks, noted." — the same words
 * either way — with the circle one tap on. "Not now" is remembered on this
 * device so circle home asks once, and goes to the circle.
 */
export function MemberAttendance({ data, queryKey }: { data: PlanConfirmation; queryKey: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);

  const toCircle = () =>
    router.dismissTo({ pathname: '/circles/[id]', params: { id: data.circleId } });
  const back = () => (router.canGoBack() ? router.back() : toCircle());
  const report = useReportAttendance(data, queryKey, () => setDone(true));

  const stage = attendanceStageOf(data);
  const words = morningAfterWords(data);

  if (done) {
    return <WasThereScreen state="done" words={words} onToCircle={toCircle} onBack={back} />;
  }

  return (
    <WasThereScreen
      state={stage.kind === 'ask' ? 'default' : stage.kind}
      words={words}
      said={stage.kind === 'ask' ? stage.said : undefined}
      saving={report.saving}
      notice={report.notice}
      onWasThere={() => report.answer('was_there')}
      onMissed={() => report.answer('missed')}
      // Once answered, "Not now" is not a thing to say: Back does it.
      onNotNow={
        stage.kind === 'ask' && stage.said === undefined
          ? () => void report.notNow().then(toCircle)
          : undefined
      }
      onToCircle={toCircle}
      onBack={back}
    />
  );
}
