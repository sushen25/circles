import { useState } from 'react';

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
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSeeIfPeopleAre?: (() => void) | undefined;
};

export function PlanAnotherScreen({ onNext, onBack, onSeeIfPeopleAre }: PlanAnotherProps) {
  const [choice0, setChoice0] = useState(0); // Chip group
  const [choice1, setChoice1] = useState(3); // Chip group

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
            <Chip
              label={t('planAnother', 'catch_up')}
              selected={choice0 === 0}
              onPress={() => setChoice0(0)}
            />
            <Chip
              label={t('planAnother', 'dinner')}
              selected={choice0 === 1}
              onPress={() => setChoice0(1)}
            />
            <Chip
              label={t('planAnother', 'drinks')}
              selected={choice0 === 2}
              onPress={() => setChoice0(2)}
            />
            <Chip
              label={t('planAnother', 'coffee')}
              selected={choice0 === 3}
              onPress={() => setChoice0(3)}
            />
            <Chip
              label={t('planAnother', 'activity')}
              selected={choice0 === 4}
              onPress={() => setChoice0(4)}
            />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('planAnother', 'when')}</Label>
          <Chips>
            <Chip
              label={t('planAnother', 'tonight')}
              selected={choice1 === 0}
              onPress={() => setChoice1(0)}
            />
            <Chip
              label={t('planAnother', 'this_weekend')}
              selected={choice1 === 1}
              onPress={() => setChoice1(1)}
            />
            <Chip
              label={t('planAnother', 'next_7_days')}
              selected={choice1 === 2}
              onPress={() => setChoice1(2)}
            />
            <Chip
              label={t('planAnother', 'next_14_days')}
              selected={choice1 === 3}
              onPress={() => setChoice1(3)}
            />
            <Chip
              label={t('planAnother', 'custom')}
              selected={choice1 === 4}
              onPress={() => setChoice1(4)}
            />
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
          onPress={onSeeIfPeopleAre}
        />
      </Foot>
    </Screen>
  );
}
