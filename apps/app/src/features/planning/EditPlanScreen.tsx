import { useState } from 'react';

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
  const [choice0, setChoice0] = useState(4); // Chip group
  const [choice1, setChoice1] = useState(2); // Chip group

  return (
    <Screen>
      <TopBar title={t('editPlan', 'edit_plan')} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{t('editPlan', 'catch_up')}</DisplayL>
        <Stack>
          <Label>{t('editPlan', 'when')}</Label>
          <Chips>
            <Chip
              label={t('editPlan', 'tonight')}
              selected={choice0 === 0}
              onPress={() => setChoice0(0)}
            />
            <Chip
              label={t('editPlan', 'this_weekend')}
              selected={choice0 === 1}
              onPress={() => setChoice0(1)}
            />
            <Chip
              label={t('editPlan', 'next_7_days')}
              selected={choice0 === 2}
              onPress={() => setChoice0(2)}
            />
            <Chip
              label={t('editPlan', 'next_14_days')}
              selected={choice0 === 3}
              onPress={() => setChoice0(3)}
            />
            <Chip
              label={t('editPlan', 'custom_21_27_sep')}
              selected={choice0 === 4}
              onPress={() => setChoice0(4)}
            />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('editPlan', 'how_long')}</Label>
          <Chips>
            <Chip
              label={t('editPlan', '1_hr')}
              selected={choice1 === 0}
              onPress={() => setChoice1(0)}
            />
            <Chip
              label={t('editPlan', '1_5_hrs')}
              selected={choice1 === 1}
              onPress={() => setChoice1(1)}
            />
            <Chip
              label={t('editPlan', '2_hrs')}
              selected={choice1 === 2}
              onPress={() => setChoice1(2)}
            />
            <Chip
              label={t('editPlan', '3_hrs')}
              selected={choice1 === 3}
              onPress={() => setChoice1(3)}
            />
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
