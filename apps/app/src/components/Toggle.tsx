import { Pressable, StyleSheet, View } from 'react-native';

import { color, hit, radius } from '@circles/tokens';

import { spaceToPress } from './keys';
import { usePalette } from './theme';

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
      <View style={[styles.track, { backgroundColor: value ? palette.accent : palette.line }]}>
        <View style={[styles.knob, { backgroundColor: color.surface, left: value ? 21 : 3 }]} />
      </View>
    </Pressable>
  );
}

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
  },
  knob: {
    position: 'absolute',
    top: 3,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
  },
});
