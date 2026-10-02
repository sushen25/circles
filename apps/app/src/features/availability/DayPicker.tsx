import { StyleSheet, View } from 'react-native';

import {
  Card,
  Chip,
  Chips,
  CompactButton,
  DayGrid,
  Icon,
  Small,
  Title,
  type GridDay,
  usePalette,
} from '../../components';
import { Between, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { BlockKind } from './blocks';
import type { PanelView } from './view';

/**
 * Days first, then a time once for all of them (ADR 0024): the plan's days as
 * a calendar, and under it the card that turns ticked days into an answer.
 *
 * Ticking a day sets no time by itself. The chips are checkboxes over the
 * ticked days, and the days stay ticked after one is tapped, so Afternoon and
 * Evening is two taps; Done is what lets go of them.
 */
type Props = {
  grid: readonly GridDay[];
  weekdays: readonly string[];
  panel: PanelView | undefined;
  /**
   * Above the grid, the legend for every count on the screen: "5 of 6 have
   * answered. The number on each day is how many of them could make it."
   * Undefined when nothing is known about the others (SUS-129).
   */
  othersLine?: string | undefined;
  /** "I'm easy" is on, or an answer is on its way. */
  dimmed: boolean;
  onTick?: ((day: number) => void) | undefined;
  onDone?: (() => void) | undefined;
  onBlock?: ((kind: BlockKind) => void) | undefined;
  onClearTicked?: (() => void) | undefined;
};

export function DayPicker({
  grid,
  weekdays,
  panel,
  othersLine,
  dimmed,
  onTick,
  onDone,
  onBlock,
  onClearTicked,
}: Props) {
  const live = !dimmed;
  const palette = usePalette();

  return (
    <Stack gap={14}>
      {othersLine === undefined ? null : (
        <View style={[styles.line, dimmed && styles.dimmed]}>
          <View style={styles.icon}>
            <Icon name="people" size={16} color={palette.ink2} />
          </View>
          <Small style={styles.words}>{othersLine}</Small>
        </View>
      )}
      <DayGrid
        days={grid}
        weekdays={weekdays}
        label={t('availability', 'days_group')}
        onToggle={onTick}
        dimmed={dimmed}
      />
      <Card gap={12} padding={16} dimmed={dimmed}>
        {panel === undefined ? (
          <Small>{t('availability', 'pick_days')}</Small>
        ) : (
          <>
            <Between>
              <Title>{panel.title}</Title>
              <CompactButton
                label={t('availability', 'done')}
                icon="check"
                tone="accent"
                disabled={!live}
                onPress={onDone}
              />
            </Between>
            <Chips>
              {panel.blocks.map((block) => (
                <Chip
                  key={block.kind}
                  label={block.label}
                  detail={block.detail}
                  others={block.others}
                  selected={block.on}
                  disabled={!live}
                  onPress={() => onBlock?.(block.kind)}
                />
              ))}
            </Chips>
            {panel.canClear ? (
              <CompactButton
                label={t('availability', 'clear_these_days')}
                icon="x"
                disabled={!live}
                onPress={onClearTicked}
              />
            ) : null}
          </>
        )}
      </Card>
    </Stack>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  icon: { paddingTop: 2 },
  words: { flexShrink: 1 },
  // Faded with the grid under "I'm easy", as the counts are.
  dimmed: { opacity: 0.45 },
});
