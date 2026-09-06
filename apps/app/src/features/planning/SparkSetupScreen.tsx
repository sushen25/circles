import {
  Body,
  BodyText,
  Button,
  Chip,
  Chips,
  DisplayL,
  Foot,
  Label,
  Notice,
  Screen,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * SparkSetup — scaffolded from `docs/design/SparkSetup.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type SparkSetupProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function SparkSetupScreen({ onNext, onBack }: SparkSetupProps) {
  return (
    <Screen>
      <TopBar
        title={t('sparkSetup', 'see_if_people_are_keen')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('sparkSetup', 'ask_quietly')}</DisplayL>
          <BodyText>{t('sparkSetup', 'nobody_sees_who_asked_if_three_people')}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('sparkSetup', 'for_when')}</Label>
          <Chips>
            <Chip label={t('sparkSetup', 'tonight')} selected={false} onPress={onNext} />
            <Chip label={t('sparkSetup', 'this_weekend')} selected={true} onPress={onNext} />
            <Chip label={t('sparkSetup', 'next_7_days')} selected={false} onPress={onNext} />
            <Chip label={t('sparkSetup', 'next_14_days')} selected={false} onPress={onNext} />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('sparkSetup', 'to_do_what')}</Label>
          <Chips>
            <Chip label={t('sparkSetup', 'anything')} selected={true} onPress={onNext} />
            <Chip label={t('sparkSetup', 'dinner')} selected={false} onPress={onNext} />
            <Chip label={t('sparkSetup', 'drinks')} selected={false} onPress={onNext} />
            <Chip label={t('sparkSetup', 'coffee')} selected={false} onPress={onNext} />
            <Chip label={t('sparkSetup', 'activity')} selected={false} onPress={onNext} />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('sparkSetup', 'stop_asking')}</Label>
          <Chips>
            <Chip label={t('sparkSetup', 'tonight_9_pm')} selected={false} onPress={onNext} />
            <Chip label={t('sparkSetup', 'friday_midday')} selected={true} onPress={onNext} />
            <Chip
              label={t('sparkSetup', 'when_the_weekend_starts')}
              selected={false}
              onPress={onNext}
            />
          </Chips>
        </Stack>
        <Notice>{t('sparkSetup', 'in_a_group_this_size_people_can')}</Notice>
      </Body>
      <Foot>
        <Button label={t('sparkSetup', 'ask_quietly')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
