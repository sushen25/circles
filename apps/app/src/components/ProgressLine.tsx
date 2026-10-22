import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { usePalette } from './theme';
import { STEP_EASING } from './StepMotion';
import { useReducedMotion } from './wait';

/**
 * The 2 px line under the top bar: how far along a run of steps the person is
 * (SUS-247). It grows by `scaleX` over 200 ms, from where the last screen left
 * it, so the next step reads as the same line carrying on rather than a new
 * one. Each step is its own route and mounts its own line, so where the last
 * one ended is kept for the next to start from.
 *
 * Under reduced motion it is simply there. It is a picture of the count beside
 * it, which says the same in words, and is hidden from a screen reader.
 */
let previous = 0;

/** Forgets where the line was, so the first screen of a run starts from nothing. */
export function resetProgress(): void {
  previous = 0;
}

export function ProgressLine({ fraction }: { fraction: number }) {
  const palette = usePalette();
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(Math.min(previous, fraction)));

  useEffect(() => {
    previous = fraction;
    if (reduced) {
      scale.setValue(fraction);
      return undefined;
    }
    const growing = Animated.timing(scale, {
      toValue: fraction,
      duration: 200,
      easing: Easing.bezier(...STEP_EASING),
      useNativeDriver: Platform.OS !== 'web',
    });
    growing.start();
    return () => growing.stop();
  }, [fraction, reduced, scale]);

  return (
    <View aria-hidden style={[styles.track, { backgroundColor: palette.line }]}>
      <Animated.View
        style={[
          styles.fill,
          { backgroundColor: palette.accent, transform: [{ scaleX: scale }] },
          // Grows from the left edge, not from the middle.
          { transformOrigin: 'left center' } as object,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 2, width: '100%' },
  fill: { height: 2, width: '100%' },
});
