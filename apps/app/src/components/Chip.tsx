import { Pressable, StyleSheet, Text, View } from 'react-native';

import { faceFor, radius, size, space } from '@circles/tokens';

import { Icon } from './Icon';
import { spaceToPress } from './keys';
import { usePalette } from './theme';

/**
 * Selection carries a check glyph as well as the fill — never colour alone
 * (manifesto §6). `accessibilityState.selected` says the same thing to a
 * screen reader.
 */
type Props = {
  label: string;
  selected?: boolean | undefined;
  onPress?: (() => void) | undefined;
};

export function Chip({ label, selected = false, onPress }: Props) {
  const palette = usePalette();

  return (
    <Pressable
      role="checkbox"
      aria-label={label}
      aria-checked={selected}
      onPress={onPress}
      {...spaceToPress(onPress)}
      style={[
        styles.chip,
        { backgroundColor: palette.surface, borderColor: palette.lineStrong },
        selected && { backgroundColor: palette.accent, borderColor: palette.accent },
      ]}
    >
      {selected ? <Icon name="check" size={16} color={palette.onAccent} /> : null}
      <Text style={[styles.label, { color: selected ? palette.onAccent : palette.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Chips wrap; the gap is the only spacing between them. */
export function Chips({ children }: { children: React.ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: size.chip,
    paddingHorizontal: 16,
    borderRadius: radius.chip,
    borderWidth: 1,
  },
  label: {
    fontFamily: faceFor('Figtree', 500),
    fontSize: 14,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.tight,
  },
});
