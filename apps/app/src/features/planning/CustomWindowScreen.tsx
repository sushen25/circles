import { useState } from 'react';

import {
  Body,
  Button,
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
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * CustomWindow — scaffolded from `docs/design/CustomWindow.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CustomWindowProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CustomWindowScreen({ onNext, onBack }: CustomWindowProps) {
  const [choice0, setChoice0] = useState(0); // Chip group

  return (
    <Screen>
      <TopBar title={t('customWindow', 'when')} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{t('customWindow', 'pick_the_dates_to_ask_about')}</DisplayL>
        <Stack>
          <Label>{t('customWindow', 'september')}</Label>
        </Stack>
        <Row>
          <Stack>
            <Title>{t('customWindow', 'mon_14_sun_27_sep')}</Title>
            <Small>{t('customWindow', '14_days_the_most_you_can_ask')}</Small>
          </Stack>
        </Row>
        <Stack>
          <Label>{t('customWindow', 'times_of_day')}</Label>
          <Chips>
            <Chip
              label={t('customWindow', 'evenings_5_30_10_30')}
              selected={choice0 === 0}
              onPress={() => setChoice0(0)}
            />
            <Chip
              label={t('customWindow', 'weekend_days_9_10_30')}
              selected={choice0 === 1}
              onPress={() => setChoice0(1)}
            />
            <Chip
              label={t('customWindow', 'custom')}
              selected={choice0 === 2}
              onPress={() => setChoice0(2)}
            />
          </Chips>
        </Stack>
      </Body>
      <Foot>
        <Button label={t('customWindow', 'use_these_dates')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
