import { BodyText, Body, Button, DisplayL, Foot, Screen, Tertiary, TopBar } from '../../components';
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
          <DisplayL>{t('availability', 'exact_title')}</DisplayL>
          <BodyText>{t('availability', 'exact_body')}</BodyText>
        </Stack>
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
      </Body>
      <Foot>
        <Button label={t('availability', 'done')} onPress={onDone} />
        <Tertiary
          tone="plain"
          label={t('availability', 'use_one_time')}
          onPress={busy ? undefined : onOneTime}
        />
      </Foot>
    </Screen>
  );
}
