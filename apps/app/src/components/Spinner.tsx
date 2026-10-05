import { useEffect, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useReducedMotion } from './wait';

/**
 * The busy mark: a three-quarter ring in the label's colour, turning once every
 * 0.9 s. Under reduced motion it is the same ring held still, and the "-ing"
 * label and `aria-busy` carry the rest (SUS-155). Decorative, like an icon.
 */
export function Spinner({ size = 18, color }: { size?: number; color: string }) {
  const reduced = useReducedMotion();
  const [turn] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      turn.setValue(0);
    };
  }, [reduced, turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      aria-hidden
      testID="spinner"
      style={{ width: size, height: size, transform: [{ rotate }] }}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <Path
          d="M12 3a9 9 0 1 1-9 9"
          stroke={color}
          strokeWidth={2.6}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}
