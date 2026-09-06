import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { faceFor, radius, size } from '@circles/tokens';

import { usePalette } from './theme';

/** Surface on a hairline, 54 tall. The label lives outside, in the screen. */
export function Input({ style, ...props }: TextInputProps) {
  const palette = usePalette();

  return (
    <TextInput
      placeholderTextColor={palette.ink3}
      style={[
        styles.input,
        { backgroundColor: palette.surface, borderColor: palette.lineStrong, color: palette.ink },
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
  },
});
