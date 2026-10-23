import type { DurationMinutes } from '@circles/domain';

import { Button, Chip, Chips, Label, Sheet, Small, Tertiary, Title } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Band } from './form';
import {
  EVENINGS,
  DAYS_AND_EVENINGS,
  LENGTHS,
  bandHours,
  lengthLabel,
  type TimeOfDay,
} from './firstEvenings';

/**
 * Adjust, on the first run's evenings screen (SUS-247): the three things a
 * first plan may still want to change, and the way to everything else. Time of
 * day, how long, and when replies close; **More options** goes to the full plan
 * setup, in its draft mode, where the dates, the exact hours, the kind of plan
 * and who has to be there are.
 *
 * It rises on the drawer curve in 240 ms and leaves in 180 (`Sheet`'s
 * `drawer`). What is picked is written to the draft as it is picked, so there
 * is nothing to confirm: **Done** only closes.
 */
export type AdjustSheetProps = {
  visible: boolean;
  timeOfDay: TimeOfDay | undefined;
  duration: DurationMinutes;
  /** The reply times on offer, ISO, with the words for each; the picked one. */
  replies: { iso: string; label: string }[];
  repliesPicked: string | undefined;
  onTimeOfDay: (choice: TimeOfDay) => void;
  onDuration: (duration: DurationMinutes) => void;
  onReplies: (iso: string) => void;
  onDone: () => void;
  onMore: () => void;
};

export function AdjustSheet({
  visible,
  timeOfDay,
  duration,
  replies,
  repliesPicked,
  onTimeOfDay,
  onDuration,
  onReplies,
  onDone,
  onMore,
}: AdjustSheetProps) {
  const bands: readonly [TimeOfDay, Band, string][] = [
    ['evenings', EVENINGS, t('firstRun', 'evenings_hours', { time: bandHours(EVENINGS) })],
    [
      'days',
      DAYS_AND_EVENINGS,
      t('firstRun', 'days_hours', { time: bandHours(DAYS_AND_EVENINGS) }),
    ],
  ];

  return (
    <Sheet
      visible={visible}
      drawer
      onDismiss={onDone}
      label={t('firstRun', 'sheet_title')}
      dismissLabel={t('firstRun', 'sheet_dismiss')}
    >
      <Title>{t('firstRun', 'sheet_title')}</Title>
      <Stack gap={8}>
        <Label>{t('firstRun', 'time_of_day')}</Label>
        <Chips>
          {bands.map(([choice, , label]) => (
            <Chip
              key={choice}
              label={label}
              selected={timeOfDay === choice}
              onPress={() => onTimeOfDay(choice)}
            />
          ))}
        </Chips>
      </Stack>
      <Stack gap={8}>
        <Label>{t('firstRun', 'how_long')}</Label>
        <Chips>
          {LENGTHS.map((length) => (
            <Chip
              key={length}
              label={lengthLabel(length)}
              selected={duration === length}
              onPress={() => onDuration(length)}
            />
          ))}
        </Chips>
      </Stack>
      {replies.length < 2 ? null : (
        <Stack gap={8}>
          <Label>{t('firstRun', 'replies_close')}</Label>
          <Chips>
            {replies.map((reply) => (
              <Chip
                key={reply.iso}
                label={reply.label}
                selected={repliesPicked === reply.iso}
                onPress={() => onReplies(reply.iso)}
              />
            ))}
          </Chips>
        </Stack>
      )}
      <Small>{t('firstRun', 'sheet_note')}</Small>
      <Stack gap={4}>
        <Button label={t('firstRun', 'done')} onPress={onDone} />
        <Tertiary label={t('firstRun', 'more_options')} onPress={onMore} />
      </Stack>
    </Sheet>
  );
}
