import {
  Card,
  Chip,
  Chips,
  CompactButton,
  DayGrid,
  Small,
  Title,
  type GridDay,
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
  dimmed,
  onTick,
  onDone,
  onBlock,
  onClearTicked,
}: Props) {
  const live = !dimmed;

  return (
    <Stack gap={14}>
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
                  selected={block.on}
                  onPress={live ? () => onBlock?.(block.kind) : undefined}
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
