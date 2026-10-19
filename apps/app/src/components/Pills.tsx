import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, faceFor, radius } from '@circles/tokens';

import { spaceToPress } from './keys';
import { usePalette } from './theme';

/**
 * A row of pills that is one choice (SUS-236, ADR 0079): a radiogroup, one pill
 * selected. The large size is the first screen's "Evening · Daytime · Any
 * time"; the small is the same choices on a day's row, 40px tall beside a
 * round button. Selection is the fill and the border and `aria-checked`; the
 * label says the rest.
 */
export type Pill = {
  key: string;
  label: string;
  on: boolean;
  /** What a screen reader hears, when it is more than the label. */
  name?: string | undefined;
};

type Props = {
  pills: readonly Pill[];
  /** What the group is: "When, on those days?", or the day. */
  label: string;
  size?: 'large' | 'small';
  disabled?: boolean | undefined;
  onChoose?: ((key: string) => void) | undefined;
};

export function Pills({ pills, label, size = 'large', disabled = false, onChoose }: Props) {
  const palette = usePalette();
  const small = size === 'small';
  return (
    <View role="radiogroup" aria-label={label} style={[styles.row, small && styles.rowSmall]}>
      {pills.map((pill) => {
        const choose = disabled ? undefined : () => onChoose?.(pill.key);
        return (
          <Pressable
            key={pill.key}
            role="radio"
            aria-checked={pill.on}
            aria-label={pill.name ?? pill.label}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={choose}
            // A radio gets Enter from react-native-web but not Space.
            {...spaceToPress(choose)}
            style={[
              styles.pill,
              small ? styles.small : styles.large,
              { backgroundColor: palette.surface, borderColor: palette.lineStrong },
              pill.on && { backgroundColor: color.accentSoft, borderColor: palette.accent },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                small ? styles.textSmall : styles.textLarge,
                { color: palette.ink, fontFamily: faceFor('Figtree', pill.on ? 600 : 500) },
              ]}
            >
              {pill.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  rowSmall: { flex: 1, gap: 6 },
  pill: {
    flex: 1,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  large: { minHeight: 52, borderRadius: radius.pill },
  small: { minHeight: 40, borderRadius: radius.pill },
  textLarge: { fontSize: 16 },
  textSmall: { fontSize: 14 },
});
