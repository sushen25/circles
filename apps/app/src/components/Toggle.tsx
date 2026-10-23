import { Pressable, StyleSheet, View } from 'react-native';

import { color, hit, radius } from '@circles/tokens';

import { spaceToPress } from './keys';
import { usePalette } from './theme';
import { useReducedMotion } from './wait';

type Props = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
  disabled?: boolean | undefined;
};

/**
 * The switch is 28 tall but the tap target is 44, so the control is reachable
 * without making the row look heavy (manifesto §6).
 */
export function Toggle({ value, onValueChange, label, disabled = false }: Props) {
  const palette = usePalette();
  const reduced = useReducedMotion();

  return (
    <Pressable
      role="switch"
      aria-label={label}
      aria-checked={value}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      {...(disabled ? {} : spaceToPress(() => onValueChange(!value)))}
      style={styles.target}
    >
      <View
        style={[
          styles.track,
          // An off switch has a 3:1 outline, so it reads as a control on the ground (SUS-250).
          {
            backgroundColor: value ? palette.accent : palette.line,
            borderColor: value ? palette.accent : OFF_LINE,
          },
        ]}
      >
        <View
          style={[
            styles.knob,
            { backgroundColor: color.surface },
            // The knob slides (150 ms, ease-out) on the web; native snaps. Not under reduced motion.
            {
              transform: [{ translateX: value ? KNOB_TRAVEL : 0 }],
              transitionProperty: 'transform',
              transitionDuration: reduced ? '0ms' : '150ms',
              transitionTimingFunction: 'ease-out',
            } as object,
          ]}
        />
      </View>
    </Pressable>
  );
}

/** The off switch's outline: 3:1 against the ground. */
const OFF_LINE = '#8F8173';
/** 46 wide, a 1.5 border, a 22 knob with 1.5 either side: it travels 18. */
const KNOB_TRAVEL = 18;

const styles = StyleSheet.create({
  target: {
    minWidth: hit,
    minHeight: hit,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  track: {
    width: 46,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  knob: {
    position: 'absolute',
    top: 1.5,
    left: 1.5,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
  },
});
