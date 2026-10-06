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
  /**
   * A third line, after the people icon: what others said about these hours,
   * "3 free" (SUS-129). Read out after the detail.
   */
  others?: string | undefined;
  selected?: boolean | undefined;
  onPress?: (() => void) | undefined;
  /** Shown but not in play, and said so: not a checkbox that silently does nothing. */
  disabled?: boolean | undefined;
};

export function Chip({
  label,
  detail,
  others,
  selected = false,
  onPress,
  disabled = false,
}: Props) {
  const palette = usePalette();
  const ink = selected ? palette.onAccent : palette.ink;
  const soft = selected ? palette.onAccent : palette.ink2;
  const spoken = [label, detail, others].filter((part) => part !== undefined).join(', ');

  return (
    <Pressable
      role="checkbox"
      aria-label={spoken}
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
        <Text numberOfLines={1} style={[styles.label, styles.shrink, { color: ink }]}>
          {label}
        </Text>
      ) : (
        <View style={styles.shrink}>
          <Text style={[styles.label, styles.strong, { color: ink }]}>{label}</Text>
          <Text style={[styles.detail, { color: soft }]}>{detail}</Text>
          {others === undefined ? null : (
            <View style={styles.others}>
              <Icon name="people" size={12} color={soft} />
              <Text style={[styles.detail, { color: soft }]}>{others}</Text>
            </View>
          )}
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
  // A chip never runs past the screen: it is at most its row wide, and a label
  // longer than that ends in an ellipsis. The accessible label is the full text.
  chip: {
    maxWidth: '100%',
    flexShrink: 1,
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
  shrink: { flexShrink: 1 },
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
  others: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.tight,
  },
});
