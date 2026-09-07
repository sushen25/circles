import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentType } from 'react';

import { useFixture } from '../../src/data/fixtures/useFixture';
import { CircleHomeScreen } from '../../src/features/circles/CircleHomeScreen';
import { CircleHomeJoiningScreen } from '../../src/features/circles/CircleHomeJoiningScreen';
import { CircleHomeConfirmedScreen } from '../../src/features/circles/CircleHomeConfirmedScreen';
import { CircleHomeDueScreen } from '../../src/features/circles/CircleHomeDueScreen';
import { EmptyCircleScreen } from '../../src/features/circles/EmptyCircleScreen';
import type { Fixture } from '../../src/data/fixtures';

type Common = {
  fixture: Fixture;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSeeHowItsLooking?: (() => void) | undefined;
};

/**
 * States of this screen, not pages of their own (manifesto §7). The data will
 * decide which one in Slice 1; until then `?state=` does.
 */
const STATES: Record<string, ComponentType<Common>> = {
  joining: CircleHomeJoiningScreen,
  confirmed: CircleHomeConfirmedScreen,
  due: CircleHomeDueScreen,
  empty: EmptyCircleScreen,
};

/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();
  const { state } = useLocalSearchParams<{ state?: string }>();
  const Screen = (state && STATES[state]) || CircleHomeScreen;

  return (
    <Screen
      fixture={fixture}
      onNext={() => router.push('/circles/sunday-crew/plan/setup')}
      onSeeHowItsLooking={() => router.push('/circles/sunday-crew/plan/thu-17/candidates')}
      onBack={() => router.back()}
    />
  );
}
