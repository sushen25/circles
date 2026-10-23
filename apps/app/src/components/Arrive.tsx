import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform } from 'react-native';

import { STEP_EASING } from './StepMotion';
import { useReducedMotion } from './wait';

/**
 * The one arrival the manifesto allows (§3.7, SUS-250): the day and date of a
 * locked-in plan come in once, over 200 ms, fading in and rising 8 px on the
 * strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)`. Under reduced motion it
 * fades and does not rise. It plays when the screen mounts and never again.
 */
export function Arrive({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [shown] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const moving = Animated.timing(shown, {
      toValue: 1,
      duration: 200,
      easing: Easing.bezier(...STEP_EASING),
      useNativeDriver: Platform.OS !== 'web',
    });
    moving.start();
    return () => moving.stop();
  }, [shown]);

  return (
    <Animated.View
      style={{
        opacity: shown,
        transform: [
          {
            translateY: reduced
              ? 0
              : shown.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
