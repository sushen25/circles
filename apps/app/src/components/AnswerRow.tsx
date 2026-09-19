import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { color, faceFor, hit, space } from '@circles/tokens';

import { Icon } from './Icon';
import { DateText, Small, numeric } from './Text';
import { usePalette } from './theme';

/**
 * One line of an answer in words — the date, and the times beside it — that
 * opens to show what is under it (ADR 0024). The text is the answer (manifesto
 * §5.4); opening it is how a day is adjusted by the half hour.
 *
 * The whole line is the target, with a boxed chevron that turns over when it is
 * open, and it says whether it is open (`aria-expanded`).
 */
type Props = {
  /** "Tue 15 Sep" */
  date: string;
  /** "5:30–10:30 pm" */
  range: string;
  /** What the line is called when spoken: it names the day and its times. */
  label: string;
  open: boolean;
  onToggle?: (() => void) | undefined;
  disabled?: boolean | undefined;
  /** Shown under the line while it is open. */
  children?: ReactNode;
};

export function AnswerRow({
  date,
  range,
  label,
  open,
  onToggle,
  disabled = false,
  children,
}: Props) {
  const palette = usePalette();

  return (
    <View style={[styles.answer, { borderTopColor: palette.line }]}>
      <Pressable
        role="button"
        aria-label={label}
        aria-expanded={open}
        aria-disabled={disabled}
        disabled={disabled || onToggle === undefined}
        onPress={onToggle}
        style={styles.line}
      >
        <View style={styles.words}>
          <DateText style={styles.date}>{date}</DateText>
          <Small style={[numeric, { color: palette.ink2 }]}>{range}</Small>
        </View>
        <View
          style={[
            styles.chevron,
            { borderColor: palette.lineStrong, backgroundColor: palette.surface },
            open && { backgroundColor: color.accentSoft, borderColor: color.accentSoft },
          ]}
        >
          <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
            <Icon name="chevron" size={16} color={palette.ink2} />
          </View>
        </View>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  answer: {
    gap: space.related,
    paddingVertical: space.related,
    borderTopWidth: 1,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.related,
    minHeight: hit,
  },
  words: { flexShrink: 1, gap: 3 },
  date: {
    fontFamily: faceFor('Newsreader', 400),
    fontSize: 21,
  },
  chevron: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
