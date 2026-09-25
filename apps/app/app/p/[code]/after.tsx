import { useRouter } from 'expo-router';

import { useFixture } from '../../../src/data/fixtures/useFixture';
import { AfterAttendanceScreen } from '../../../src/features/growth/AfterAttendanceScreen';

/**
 * Route only — thin composition, no logic (architecture §7.1).
 *
 * The gallery's view of "Start a circle for another group". The real prompt
 * follows "I was there" on the attendance page (`AfterAttendanceFlow`).
 */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();

  return (
    <AfterAttendanceScreen
      fixture={fixture}
      circleName={fixture.circle.name}
      date={fixture.plan.dayLabel}
      onBack={() => router.back()}
      onMaybeLater={() => router.back()}
    />
  );
}
