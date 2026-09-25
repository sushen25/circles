import { DURATIONS, type DurationMinutes } from '@circles/domain';

import { Card, Chip, Chips, Label, Small, Title } from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import { BandPicker, SettingLine, Stepper, type BandPickerProps } from './parts';
import { durationLabel } from './words';

/**
 * The plan's settings, as PlanSetup and EditPlan both draw them (the two
 * artboards are the same controls, one empty and one prefilled): when, what
 * hours, how long, and the card of quorum, who has to be there and when
 * replies close.
 */
export type WhenChip = {
  key: string;
  label: string;
  selected: boolean;
  /** Not on offer right now — tonight, late in the evening. Shown, and said so. */
  disabled?: boolean | undefined;
  onPress: () => void;
};

export type PlanControlsProps = {
  when: WhenChip[];
  /** Why a chip is off: "Too late for tonight. Try this weekend." */
  whenNote?: string | undefined;
  band: BandPickerProps;
  duration: DurationMinutes;
  onDuration: (duration: DurationMinutes) => void;
  quorum: {
    line: string;
    detail: string;
    canFewer: boolean;
    canMore: boolean;
    onFewer: () => void;
    onMore: () => void;
  };
  required: { title: string; detail: string; onChange?: (() => void) | undefined };
  closes: { title: string; detail: string; onChange?: (() => void) | undefined };
};

export function PlanControls({
  when,
  whenNote,
  band,
  duration,
  onDuration,
  quorum,
  required,
  closes,
}: PlanControlsProps) {
  return (
    <>
      <Stack gap={10}>
        <Label>{t('planSetup', 'when')}</Label>
        <Chips>
          {when.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              selected={chip.selected}
              disabled={chip.disabled}
              onPress={chip.onPress}
            />
          ))}
        </Chips>
        {whenNote === undefined ? null : <Small>{whenNote}</Small>}
      </Stack>
      <BandPicker {...band} />
      <Stack gap={10}>
        <Label>{t('planSetup', 'how_long')}</Label>
        <Chips>
          {DURATIONS.map((minutes) => (
            <Chip
              key={minutes}
              label={durationLabel(minutes)}
              selected={duration === minutes}
              onPress={() => onDuration(minutes)}
            />
          ))}
        </Chips>
      </Stack>
      <Card>
        <Stack>
          <Title>{quorum.line}</Title>
          <Small>{quorum.detail}</Small>
        </Stack>
        <Stepper
          fewerLabel={t('planSetup', 'fewer_short')}
          moreLabel={t('planSetup', 'more_short')}
          fewerSpoken={t('planSetup', 'fewer')}
          moreSpoken={t('planSetup', 'more')}
          canFewer={quorum.canFewer}
          canMore={quorum.canMore}
          onFewer={quorum.onFewer}
          onMore={quorum.onMore}
        />
        <Divider />
        <SettingLine title={required.title} detail={required.detail} onChange={required.onChange} />
        <Divider />
        <SettingLine title={closes.title} detail={closes.detail} onChange={closes.onChange} />
      </Card>
    </>
  );
}
