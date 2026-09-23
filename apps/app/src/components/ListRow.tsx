import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { hit } from '@circles/tokens';

import { Icon } from './Icon';
import { Small, Title } from './Text';
import { usePalette } from './theme';

/**
 * A line in a list that opens something: a leading square, a title, a line of
 * detail under it and a chevron (the canvas's `li` with `chev`). The whole row
 * is the target.
 *
 * `label` is what it is called when spoken, and it has to say everything the
 * row shows: on the web an `aria-label` *replaces* the name the children would
 * have given, so a label of the title alone leaves the detail unread (S1-27).
 */
type Props = {
  title: string;
  detail?: string | undefined;
  label: string;
  leading?: ReactNode;
  onPress?: (() => void) | undefined;
};

export function ListRow({ title, detail, label, leading, onPress }: Props) {
  const palette = usePalette();
  return (
    <Pressable
      role="button"
      aria-label={label}
      disabled={onPress === undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      {leading}
      <View style={styles.words}>
        <Title>{title}</Title>
        {detail === undefined ? null : <Small>{detail}</Small>}
      </View>
      <Icon name="chevron" size={18} color={palette.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: hit,
  },
  words: {
    flex: 1,
    gap: 2,
  },
});
