import { StyleSheet, Text, View } from 'react-native';

import { circleColor, color, faceFor, radius, size } from '@circles/tokens';

import { DisplayL, Small } from './Text';

/**
 * A circle's colour as a solid square with its initial (spec §5.2: "solid
 * colour, no image"). The colour is the circle's token (`circles.color`); a
 * name the palette does not know draws as the first colour rather than as
 * nothing, so a token retired from the canvas cannot blank a circle out.
 *
 * Decorative: the circle's name is always written beside it, so the square is
 * hidden from assistive technology rather than announced as a letter.
 */
type Props = {
  name: string;
  color: string;
  large?: boolean;
};

export function circleHex(token: string): string {
  const palette = circleColor as Record<string, string>;
  return palette[token] ?? Object.values(circleColor)[0] ?? '#000000';
}

export function CircleBadge({ name, color, large = false }: Props) {
  const initial = [...name.trim()][0]?.toLocaleUpperCase() ?? '';
  return (
    <View
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.badge, large && styles.large, { backgroundColor: circleHex(color) }]}
    >
      <Text style={[styles.initial, large && styles.initialLarge]}>{initial}</Text>
    </View>
  );
}

/**
 * A circle home's header: the circle's colour, its name, and one line under it
 * ("6 members · about monthly"). The words take the width that is left, so a
 * long name wraps rather than pushing the square off the screen.
 */
export function CircleHeader({
  name,
  color,
  subtitle,
}: {
  name: string;
  color: string;
  subtitle: string;
}) {
  return (
    <View style={styles.header}>
      <CircleBadge name={name} color={color} large />
      <View style={styles.words}>
        <DisplayL>{name}</DisplayL>
        <Small>{subtitle}</Small>
      </View>
    </View>
  );
}

const LARGE = 52;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  words: {
    flex: 1,
    gap: 2,
  },
  badge: {
    width: size.iconSquare,
    height: size.iconSquare,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  large: {
    width: LARGE,
    height: LARGE,
  },
  initial: {
    fontFamily: faceFor('Newsreader', 400),
    fontSize: 22,
    // White on every circle colour, as on the accent (the canvas's `.icon-sq`).
    color: color.surface,
  },
  initialLarge: {
    fontSize: 26,
  },
});
