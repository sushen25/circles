import { useRouter } from 'expo-router';

import { useSession } from '../../data/auth';
import { AfterAttendanceScreen } from './AfterAttendanceScreen';
import { useOrganiserGate } from './InitiateGateFlow';
import type { Nudge } from './useNudge';

/**
 * "Start a circle for another group", the morning after (spec §5.11): shown in
 * place of "Thanks, noted." when `record-nudge` has let the prompt through —
 * "I was there", on the circle's first meetup, once.
 *
 * **Start a circle** goes to the new-circle form; a guest meets the organiser
 * gate first, in place, and is taken on once their place is saved — as
 * `after_attendance`, so the funnel credits the prompt and not the gate.
 * **Maybe later** is the one-tap way out, to the circle.
 *
 * The nudge is the caller's (`MemberAttendance` asks for it, to know whether
 * to draw this at all); this records what was done with it.
 */
export function AfterAttendanceFlow({
  nudge,
  circleId,
  circleName,
  date,
  onToCircle,
  onBack,
}: {
  nudge: Nudge;
  circleId: string;
  circleName: string;
  date: string;
  onToCircle: () => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const session = useSession();
  const organiser = useOrganiserGate({
    circleId,
    circleName,
    intent: 'circle',
    moment: 'after_attendance',
  });

  if (organiser.gate !== null) return organiser.gate;

  return (
    <AfterAttendanceScreen
      circleName={circleName}
      date={date}
      guest={session.status === 'guest'}
      onNext={() => {
        nudge.tap();
        organiser.require(() => router.push('/circles/create'));
      }}
      onMaybeLater={() => {
        nudge.dismiss();
        onToCircle();
      }}
      onBack={onBack}
    />
  );
}
