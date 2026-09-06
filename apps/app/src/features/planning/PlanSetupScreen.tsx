import {
  Body,
  Button,
  Card,
  Chip,
  Chips,
  DisplayL,
  Foot,
  Label,
  Screen,
  Small,
  Title,
  TopBar,
} from '../../components';
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * PlanSetup — scaffolded from `docs/design/PlanSetup.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type PlanSetupProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function PlanSetupScreen({ onNext, onBack }: PlanSetupProps) {
  return (
    <Screen>
      <TopBar
        title={t('planSetup', 'plan_openly')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <DisplayL>{t('planSetup', 'catch_up')}</DisplayL>
        <Stack>
          <Label>{t('planSetup', 'what_are_we_doing')}</Label>
          <Chips>
            <Chip label={t('planSetup', 'catch_up')} selected={true} onPress={onNext} />
            <Chip label={t('planSetup', 'dinner')} selected={false} onPress={onNext} />
            <Chip label={t('planSetup', 'drinks')} selected={false} onPress={onNext} />
            <Chip label={t('planSetup', 'coffee')} selected={false} onPress={onNext} />
            <Chip label={t('planSetup', 'activity')} selected={false} onPress={onNext} />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('planSetup', 'when')}</Label>
          <Chips>
            <Chip label={t('planSetup', 'tonight')} selected={false} onPress={onNext} />
            <Chip label={t('planSetup', 'this_weekend')} selected={false} onPress={onNext} />
            <Chip label={t('planSetup', 'next_7_days')} selected={false} onPress={onNext} />
            <Chip label={t('planSetup', 'next_14_days')} selected={true} onPress={onNext} />
            <Chip label={t('planSetup', 'custom')} selected={false} onPress={onNext} />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('planSetup', 'how_long')}</Label>
          <Chips>
            <Chip label={t('planSetup', '1_hr')} selected={false} onPress={onNext} />
            <Chip label={t('planSetup', '1_5_hrs')} selected={false} onPress={onNext} />
            <Chip label={t('planSetup', '2_hrs')} selected={true} onPress={onNext} />
            <Chip label={t('planSetup', '3_hrs')} selected={false} onPress={onNext} />
          </Chips>
        </Stack>
        <Card>
          <Row>
            <Stack>
              <Title>{t('planSetup', 'at_least_4_of_6_need_to')}</Title>
              <Small>{t('planSetup', 'so_one_busy_week_doesnt_sink_the')}</Small>
            </Stack>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('planSetup', 'replies_close_in_3_days')}</Title>
              <Small>{t('planSetup', 'tue_15_sep_6_pm_you_can')}</Small>
            </Stack>
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button label={t('planSetup', 'ask_the_group')} onPress={onNext} />
        <Small>{t('planSetup', 'well_give_you_a_short_message_to')}</Small>
      </Foot>
    </Screen>
  );
}
