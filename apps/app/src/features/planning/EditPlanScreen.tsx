import {
  Body,
  Button,
  Card,
  Chip,
  Chips,
  DisplayL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * EditPlan — scaffolded from `docs/design/EditPlan.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type EditPlanProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onKeepThePlanAs?: (() => void) | undefined;
};

export function EditPlanScreen({ onNext, onBack, onKeepThePlanAs }: EditPlanProps) {
  return (
    <Screen>
      <TopBar title={t('editPlan', 'edit_plan')} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{t('editPlan', 'catch_up')}</DisplayL>
        <Stack>
          <Label>{t('editPlan', 'when')}</Label>
          <Chips>
            <Chip label={t('editPlan', 'tonight')} selected={false} onPress={onNext} />
            <Chip label={t('editPlan', 'this_weekend')} selected={false} onPress={onNext} />
            <Chip label={t('editPlan', 'next_7_days')} selected={false} onPress={onNext} />
            <Chip label={t('editPlan', 'next_14_days')} selected={false} onPress={onNext} />
            <Chip label={t('editPlan', 'custom_21_27_sep')} selected={true} onPress={onNext} />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('editPlan', 'how_long')}</Label>
          <Chips>
            <Chip label={t('editPlan', '1_hr')} selected={false} onPress={onNext} />
            <Chip label={t('editPlan', '1_5_hrs')} selected={false} onPress={onNext} />
            <Chip label={t('editPlan', '2_hrs')} selected={true} onPress={onNext} />
            <Chip label={t('editPlan', '3_hrs')} selected={false} onPress={onNext} />
          </Chips>
        </Stack>
        <Card>
          <Row>
            <Stack>
              <Title>{t('editPlan', 'at_least_4_of_6_need_to')}</Title>
              <Small>{t('editPlan', 'unchanged')}</Small>
            </Stack>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('editPlan', 'replies_close_fri_18_sep_6_pm')}</Title>
              <Small>{t('editPlan', 'moved_to_match_the_new_dates')}</Small>
            </Stack>
          </Row>
        </Card>
        <Notice kind="warn">{t('editPlan', 'changing_the_dates_means_priya_tom_jess')}</Notice>
      </Body>
      <Foot>
        <Button label={t('editPlan', 'save_and_ask_again')} onPress={onNext} />
        <Tertiary label={t('editPlan', 'keep_the_plan_as_it_is')} onPress={onKeepThePlanAs} />
      </Foot>
    </Screen>
  );
}
