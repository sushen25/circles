import { AnswerRow, Chips, CompactButton, Label, Small, Track } from '../../components';
import { Between, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { AnswerView } from './view';

/**
 * "My answer": every day with times, in words (manifesto §5.4, the text is the
 * answer). A line opens to the day's half hours, for the one day that is not
 * quite a block; one day is open at a time. "Start over" clears the lot and
 * offers Undo until the next change (ADR 0024).
 */
type Props = {
  answers: readonly AnswerView[];
  canUndo: boolean;
  /** "I'm easy" is on, or an answer is on its way. */
  dimmed: boolean;
  onOpen?: ((day: number) => void) | undefined;
  onPaint?: ((day: number, cells: boolean[]) => void) | undefined;
  onWholeDay?: ((day: number) => void) | undefined;
  onRemoveDay?: ((day: number) => void) | undefined;
  onStartOver?: (() => void) | undefined;
  onUndo?: (() => void) | undefined;
};

export function AnswerList({
  answers,
  canUndo,
  dimmed,
  onOpen,
  onPaint,
  onWholeDay,
  onRemoveDay,
  onStartOver,
  onUndo,
}: Props) {
  const live = !dimmed;
  const anyTimes = answers.some((answer) => answer.cells.some(Boolean));

  return (
    <Stack gap={8}>
      <Label>{t('availability', 'my_answer')}</Label>
      {canUndo ? (
        <Between>
          <Small accessibilityLiveRegion="polite">{t('availability', 'cleared')}</Small>
          <CompactButton
            label={t('availability', 'undo')}
            tone="accent"
            disabled={!live}
            onPress={onUndo}
          />
        </Between>
      ) : null}
      {answers.length === 0 && !canUndo ? <Small>{t('availability', 'nothing_yet')}</Small> : null}
      {answers.map((answer) => (
        <AnswerRow
          key={answer.key}
          date={answer.short}
          range={answer.range}
          label={t('availability', 'adjust_day', { day: answer.spoken, time: answer.range })}
          open={answer.open && live}
          disabled={!live}
          onToggle={() => onOpen?.(answer.day)}
        >
          <Track
            day={answer.spoken}
            groupLabel={answer.spoken}
            cells={answer.cells}
            onChange={(cells) => onPaint?.(answer.day, cells)}
            startMinutes={0}
            labels={answer.labels}
            range={answer.range}
            marks={answer.marks}
            header={false}
          />
          <Chips>
            <CompactButton
              label={
                answer.wholeDay
                  ? t('availability', 'clear_this_day')
                  : t('availability', 'any_time_that_day')
              }
              // Which day, for somebody who cannot see the line above it.
              aria-label={
                answer.wholeDay
                  ? t('availability', 'clear_day', { day: answer.spoken })
                  : t('availability', 'any_time_on', { day: answer.spoken })
              }
              onPress={() => onWholeDay?.(answer.day)}
            />
            <CompactButton
              label={t('availability', 'remove_day')}
              aria-label={t('availability', 'remove_day_on', { day: answer.spoken })}
              icon="x"
              onPress={() => onRemoveDay?.(answer.day)}
            />
          </Chips>
        </AnswerRow>
      ))}
      {anyTimes ? (
        <CompactButton
          label={t('availability', 'start_over')}
          icon="x"
          disabled={!live}
          onPress={onStartOver}
        />
      ) : null}
    </Stack>
  );
}
