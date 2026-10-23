import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { useReducedMotion } from './wait';

/**
 * A word that changes into another in place: "Copy" into "Copied" (SUS-247).
 * The old word fades out as it blurs by 2 px and the new one fades in, over
 * 200 ms; neither moves. Where the blur is not available (native) it is the
 * fade alone, and under reduced motion it is the fade alone too.
 *
 * Only for a label that confirms what the person just did. Nothing else on a
 * screen changes in place like this.
 */
export function Crossfade({ value, style }: { value: string; style: StyleProp<TextStyle> }) {
  const reduced = useReducedMotion();
  const [words, setWords] = useState({ now: value, was: value });
  const [progress] = useState(() => new Animated.Value(1));
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setWords((was) => ({ now: value, was: was.now }));
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 200,
      easing: Easing.bezier(0.23, 1, 0.32, 1),
      useNativeDriver: false,
    }).start();
  }, [value, progress]);

  const blur = (from: number, to: number) =>
    Platform.OS === 'web' && !reduced
      ? {
          filter: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [`blur(${from}px)`, `blur(${to}px)`],
          }),
        }
      : {};

  return (
    <View style={styles.stack}>
      <Animated.Text
        style={[style, { opacity: progress }, blur(2, 0) as object]}
        accessibilityLiveRegion="polite"
      >
        {words.now}
      </Animated.Text>
      {words.was === words.now ? null : (
        <Animated.Text
          aria-hidden
          style={[
            style,
            styles.was,
            { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
            blur(0, 2) as object,
          ]}
        >
          {words.was}
        </Animated.Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { alignItems: 'center', justifyContent: 'center' },
  was: { position: 'absolute' },
});
