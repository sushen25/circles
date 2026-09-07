import { useState } from 'react';

import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Screen,
  Small,
  Title,
  Toggle,
  TopBar,
} from '../../components';
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * CalendarPick — scaffolded from `docs/design/CalendarPick.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CalendarPickProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CalendarPickScreen({ onNext, onBack }: CalendarPickProps) {
  const [toggle0, setToggle0] = useState(true); // Toggle
  const [toggle1, setToggle1] = useState(true); // Toggle
  const [toggle2, setToggle2] = useState(false); // Toggle
  const [toggle3, setToggle3] = useState(false); // Toggle

  return (
    <Screen>
      <TopBar
        title={t('calendarPick', 'which_calendars')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('calendarPick', 'which_calendars_should_we_check')}</DisplayL>
          <BodyText>{t('calendarPick', 'only_these_will_grey_out_times_nothing')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Stack>
              <Title>{t('calendarPick', 'personal')}</Title>
              <Small>{t('calendarPick', 'icloud')}</Small>
            </Stack>
            <Toggle
              value={toggle0}
              onValueChange={setToggle0}
              label={t('calendarPick', 'icloud')}
            />
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('calendarPick', 'work')}</Title>
              <Small>{t('calendarPick', 'google_priya_work_example')}</Small>
            </Stack>
            <Toggle
              value={toggle1}
              onValueChange={setToggle1}
              label={t('calendarPick', 'google_priya_work_example')}
            />
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('calendarPick', 'birthdays')}</Title>
              <Small>{t('calendarPick', 'all_day_marked_free_ignored_anyway')}</Small>
            </Stack>
            <Toggle
              value={toggle2}
              onValueChange={setToggle2}
              label={t('calendarPick', 'all_day_marked_free_ignored_anyway')}
            />
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('calendarPick', 'footy_fixtures')}</Title>
              <Small>{t('calendarPick', 'subscribed')}</Small>
            </Stack>
            <Toggle
              value={toggle3}
              onValueChange={setToggle3}
              label={t('calendarPick', 'subscribed')}
            />
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button label={t('calendarPick', 'use_these')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
