import { StyleSheet, Text, View } from 'react-native';

import { color, faceFor, radius } from '@circles/tokens';

import { Icon } from '../../components';

/**
 * What a guest sent, as it reads back on Sent (SUS-250): each day with how many
 * can make it, the reader included. A number and a word, never a name (ADR 0066).
 * Not buttons: the screen says the times are in, it does not offer them for
 * editing. The spoken label carries the figure, so the glyph is hidden.
 */
export type SentDay = {
  key: string;
  /** "Tue 20" */
  label: string;
  /** How many can make it, you included. Absent when nobody else's times can be counted. */
  count: number | undefined;
  /** "Tuesday 20 October, you and 2 others can make it". */
  spoken: string;
};

export function DayChips({ days, label }: { days: readonly SentDay[]; label: string }) {
  return (
    <View role="list" aria-label={label} style={styles.row}>
      {days.map((day) => (
        <View key={day.key} role="listitem" aria-label={day.spoken} style={styles.chip}>
          <Text style={styles.day} aria-hidden>
            {day.label}
          </Text>
          {day.count === undefined ? null : (
            <View style={styles.count} aria-hidden>
              <Icon name="people" size={13} color={color.accentDark} />
              <Text style={styles.number}>{day.count}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.chip,
    backgroundColor: color.accentSoft,
  },
  day: { fontFamily: faceFor('Figtree', 600), fontSize: 16, color: color.accentDark },
  count: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  number: {
    fontFamily: faceFor('Figtree', 600),
    fontSize: 15,
    color: color.accentDark,
    fontVariant: ['tabular-nums'],
  },
});
