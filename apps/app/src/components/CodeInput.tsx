import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { faceFor, radius, size } from '@circles/tokens';

import { usePalette } from './theme';

/**
 * A one-time code as six boxes (the EnterCode artboard).
 *
 * **One real field under six drawn boxes, not six fields.** Six inputs each
 * holding a digit break the two things that make a code quick to enter: the
 * device's one-time-code autofill, which fills one field, and pasting the whole
 * code, which lands in whichever box has focus. So there is a single input,
 * transparent and laid over the row, and the boxes draw what it holds — typing
 * "advances" because the next digit is simply the next character, a paste of
 * all six fills all six, and Backspace goes back one. A screen reader meets one
 * labelled field; the boxes are decoration and say nothing.
 *
 * Anything that is not a digit is dropped, and nothing past `length` is kept.
 */
type Props = {
  value: string;
  onChangeText: (value: string) => void;
  /** What the field is called, to a screen reader and to a test. */
  label: string;
  length?: number;
  onSubmitEditing?: (() => void) | undefined;
  autoFocus?: boolean | undefined;
  editable?: boolean | undefined;
};

export function digitsOnly(text: string, length: number): string {
  return text.replace(/\D/g, '').slice(0, length);
}

export function CodeInput({
  value,
  onChangeText,
  label,
  length = 6,
  onSubmitEditing,
  autoFocus = false,
  editable = true,
}: Props) {
  const palette = usePalette();
  const [focused, setFocused] = useState(false);
  const digits = digitsOnly(value, length);
  const cursor = Math.min(digits.length, length - 1);

  return (
    <View style={styles.row}>
      {Array.from({ length }, (_, index) => {
        const active = focused && index === cursor;
        return (
          <View
            key={index}
            aria-hidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.box,
              { backgroundColor: palette.surface, borderColor: palette.lineStrong },
              active && { borderColor: palette.accent, borderWidth: 2 },
            ]}
          >
            <Text style={[styles.digit, { color: palette.ink }]}>{digits[index] ?? ''}</Text>
          </View>
        );
      })}
      <TextInput
        aria-label={label}
        value={digits}
        onChangeText={(text) => onChangeText(digitsOnly(text, length))}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={length}
        autoFocus={autoFocus}
        editable={editable}
        caretHidden
        selectionColor="transparent"
        style={styles.field}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    position: 'relative',
  },
  box: {
    flex: 1,
    height: size.input,
    borderRadius: radius.input,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    fontFamily: faceFor('Figtree', 600),
    fontSize: 22,
    fontVariant: ['tabular-nums'],
  },
  field: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    // Wide letter spacing keeps a tap on the fourth box near the fourth digit,
    // for the browsers that place the caret where the tap landed.
    letterSpacing: 32,
    fontSize: 22,
  },
});
