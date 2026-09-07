import { useState } from 'react';

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
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function SparkSetupScreen({ onNext, onBack }: SparkSetupProps) {
  const [choice0, setChoice0] = useState(1); // Chip group
  const [choice1, setChoice1] = useState(0); // Chip group
  const [choice2, setChoice2] = useState(1); // Chip group

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
            <Chip
              label={t('sparkSetup', 'tonight')}
              selected={choice0 === 0}
              onPress={() => setChoice0(0)}
            />
            <Chip
              label={t('sparkSetup', 'this_weekend')}
              selected={choice0 === 1}
              onPress={() => setChoice0(1)}
            />
            <Chip
              label={t('sparkSetup', 'next_7_days')}
              selected={choice0 === 2}
              onPress={() => setChoice0(2)}
            />
            <Chip
              label={t('sparkSetup', 'next_14_days')}
              selected={choice0 === 3}
              onPress={() => setChoice0(3)}
            />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('sparkSetup', 'to_do_what')}</Label>
          <Chips>
            <Chip
              label={t('sparkSetup', 'anything')}
              selected={choice1 === 0}
              onPress={() => setChoice1(0)}
            />
            <Chip
              label={t('sparkSetup', 'dinner')}
              selected={choice1 === 1}
              onPress={() => setChoice1(1)}
            />
            <Chip
              label={t('sparkSetup', 'drinks')}
              selected={choice1 === 2}
              onPress={() => setChoice1(2)}
            />
            <Chip
              label={t('sparkSetup', 'coffee')}
              selected={choice1 === 3}
              onPress={() => setChoice1(3)}
            />
            <Chip
              label={t('sparkSetup', 'activity')}
              selected={choice1 === 4}
              onPress={() => setChoice1(4)}
            />
          </Chips>
        </Stack>
        <Stack>
          <Label>{t('sparkSetup', 'stop_asking')}</Label>
          <Chips>
            <Chip
              label={t('sparkSetup', 'tonight_9_pm')}
              selected={choice2 === 0}
              onPress={() => setChoice2(0)}
            />
            <Chip
              label={t('sparkSetup', 'friday_midday')}
              selected={choice2 === 1}
              onPress={() => setChoice2(1)}
            />
            <Chip
              label={t('sparkSetup', 'when_the_weekend_starts')}
              selected={choice2 === 2}
              onPress={() => setChoice2(2)}
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
