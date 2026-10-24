import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { color, hit } from '@circles/tokens';

import { BodyText, DateText, Icon, Pills, Small, usePalette } from '../../components';
import { spaceToPress } from '../../components/keys';
import { t } from '../../copy';
import type { BlockKind } from './blocks';
import type { DayRowView } from './view';

/**
 * One tapped day on "A time for each day" (SUS-236, ADR 0079): the day, the
 * plan's choices as small pills that set this day alone, and a round clock that
 * opens the day's hours. A day whose hours are none of the choices has none
 * selected, its clock lit and its hours under its name. On a plan with one
 * window there is nothing to pick: the hours stand where the pills would.
 */
type Props = {
  row: DayRowView;
  first: boolean;
  locked: boolean;
  onChoose?: ((day: number, kind: BlockKind) => void) | undefined;
  onOpen?: ((day: number) => void) | undefined;
};

/** The day (76), the pills (200), the clock (40) and the gaps between them. */
const NEEDED_BESIDE = 76 + 200 + 40 + 20;

export function DayRow({ row, first, locked, onChoose, onOpen }: Props) {
  const palette = usePalette();
  const open = locked ? undefined : () => onOpen?.(row.day);
  // Beside the day the pills need room to read whole ("Evening", "Daytime", "Any"); below this they go under it.
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const stacked =
    row.choices.length > 0 && width > 0 && width < NEEDED_BESIDE * Math.max(1, fontScale);
  const plain = row.choices.length === 0;
  // The wording of "Any time" is too long for the small pill.
  const pills = row.choices.map((choice) => ({
    key: choice.kind,
    label: choice.kind === 'any_time' ? t('availability', 'any_short') : choice.label,
    name: choice.label,
    on: choice.on,
  }));

  const nameBlock = (
    <View style={styles.name}>
      <DateText style={styles.day}>{row.name}</DateText>
      {row.own && !plain ? (
        <Small style={[styles.own, { color: palette.accent }]}>{row.range}</Small>
      ) : null}
    </View>
  );
  const clock = (
    <Pressable
      role="button"
      aria-label={t('availability', row.own ? 'exact_hours_for_own' : 'exact_hours_for', {
        day: row.spoken,
        hours: row.range,
      })}
      aria-disabled={locked}
      disabled={locked}
      onPress={open}
      {...spaceToPress(open)}
      style={[
        styles.clock,
        { backgroundColor: palette.surface, borderColor: palette.lineStrong },
        row.own && { backgroundColor: color.accentSoft, borderColor: palette.accent },
      ]}
    >
      <Icon name="clock" size={18} color={row.own ? palette.accent : palette.ink2} />
    </Pressable>
  );
  const choices = plain ? (
    <View style={styles.plain}>
      <BodyText>{row.range}</BodyText>
    </View>
  ) : (
    <Pills
      pills={pills}
      size="small"
      label={row.spoken}
      disabled={locked}
      onChoose={(kind) => onChoose?.(row.day, kind as BlockKind)}
    />
  );

  return (
    <View
      role="group"
      aria-label={row.spoken}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[
        styles.row,
        stacked && styles.rowStacked,
        { borderColor: palette.line },
        first && styles.first,
      ]}
    >
      {stacked ? (
        <>
          {/* The pills come whole or not beside the day: under it, with the clock at the end of the first line. */}
          <View style={styles.top}>
            {nameBlock}
            <View style={styles.grow} />
            {clock}
          </View>
          {choices}
        </>
      ) : (
        <>
          {nameBlock}
          {choices}
          {clock}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  first: { borderTopWidth: 1 },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  name: { width: 76, gap: 2 },
  day: { fontSize: 20, lineHeight: 24 },
  own: { fontWeight: '600' },
  plain: { flex: 1, minWidth: 120 },
  clock: {
    width: hit - 4,
    height: hit - 4,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
