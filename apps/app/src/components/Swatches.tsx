import { Pressable, StyleSheet, View } from 'react-native';

import { circleColor, hit, radius, size } from '@circles/tokens';

import { usePalette } from './theme';

/**
 * A circle's colour, chosen from the circle palette (the canvas's CreateCircle
 * swatches). One of a group, so each swatch is a radio and the chosen one says
 * so; the ring around it is the canvas's `outline: 2px solid ink`.
 *
 * `labelFor` gives each colour its spoken name. Components hold no copy, so
 * the words come in from the screen.
 */
type Props = {
  value: string;
  onChange: (token: string) => void;
  labelFor: (token: string) => string;
  /** The group's name, spoken once. */
  label: string;
};

export function Swatches({ value, onChange, labelFor, label }: Props) {
  const palette = usePalette();
  return (
    <View role="radiogroup" aria-label={label} style={styles.row}>
      {Object.entries(circleColor).map(([token, hex]) => {
        const selected = token === value;
        return (
          <Pressable
            key={token}
            role="radio"
            aria-label={labelFor(token)}
            aria-checked={selected}
            onPress={() => onChange(token)}
            style={styles.target}
          >
            <View
              style={[
                styles.swatch,
                { backgroundColor: hex },
                selected && { outlineColor: palette.ink, ...styles.selected },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  target: {
    minWidth: hit + 4,
    minHeight: hit + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: size.iconSquare,
    height: size.iconSquare,
    borderRadius: radius.chip,
  },
  selected: {
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineOffset: 3,
  },
});
