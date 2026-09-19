import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { color, faceFor, hit, radius } from '@circles/tokens';

import { Icon } from './Icon';
import { Label } from './Text';
import { usePalette } from './theme';

/** The gap between days, where there is room for it. */
const GAP = 5;

/**
 * The plan's days as a calendar, Monday first: tap every day that could work,
 * then pick a time once for all of them (ADR 0024).
 *
 * Each day is a toggle button. Ticked is the accent fill **and** a check; a day
 * with times is the soft fill **and** its short tag ("Eve", "Some"); and the
 * spoken label carries the full date and the times in words, so nothing is
 * said by colour alone (manifesto §6).
 *
 * **Seven columns only while seven fit.** A column narrower than a 44pt target
 * at the current text size — 200% type, a browser zoomed to 200%, a narrow
 * phone — and the grid becomes a wrapping list of days that name their own
 * weekday, since the header above a column no longer lines up with anything.
 */
export type GridDay = {
  key: string;
  /** "14" */
  number: string;
  /** "Mon 14", shown instead of the number when the grid wraps. */
  name: string;
  /** "Eve", "Some" — only when the day has times. */
  tag?: string | undefined;
  /** "Monday 14 September, 5:30–10:30 pm" or "…, no times yet". */
  label: string;
  /** Days since the Monday of the first week: its place in the grid. */
  slot: number;
  selected: boolean;
  hasTimes: boolean;
};

type Props = {
  days: readonly GridDay[];
  /** The seven column headings, Monday first. */
  weekdays: readonly string[];
  /** The grid's name for a screen reader. */
  label: string;
  onToggle?: ((index: number) => void) | undefined;
  /** "I'm easy" is on, or an answer is on its way: shown, faded, not pressable. */
  dimmed?: boolean | undefined;
};

const COLUMNS = 7;

export function DayGrid({ days, weekdays, label, onToggle, dimmed = false }: Props) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  // The gap gives way before the columns do: seven 44pt columns fit a 360pt
  // phone's content width with a point to spare between them, and a 390pt one
  // with the full gap. Before the first layout the width is unknown; seven
  // columns is what a phone at ordinary text size gets, and what a server
  // render should show.
  const column = hit * Math.max(1, fontScale);
  const gap = width > 0 ? Math.min(GAP, (width - COLUMNS * column) / (COLUMNS - 1)) : GAP;
  const wraps = gap < 1;

  const button = (day: GridDay, index: number) => (
    <DayButton
      key={day.key}
      day={day}
      wraps={wraps}
      dimmed={dimmed}
      onPress={onToggle === undefined ? undefined : () => onToggle(index)}
    />
  );

  let body;
  if (wraps) {
    body = <View style={styles.wrap}>{days.map(button)}</View>;
  } else {
    const weeks = Math.ceil((Math.max(...days.map((d) => d.slot), 0) + 1) / COLUMNS);
    const bySlot = new Map(days.map((day, index) => [day.slot, index]));
    body = Array.from({ length: weeks }, (_, week) => (
      <View key={week} style={[styles.week, { gap }]}>
        {Array.from({ length: COLUMNS }, (__, col) => {
          const index = bySlot.get(week * COLUMNS + col);
          return index === undefined ? (
            <View key={col} style={styles.blank} />
          ) : (
            button(days[index]!, index)
          );
        })}
      </View>
    ));
  }

  return (
    <View
      style={[styles.grid, dimmed && styles.dimmed]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {wraps ? null : (
        <View style={[styles.week, { gap }]} aria-hidden>
          {weekdays.map((weekday) => (
            <Label key={weekday} style={styles.heading}>
              {weekday}
            </Label>
          ))}
        </View>
      )}
      <View role="group" aria-label={label} style={styles.days}>
        {body}
      </View>
    </View>
  );
}

function DayButton({
  day,
  wraps,
  dimmed,
  onPress,
}: {
  day: GridDay;
  wraps: boolean;
  dimmed: boolean;
  onPress: (() => void) | undefined;
}) {
  const palette = usePalette();
  const ink = day.selected ? palette.onAccent : day.hasTimes ? color.accentDark : palette.ink;
  // A toggle button: `aria-pressed` on the web, where react-native-web passes
  // it through; `selected` on native, which has no pressed state to announce.
  const state: Record<string, unknown> =
    Platform.OS === 'web' ? { 'aria-pressed': day.selected } : { 'aria-selected': day.selected };

  return (
    <Pressable
      role="button"
      aria-label={day.label}
      aria-disabled={dimmed}
      disabled={dimmed || onPress === undefined}
      onPress={onPress}
      {...state}
      style={[
        styles.day,
        wraps && styles.dayWrapped,
        { backgroundColor: palette.surface, borderColor: palette.lineStrong },
        day.hasTimes && { backgroundColor: color.accentSoft, borderColor: color.accentSoft },
        day.selected && { backgroundColor: palette.accent, borderColor: palette.accent },
      ]}
    >
      {day.selected ? (
        <View style={styles.tick}>
          <Icon name="check" size={10} color={palette.onAccent} />
        </View>
      ) : null}
      <Text style={[styles.number, { color: ink }]}>{wraps ? day.name : day.number}</Text>
      <Text style={[styles.tag, { color: ink }]}>{day.tag ?? ' '}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 6 },
  days: { gap: GAP },
  week: { flexDirection: 'row', gap: GAP },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  heading: { flex: 1, textAlign: 'center' },
  blank: { flex: 1 },
  day: {
    flex: 1,
    minHeight: 60,
    minWidth: hit,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingVertical: 4,
    borderRadius: radius.chip,
    borderWidth: 1,
  },
  dayWrapped: {
    flexGrow: 1,
    flexBasis: 96,
    paddingHorizontal: 8,
  },
  tick: { position: 'absolute', top: 2, right: 3 },
  number: {
    fontFamily: faceFor('Newsreader', 400),
    fontSize: 21,
    fontVariant: ['tabular-nums'],
  },
  tag: {
    fontFamily: faceFor('Figtree', 600),
    fontSize: 11,
  },
  dimmed: { opacity: 0.45 },
});
