import { Pressable, StyleSheet, View } from 'react-native';

import { hit, radius } from '@circles/tokens';

import { usePalette } from './theme';

type Props = {
  selected: boolean;
  onPress: () => void;
  label: string;
};

export function Radio({ selected, onPress, label }: Props) {
  const palette = usePalette();

  return (
    <Pressable
      role="radio"
      aria-label={label}
      aria-checked={selected}
      onPress={onPress}
      style={styles.target}
    >
      <View
        style={[
          styles.radio,
          { backgroundColor: palette.surface, borderColor: palette.lineStrong },
          selected && { borderWidth: 7, borderColor: palette.accent },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    minWidth: hit,
    minHeight: hit,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
});
