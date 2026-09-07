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
  Tertiary,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * ChangeTime — scaffolded from `docs/design/ChangeTime.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type ChangeTimeProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onKeepThursday?: (() => void) | undefined;
};

export function ChangeTimeScreen({ onNext, onBack, onKeepThursday }: ChangeTimeProps) {
  const [choice0, setChoice0] = useState(1); // Chip group

  return (
    <Screen>
      <TopBar title={t('changeTime', 'back')} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('changeTime', 'ask_for_new_times')}</DisplayL>
          <BodyText>{t('changeTime', 'thursday_will_be_marked_as_no_longer')}</BodyText>
        </Stack>
        <Stack>
          <Label>{t('changeTime', 'new_window')}</Label>
          <Chips>
            <Chip
              label={t('changeTime', 'next_7_days')}
              selected={choice0 === 0}
              onPress={() => setChoice0(0)}
            />
            <Chip
              label={t('changeTime', 'next_14_days')}
              selected={choice0 === 1}
              onPress={() => setChoice0(1)}
            />
            <Chip
              label={t('changeTime', 'custom')}
              selected={choice0 === 2}
              onPress={() => setChoice0(2)}
            />
          </Chips>
        </Stack>
        <Notice kind="warn">{t('changeTime', 'everyone_will_see_thursday_is_off_and')}</Notice>
      </Body>
      <Foot>
        <Button label={t('changeTime', 'ask_again')} onPress={onNext} />
        <Tertiary label={t('changeTime', 'keep_thursday')} onPress={onKeepThursday} />
      </Foot>
    </Screen>
  );
}
