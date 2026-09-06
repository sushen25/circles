import { StyleSheet, Text, View } from 'react-native';

import { color, faceFor, type as ramp } from '@circles/tokens';

import { Icon, type IconName } from './Icon';
import { usePalette } from './theme';

/**
 * Warm surface, hairline, an icon and one sentence. Advisory context only,
 * never decoration.
 *
 * `ok` is affirmative and nothing else: there is no green success colour in the
 * ordinary palette, because dressing an everyday outcome in traffic-light
 * colour makes a social situation feel like a system failure (manifesto §5.1).
 */
type Props = {
  children: string;
  icon?: IconName;
  kind?: 'plain' | 'warn' | 'ok';
};

export function Notice({ children, icon = 'shield', kind = 'plain' }: Props) {
  const palette = usePalette();

  const tone =
    kind === 'warn'
      ? { backgroundColor: color.warnSurface, borderColor: color.warnLine, color: color.warnInk }
      : kind === 'ok'
        ? {
            backgroundColor: color.supportSoft,
            borderColor: color.supportLine,
            color: color.support,
          }
        : { backgroundColor: palette.surface, borderColor: palette.line, color: palette.ink2 };

  return (
    <View
      accessible
      style={[
        styles.notice,
        { backgroundColor: tone.backgroundColor, borderColor: tone.borderColor },
      ]}
    >
      <Icon name={icon} size={18} color={tone.color} />
      <Text style={[styles.text, { color: tone.color }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  text: {
    flex: 1,
    fontFamily: faceFor('Figtree', ramp.small.fontWeight),
    fontSize: ramp.small.fontSize,
    lineHeight: ramp.small.lineHeight,
  },
});
