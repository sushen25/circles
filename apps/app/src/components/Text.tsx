import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { faceFor, type as ramp } from '@circles/tokens';

import { usePalette } from './theme';

/**
 * The type ramp as components, so no screen ever writes a font size.
 *
 * Every role resolves its face through `faceFor`, because React Native selects
 * a face by family name rather than weight. Times and counts get tabular
 * figures so a changing number does not shuffle the layout.
 */
type Props = TextProps & { children: ReactNode };

function role(name: keyof typeof ramp): TextStyle {
  const r = ramp[name];
  return {
    fontFamily: faceFor(r.fontFamily, r.fontWeight),
    fontSize: r.fontSize,
    lineHeight: r.lineHeight,
    letterSpacing: r.letterSpacing,
    ...('textTransform' in r ? { textTransform: r.textTransform } : {}),
  };
}

const styles = StyleSheet.create({
  displayXL: role('displayXL'),
  displayL: role('displayL'),
  date: { ...role('date'), fontVariant: ['tabular-nums'] },
  title: role('title'),
  body: role('body'),
  small: role('small'),
  label: role('label'),
  numeric: { fontVariant: ['tabular-nums'] },
});

export function DisplayXL({ style, ...props }: Props) {
  const palette = usePalette();
  return (
    <RNText
      accessibilityRole="header"
      style={[styles.displayXL, { color: palette.ink }, style]}
      {...props}
    />
  );
}

export function DisplayL({ style, ...props }: Props) {
  const palette = usePalette();
  return (
    <RNText
      accessibilityRole="header"
      style={[styles.displayL, { color: palette.ink }, style]}
      {...props}
    />
  );
}

/** Dates are set in the display face: they are the emotional content, not metadata. */
export function DateText({ style, ...props }: Props) {
  const palette = usePalette();
  return <RNText style={[styles.date, { color: palette.ink }, style]} {...props} />;
}

export function Title({ style, ...props }: Props) {
  const palette = usePalette();
  return <RNText style={[styles.title, { color: palette.ink }, style]} {...props} />;
}

export function Body({ style, ...props }: Props) {
  const palette = usePalette();
  return <RNText style={[styles.body, { color: palette.ink2 }, style]} {...props} />;
}

export function Small({ style, ...props }: Props) {
  const palette = usePalette();
  return <RNText style={[styles.small, { color: palette.ink3 }, style]} {...props} />;
}

/** Section labels only. Never for content (manifesto §5.2). */
export function Label({ style, ...props }: Props) {
  const palette = usePalette();
  return <RNText style={[styles.label, { color: palette.label }, style]} {...props} />;
}

/** Times and counts, so digits do not shift as they change. */
export const numeric = styles.numeric;
