import { useRouter } from 'expo-router';
import { useState } from 'react';

import type { PlanConfirmation, RetrospectiveAnswer } from '../../data/confirmation';
import { AfterAttendanceFlow } from '../growth/AfterAttendanceFlow';
import { useNudge } from '../growth/useNudge';
import { attendanceStageOf, morningAfterWords } from './morningAfter';
import { WasThereScreen } from './WasThereScreen';
import { useReportAttendance } from './useMorningAfter';

/**
 * "Did you make it to Thursday's catch-up?", for a member (spec §5.10).
 *
 * An answer stays on this screen and says "Thanks, noted." — the same words
 * either way — with the circle one tap on. "Not now" is remembered on this
 * device so circle home asks once, and goes to the circle.
 *
 * **"I was there" can be the after-attendance moment** (S2-07): on the
 * circle's first meetup, once, `record-nudge` lets "Start a circle for another
 * group" through, and it is drawn instead of "Thanks, noted.". While that is
 * being asked the answer's button still says "Saving", so the screen does not
 * say one thing and then another. "I couldn't make it" is never the moment.
 */
export function MemberAttendance({ data, queryKey }: { data: PlanConfirmation; queryKey: string }) {
  const router = useRouter();
  const [done, setDone] = useState<RetrospectiveAnswer | undefined>();

  const toCircle = () =>
    router.dismissTo({ pathname: '/circles/[id]', params: { id: data.circleId } });
  const back = () => (router.canGoBack() ? router.back() : toCircle());
  const report = useReportAttendance(data, queryKey, setDone);
  const startACircle = useNudge('after_attendance_start_circle', {
    planId: data.planId,
    enabled: done === 'was_there',
  });

  const stage = attendanceStageOf(data);
  const words = morningAfterWords(data);

  if (done !== undefined && startACircle.showing === 'show' && words !== undefined) {
    return (
      <AfterAttendanceFlow
        nudge={startACircle}
        circleId={data.circleId}
        circleName={words.circle}
        date={words.date}
        onToCircle={toCircle}
        onBack={back}
      />
    );
  }
  if (done !== undefined && startACircle.showing !== 'pending') {
    return <WasThereScreen state="done" words={words} onToCircle={toCircle} onBack={back} />;
  }

  return (
    <WasThereScreen
      state={stage.kind === 'ask' ? 'default' : stage.kind}
      words={words}
      said={stage.kind === 'ask' ? stage.said : undefined}
      saving={report.saving ?? done}
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
