import { BodyText, Body, Button, DisplayL, Foot, Screen, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import { AnswerList } from './AnswerList';
import type { AnswerView } from './view';

/**
 * Exact hours (SUS-206, ADR 0068; the half-hour cells are ADR 0009): the one
 * place the answer is set day by day. Each tapped day is a line that opens to
 * its half hours, with what the others said by the half hour over them
 * (SUS-129). Presentational, like `AvailabilityScreen`; the container owns the
 * answer and comes back to the first screen on Done.
 */
type Props = {
  title?: string | undefined;
  answers: readonly AnswerView[];
  canUndo: boolean;
  busy?: boolean | undefined;
  onOpen?: ((day: number) => void) | undefined;
  onPaint?: ((day: number, cells: boolean[]) => void) | undefined;
  onWholeDay?: ((day: number) => void) | undefined;
  onRemoveDay?: ((day: number) => void) | undefined;
  onStartOver?: (() => void) | undefined;
  onUndo?: (() => void) | undefined;
  onDone?: (() => void) | undefined;
};

export function ExactHoursScreen({
  title,
  answers,
  canUndo,
  busy = false,
  onOpen,
  onPaint,
  onWholeDay,
  onRemoveDay,
  onStartOver,
  onUndo,
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
        <AnswerList
          answers={answers}
          canUndo={canUndo}
          dimmed={busy}
          onOpen={onOpen}
          onPaint={onPaint}
          onWholeDay={onWholeDay}
          onRemoveDay={onRemoveDay}
          onStartOver={onStartOver}
          onUndo={onUndo}
        />
      </Body>
      <Foot>
        <Button label={t('availability', 'done')} onPress={onDone} />
      </Foot>
    </Screen>
  );
}
