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
  /** A second line under the label: a block's hours, "5:30–10:30 pm". */
  detail?: string | undefined;
  selected?: boolean | undefined;
  onPress?: (() => void) | undefined;
  /** Shown but not in play, and said so: not a checkbox that silently does nothing. */
  disabled?: boolean | undefined;
};

export function Chip({ label, detail, selected = false, onPress, disabled = false }: Props) {
  const palette = usePalette();
  const ink = selected ? palette.onAccent : palette.ink;

  return (
    <Pressable
      role="checkbox"
      aria-label={detail === undefined ? label : `${label}, ${detail}`}
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      {...(disabled ? {} : spaceToPress(onPress))}
      style={[
        styles.chip,
        detail !== undefined && styles.twoLine,
        { backgroundColor: palette.surface, borderColor: palette.lineStrong },
        selected && { backgroundColor: palette.accent, borderColor: palette.accent },
      ]}
    >
      {selected ? <Icon name="check" size={16} color={palette.onAccent} /> : null}
      {detail === undefined ? (
        <Text style={[styles.label, { color: ink }]}>{label}</Text>
      ) : (
        <View>
          <Text style={[styles.label, styles.strong, { color: ink }]}>{label}</Text>
          <Text style={[styles.detail, { color: selected ? palette.onAccent : palette.ink2 }]}>
            {detail}
          </Text>
        </View>
      )}
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
  // Grows with its text rather than clipping it at 200% type.
  twoLine: {
    height: undefined,
    minHeight: size.chip,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  label: {
    fontFamily: faceFor('Figtree', 500),
    fontSize: 14,
  },
  strong: {
    fontFamily: faceFor('Figtree', 600),
  },
  detail: {
    fontFamily: faceFor('Figtree', 400),
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.tight,
  },
});
