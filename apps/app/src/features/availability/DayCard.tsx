import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, faceFor, hit, radius } from '@circles/tokens';

import { Tertiary, usePalette } from '../../components';
import { t } from '../../copy';
import type { BlockKind } from './blocks';
import { HoursEditor } from './HoursEditor';
import type { DayCardView } from './view';

/**
 * One tapped day on "A time for each day" (SUS-206, ADR 0068): the day, the
 * hours it covers, a row of the plan's quick choices that sets this day alone,
 * and "By the half hour", which opens the day's cells with what the others said
 * over each (SUS-129). A day whose hours are none of the choices says so, and
 * none is selected.
 */
type Props = {
  card: DayCardView;
  dimmed: boolean;
  onChoose?: ((day: number, kind: BlockKind) => void) | undefined;
  onOpen?: ((day: number) => void) | undefined;
  onPaint?: ((day: number, cells: boolean[]) => void) | undefined;
};

/** `aria-pressed` on the web; native has no pressed state to announce, so `selected`. */
const pressed = (on: boolean): Record<string, unknown> =>
  Platform.OS === 'web' ? { 'aria-pressed': on } : { 'aria-selected': on };

export function DayCard({ card, dimmed, onChoose, onOpen, onPaint }: Props) {
  const palette = usePalette();

  return (
    <View
      role="group"
      aria-label={card.spoken}
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.line },
        card.own && { borderColor: palette.accent },
      ]}
    >
      <View style={styles.head}>
        <Text style={[styles.day, { color: palette.ink }]}>{card.name}</Text>
        <Text style={[styles.time, { color: palette.ink2 }]}>{card.time}</Text>
      </View>
      <View style={styles.choices}>
        {card.choices.map((choice) => (
          <Pressable
            key={choice.kind}
            role="button"
            {...pressed(choice.on)}
            aria-label={t('availability', 'day_choice', { choice: choice.label, day: card.spoken })}
            aria-disabled={dimmed}
            disabled={dimmed}
            onPress={() => onChoose?.(card.day, choice.kind)}
            style={[
              styles.choice,
              { backgroundColor: palette.surface, borderColor: palette.lineStrong },
              choice.on && { backgroundColor: color.accentSoft, borderColor: palette.accent },
            ]}
          >
            <Text style={[styles.choiceText, { color: palette.ink }]}>{choice.label}</Text>
          </Pressable>
        ))}
      </View>
      <Tertiary
        label={t('availability', 'set_exact_hours')}
        aria-label={t('availability', 'adjust_day', { day: card.spoken, time: card.range })}
        aria-expanded={card.open}
        onPress={dimmed ? undefined : () => onOpen?.(card.day)}
      />
      {card.open ? <HoursEditor card={card} dimmed={dimmed} onPaint={onPaint} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.card, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  day: { fontFamily: faceFor('Newsreader', 400), fontSize: 20 },
  time: { fontFamily: faceFor('Figtree', 400), fontSize: 13, flexShrink: 1, textAlign: 'right' },
  choices: { flexDirection: 'row', gap: 6 },
  choice: {
    flex: 1,
    minHeight: hit,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  choiceText: { fontFamily: faceFor('Figtree', 600), fontSize: 14 },
});
