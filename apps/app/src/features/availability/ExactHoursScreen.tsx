import {
  AnswerRow,
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Screen,
  Small,
  Tertiary,
  Track,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { BlockKind } from './blocks';
import { DayCard } from './DayCard';
import type { DayCardView } from './view';

/**
 * "A time for each day" (SUS-206, ADR 0068; the half-hour cells are ADR 0009):
 * the one place a day can differ from the others. Each tapped day is a card with
 * the plan's quick choices, and "By the half hour" opens its cells. Done goes
 * back to the first screen, and "Use one time for all days" goes back with the
 * shared time. Presentational, like `AvailabilityScreen`.
 */
type Props = {
  title?: string | undefined;
  /**
   * The plan leaves one window, so there is nothing to choose: a plain list of
   * the tapped days, each with its hours, opening to its half hours.
   */
  single?: { heading: string; body: string } | undefined;
  cards: readonly DayCardView[];
  busy?: boolean | undefined;
  onChoose?: ((day: number, kind: BlockKind) => void) | undefined;
  onOpen?: ((day: number) => void) | undefined;
  onPaint?: ((day: number, cells: boolean[]) => void) | undefined;
  onOneTime?: (() => void) | undefined;
  onDone?: (() => void) | undefined;
};

export function ExactHoursScreen({
  title,
  single,
  cards,
  busy = false,
  onChoose,
  onOpen,
  onPaint,
  onOneTime,
  onDone,
}: Props) {
  return (
    <Screen>
      <TopBar title={title} onBack={onDone} backLabel={t('availability', 'back_to_my_answer')} />
      <Body>
        <Stack>
          <DisplayL>{single?.heading ?? t('availability', 'exact_title')}</DisplayL>
          <BodyText>{single?.body ?? t('availability', 'exact_body')}</BodyText>
        </Stack>
        {single === undefined ? (
          <Stack gap={12}>
            {cards.map((card) => (
              <DayCard
                key={card.key}
                card={card}
                dimmed={busy}
                onChoose={onChoose}
                onOpen={onOpen}
                onPaint={onPaint}
              />
            ))}
          </Stack>
        ) : (
          <Stack gap={0}>
            {cards.map((card) => (
              <AnswerRow
                key={card.key}
                date={card.name}
                range={card.time}
                label={t('availability', 'adjust_day', { day: card.spoken, time: card.range })}
                open={card.open}
                disabled={busy}
                onToggle={() => onOpen?.(card.day)}
              >
                {card.peak === undefined ? null : <Small>{card.peak}</Small>}
                <Track
                  day={card.spoken}
                  groupLabel={card.spoken}
                  cells={card.cells}
                  onChange={(cells) => onPaint?.(card.day, cells)}
                  startMinutes={0}
                  labels={card.labels}
                  range={card.range}
                  marks={card.marks}
                  counts={card.counts}
                  header={false}
                  dimmed={busy}
                />
              </AnswerRow>
            ))}
          </Stack>
        )}
      </Body>
      <Foot>
        <Button label={t('availability', 'done')} onPress={onDone} />
        {single === undefined ? (
          <Tertiary
            tone="plain"
            label={t('availability', 'use_one_time')}
            onPress={busy ? undefined : onOneTime}
          />
        ) : null}
      </Foot>
    </Screen>
  );
}
