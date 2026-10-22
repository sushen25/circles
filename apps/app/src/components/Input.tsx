import { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { faceFor, radius, size } from '@circles/tokens';

import { usePalette } from './theme';

/**
 * Surface on a hairline, 54 tall. The label lives outside, in the screen.
 *
 * **Focus is ink, not the accent and not the browser's ring.** The accent is
 * for the current action and the person's own choices, and a field you are
 * typing in is neither; the browser's default is a blue outline nobody drew.
 * A 2 px ink border says "you are here" in the palette's own colour, and shows
 * on the confirmed screen's inverted ground too (SUS-247).
 */
export function Input({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const palette = usePalette();
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      placeholderTextColor={palette.ink3}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[
        styles.input,
        { backgroundColor: palette.surface, borderColor: palette.lineStrong, color: palette.ink },
        focused && { borderColor: palette.ink, boxShadow: `0 0 0 1px ${palette.ink}` },
        style,
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    height: size.input,
    paddingHorizontal: 16,
    borderRadius: radius.input,
    borderWidth: 1,
    fontFamily: faceFor('Figtree', 400),
    fontSize: 16,
    // The border above is the focus ring; the browser's would sit on top of it.
    ...({ outlineStyle: 'none' } as object),
  },
});
