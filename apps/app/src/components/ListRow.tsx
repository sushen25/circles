import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { hit } from '@circles/tokens';
import { color } from '@circles/tokens';

import { t } from '../copy';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { Small, Title } from './Text';
import { usePalette } from './theme';
import { useDelayedShow, useSlow } from './wait';

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
  /**
   * Shown but not offered: dimmed, no chevron, announced as unavailable. The
   * detail line is where the row says why — a greyed row that does not is a
   * puzzle.
   */
  disabled?: boolean | undefined;
  /**
   * Working on it: the row keeps its colour, the spinner takes the chevron's
   * place after ~150 ms, taps do nothing, and `detail` is where it says what it
   * is doing ("Getting the file"), then "Still working on it…" at ~8 s. The
   * other rows stay as they are (SUS-155).
   */
  busy?: boolean | undefined;
};

export function ListRow({
  title,
  detail,
  label,
  leading,
  onPress,
  disabled = false,
  busy = false,
}: Props) {
  const palette = usePalette();
  const spinner = useDelayedShow(busy);
  const { slow } = useSlow(busy);
  const said = slow ? `${label}. ${t('common', 'still_working')}` : label;
  return (
    <Pressable
      role="button"
      aria-label={said}
      aria-busy={busy}
      aria-disabled={disabled}
      disabled={disabled || onPress === undefined}
      onPress={busy ? undefined : onPress}
      style={({ pressed }) => [
        styles.row,
        disabled && styles.disabled,
        pressed && !disabled && !busy && { opacity: 0.7 },
      ]}
    >
      {leading}
      <View style={styles.words}>
        <Title>{title}</Title>
        {slow ? (
          <Small accessibilityLiveRegion="polite">{t('common', 'still_working')}</Small>
        ) : detail === undefined ? null : (
          <Small>{detail}</Small>
        )}
      </View>
      {busy ? (
        <View style={styles.mark}>
          {spinner ? <Spinner size={20} color={color.accentDark} /> : null}
        </View>
      ) : disabled ? null : (
        <Icon name="chevron" size={18} color={palette.ink3} />
      )}
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
  disabled: {
    opacity: 0.5,
  },
  mark: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
