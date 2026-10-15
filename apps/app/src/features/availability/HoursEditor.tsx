import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, faceFor, hit, radius } from '@circles/tokens';

import { Icon, Label, Sheet, Small, Tertiary, usePalette } from '../../components';
import { spaceToPress } from '../../components/keys';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { addRange, cellsOf, removeRange, setEdge } from './hours';
import type { DayCardView } from './view';

/**
 * A day's hours as From – to pairs (SUS-206, ADR 0068, replacing the painted
 * half-hour row): each pair is two time buttons and a ×, a time button opens a
 * list of the times that edge may take, "Add another time" is for a gap in the
 * day, a thin bar shows the band with the hours filled in (decoration only), and
 * one line says when most others are free. The cells stay the answer (ADR 0009);
 * this only sets them, so a pair that runs into another merges with it.
 *
 * The picker is the app's `Sheet` with a list of buttons rather than a native
 * time input: the same on the web and on a phone, a half hour's step and the
 * plan's band for that day as its only choices (a native input offers every
 * minute and no bounds), and every row a button a keyboard can reach.
 */
type Props = {
  card: DayCardView;
  dimmed: boolean;
  onPaint?: ((day: number, cells: boolean[]) => void) | undefined;
};

type Picking = { index: number; which: 'from' | 'to' };

export function HoursEditor({ card, dimmed, onPaint }: Props) {
  const palette = usePalette();
  const [picking, setPicking] = useState<Picking | undefined>(undefined);
  const hours = card.hours;
  if (hours === undefined) return null;

  const ranges = hours.ranges.map(({ from, to }) => ({ from, to }));
  const paint = (next: { from: number; to: number }[]) =>
    onPaint?.(card.day, cellsOf(next, hours.length));
  const open = picking === undefined ? undefined : hours.ranges[picking.index];

  return (
    <Stack gap={12}>
      <Small>{t('availability', 'hours_guidance')}</Small>
      <Label>{t('availability', 'free_from')}</Label>
      {hours.ranges.map((range, index) => (
        <View key={range.from} style={styles.pair}>
          <TimeButton
            label={range.fromLabel}
            aria={t('availability', 'free_from_label', { day: card.spoken, time: range.fromLabel })}
            disabled={dimmed}
            onPress={() => setPicking({ index, which: 'from' })}
          />
          <Text style={[styles.to, { color: palette.ink2 }]}>{t('availability', 'hours_to')}</Text>
          <TimeButton
            label={range.toLabel}
            aria={t('availability', 'free_until_label', { day: card.spoken, time: range.toLabel })}
            disabled={dimmed}
            onPress={() => setPicking({ index, which: 'to' })}
          />
          {hours.canRemove ? (
            <Pressable
              role="button"
              aria-label={t('availability', 'remove_time', {
                day: card.spoken,
                time: `${range.fromLabel} – ${range.toLabel}`,
              })}
              aria-disabled={dimmed}
              disabled={dimmed}
              onPress={() => paint(removeRange(ranges, index))}
              {...spaceToPress(() => paint(removeRange(ranges, index)))}
              style={styles.remove}
            >
              <Icon name="x" size={16} color={palette.ink2} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {hours.canAdd ? (
        <Tertiary
          label={t('availability', 'add_another_time')}
          onPress={dimmed ? undefined : () => paint(addRange(ranges, hours.length))}
        />
      ) : null}
      <View aria-hidden style={styles.barWrap}>
        <View style={[styles.bar, { backgroundColor: palette.line }]}>
          {hours.bar.map((fill) => (
            <View
              key={fill.start}
              style={[
                styles.fill,
                {
                  backgroundColor: palette.accent,
                  left: `${fill.start * 100}%`,
                  width: `${(fill.end - fill.start) * 100}%`,
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.ticks}>
          {hours.ticks.map((tick, i) => (
            <Text key={i} style={[styles.tick, { color: palette.ink3 }]}>
              {tick}
            </Text>
          ))}
        </View>
      </View>
      {hours.others === undefined ? null : <Small>{hours.others}</Small>}
      <Sheet
        visible={open !== undefined}
        onDismiss={() => setPicking(undefined)}
        label={t('availability', picking?.which === 'to' ? 'pick_until' : 'pick_from')}
        dismissLabel={t('availability', 'sheet_dismiss')}
      >
        <Text style={[styles.pickTitle, { color: palette.ink }]}>
          {t('availability', picking?.which === 'to' ? 'pick_until' : 'pick_from')}
        </Text>
        <ScrollView style={styles.list} role="radiogroup">
          {open === undefined || picking === undefined
            ? null
            : (picking.which === 'from' ? open.fromOptions : open.toOptions).map((option) => {
                const chosen = option.boundary === (picking.which === 'from' ? open.from : open.to);
                const choose = () => {
                  paint(
                    setEdge(ranges, picking.index, picking.which, option.boundary, hours.length),
                  );
                  setPicking(undefined);
                };
                return (
                  <Pressable
                    key={option.boundary}
                    role="radio"
                    aria-checked={chosen}
                    aria-label={option.label}
                    onPress={choose}
                    {...spaceToPress(choose)}
                    style={[
                      styles.option,
                      { borderColor: palette.line },
                      chosen && { backgroundColor: color.accentSoft, borderColor: palette.accent },
                    ]}
                  >
                    <Text style={[styles.optionText, { color: palette.ink }]}>{option.label}</Text>
                    {chosen ? <Icon name="check" size={18} color={palette.accent} /> : null}
                  </Pressable>
                );
              })}
        </ScrollView>
      </Sheet>
    </Stack>
  );
}

function TimeButton({
  label,
  aria,
  disabled,
  onPress,
}: {
  label: string;
  aria: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      role="button"
      aria-label={aria}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      {...spaceToPress(onPress)}
      style={[styles.time, { backgroundColor: palette.surface, borderColor: palette.lineStrong }]}
    >
      <Text style={[styles.timeText, { color: palette.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  to: { fontFamily: faceFor('Figtree', 400), fontSize: 14 },
  time: {
    flex: 1,
    minHeight: hit,
    borderRadius: radius.control,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  timeText: { fontFamily: faceFor('Figtree', 600), fontSize: 16, fontVariant: ['tabular-nums'] },
  remove: { width: hit, height: hit, alignItems: 'center', justifyContent: 'center' },
  barWrap: { gap: 4 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, bottom: 0 },
  ticks: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: { fontFamily: faceFor('Figtree', 400), fontSize: 11 },
  pickTitle: { fontFamily: faceFor('Newsreader', 400), fontSize: 24 },
  list: { maxHeight: 320 },
  option: {
    minHeight: hit,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: 16,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionText: { fontFamily: faceFor('Figtree', 500), fontSize: 16, fontVariant: ['tabular-nums'] },
});
