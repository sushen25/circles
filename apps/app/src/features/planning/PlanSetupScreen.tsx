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
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function PlanSetupScreen({ onNext, onBack }: PlanSetupProps) {
  const [choice0, setChoice0] = useState(0); // Chip group
  const [choice1, setChoice1] = useState(3); // Chip group
  const [choice2, setChoice2] = useState(2); // Chip group

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
            <Chip
              label={t('planSetup', 'catch_up')}
              selected={choice0 === 0}
              onPress={() => setChoice0(0)}
            />
            <Chip
              label={t('planSetup', 'dinner')}
              selected={choice0 === 1}
              onPress={() => setChoice0(1)}
            />
            <Chip
              label={t('planSetup', 'drinks')}
              selected={choice0 === 2}
              onPress={() => setChoice0(2)}
            />
            <Chip
              label={t('planSetup', 'coffee')}
              selected={choice0 === 3}
              onPress={() => setChoice0(3)}
            />
            <Chip
              label={t('planSetup', 'activity')}
              selected={choice0 === 4}
              onPress={() => setChoice0(4)}
            />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('planSetup', 'when')}</Label>
          <Chips>
            <Chip
              label={t('planSetup', 'tonight')}
              selected={choice1 === 0}
              onPress={() => setChoice1(0)}
            />
            <Chip
              label={t('planSetup', 'this_weekend')}
              selected={choice1 === 1}
              onPress={() => setChoice1(1)}
            />
            <Chip
              label={t('planSetup', 'next_7_days')}
              selected={choice1 === 2}
              onPress={() => setChoice1(2)}
            />
            <Chip
              label={t('planSetup', 'next_14_days')}
              selected={choice1 === 3}
              onPress={() => setChoice1(3)}
            />
            <Chip
              label={t('planSetup', 'custom')}
              selected={choice1 === 4}
              onPress={() => setChoice1(4)}
            />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('planSetup', 'how_long')}</Label>
          <Chips>
            <Chip
              label={t('planSetup', '1_hr')}
              selected={choice2 === 0}
              onPress={() => setChoice2(0)}
            />
            <Chip
              label={t('planSetup', '1_5_hrs')}
              selected={choice2 === 1}
              onPress={() => setChoice2(1)}
            />
            <Chip
              label={t('planSetup', '2_hrs')}
              selected={choice2 === 2}
              onPress={() => setChoice2(2)}
            />
            <Chip
              label={t('planSetup', '3_hrs')}
              selected={choice2 === 3}
              onPress={() => setChoice2(3)}
            />
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
