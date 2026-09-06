import {
  Body,
  BodyText,
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
 * PlanAnother — scaffolded from `docs/design/PlanAnother.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type PlanAnotherProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function PlanAnotherScreen({ onNext, onBack }: PlanAnotherProps) {
  return (
    <Screen>
      <TopBar
        title={t('planAnother', 'plan_another')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('planAnother', 'same_as_last_time')}</DisplayL>
          <BodyText>{t('planAnother', 'filled_in_from_septembers_catch_up_change')}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('planAnother', 'what_are_we_doing')}</Label>
          <Chips>
            <Chip label={t('planAnother', 'catch_up')} selected={true} onPress={onNext} />
            <Chip label={t('planAnother', 'dinner')} selected={false} onPress={onNext} />
            <Chip label={t('planAnother', 'drinks')} selected={false} onPress={onNext} />
            <Chip label={t('planAnother', 'coffee')} selected={false} onPress={onNext} />
            <Chip label={t('planAnother', 'activity')} selected={false} onPress={onNext} />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('planAnother', 'when')}</Label>
          <Chips>
            <Chip label={t('planAnother', 'tonight')} selected={false} onPress={onNext} />
            <Chip label={t('planAnother', 'this_weekend')} selected={false} onPress={onNext} />
            <Chip label={t('planAnother', 'next_7_days')} selected={false} onPress={onNext} />
            <Chip label={t('planAnother', 'next_14_days')} selected={true} onPress={onNext} />
            <Chip label={t('planAnother', 'custom')} selected={false} onPress={onNext} />
          </Chips>
        </Stack>
        <Card>
          <Row>
            <Stack>
              <Title>{t('planAnother', '2_hours_at_least_4_of_6')}</Title>
              <Small>{t('planAnother', 'same_as_last_time')}</Small>
            </Stack>
            <Small>{t('planAnother', 'change')}</Small>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('planAnother', 'replies_close_in_3_days')}</Title>
              <Small>{t('planAnother', 'fri_16_oct_6_pm')}</Small>
            </Stack>
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button label={t('planAnother', 'ask_the_group')} onPress={onNext} />
        <Button
          label={t('planAnother', 'see_if_people_are_keen_instead')}
          variant="secondary"
          onPress={onNext}
        />
      </Foot>
    </Screen>
  );
}
