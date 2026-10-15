import { useLayoutEffect, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputProps,
} from 'react-native';

import { faceFor, radius } from '@circles/tokens';

import { usePalette } from './theme';

/** One line of 16 pt text, and the padding and hairline the box adds around it. */
const LINE = 22;
const PAD_Y = 14;
const BORDER = 1;
const CHROME = 2 * (PAD_Y + BORDER);

/** About four lines when empty: the field takes 280 characters (SUS-153). */
export const TEXT_AREA_MIN = 120;
/** About eight lines; past this the text scrolls inside the box. */
export const TEXT_AREA_MAX = 8 * LINE + CHROME;

const clamp = (height: number) => Math.min(TEXT_AREA_MAX, Math.max(TEXT_AREA_MIN, height));

/**
 * A multi-line field that grows with what is typed, from four lines up to
 * eight, then scrolls inside. `Input` is a fixed 54 tall and stays that way;
 * a note goes here. Web measures `scrollHeight` (react-native-web's TextInput
 * does not auto-size); native follows `onContentSizeChange`.
 */
export function TextArea({ style, onContentSizeChange, value, ...props }: TextInputProps) {
  const palette = usePalette();
  const ref = useRef<TextInput>(null);
  const [height, setHeight] = useState(TEXT_AREA_MIN);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = ref.current as unknown as HTMLElement | null;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${clamp(el.scrollHeight + 2 * BORDER)}px`;
  }, [value]);

  const grow = (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
    if (Platform.OS !== 'web') setHeight(clamp(event.nativeEvent.contentSize.height + CHROME));
    onContentSizeChange?.(event);
  };

  return (
    <TextInput
      ref={ref}
      multiline
      value={value}
      placeholderTextColor={palette.ink3}
      onContentSizeChange={grow}
      style={[
        styles.area,
        { backgroundColor: palette.surface, borderColor: palette.lineStrong, color: palette.ink },
        Platform.OS === 'web' ? null : { height },
        style,
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  area: {
    minHeight: TEXT_AREA_MIN,
    maxHeight: TEXT_AREA_MAX,
    paddingHorizontal: 16,
    paddingVertical: PAD_Y,
    borderRadius: radius.input,
    borderWidth: BORDER,
    fontFamily: faceFor('Figtree', 400),
    fontSize: 16,
    lineHeight: LINE,
    textAlignVertical: 'top',
  },
});
