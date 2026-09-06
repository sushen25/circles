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
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('calendarPick', 'work')}</Title>
              <Small>{t('calendarPick', 'google_priya_work_example')}</Small>
            </Stack>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('calendarPick', 'birthdays')}</Title>
              <Small>{t('calendarPick', 'all_day_marked_free_ignored_anyway')}</Small>
            </Stack>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('calendarPick', 'footy_fixtures')}</Title>
              <Small>{t('calendarPick', 'subscribed')}</Small>
            </Stack>
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button label={t('calendarPick', 'use_these')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
