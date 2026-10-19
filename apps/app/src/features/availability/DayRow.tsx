import { Pressable, StyleSheet, View } from 'react-native';

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

export function DayRow({ row, first, locked, onChoose, onOpen }: Props) {
  const palette = usePalette();
  const open = locked ? undefined : () => onOpen?.(row.day);
  const plain = row.choices.length === 0;
  // The wording of "Any time" is too long for the small pill.
  const pills = row.choices.map((choice) => ({
    key: choice.kind,
    label: choice.kind === 'any_time' ? t('availability', 'any_short') : choice.label,
    name: choice.label,
    on: choice.on,
  }));

  return (
    <View
      role="group"
      aria-label={row.spoken}
      style={[styles.row, { borderColor: palette.line }, first && styles.first]}
    >
      <View style={styles.name}>
        <DateText style={styles.day}>{row.name}</DateText>
        {row.own && !plain ? (
          <Small style={[styles.own, { color: palette.accent }]}>{row.range}</Small>
        ) : null}
      </View>
      {plain ? (
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
      )}
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
  name: { width: 76, gap: 2 },
  day: { fontSize: 20, lineHeight: 24 },
  own: { fontWeight: '600' },
  plain: { flex: 1 },
  clock: {
    width: hit - 4,
    height: hit - 4,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
