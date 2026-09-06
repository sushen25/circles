import { Body, Button, Card, Screen, Small, Title } from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * AddToCalendar — scaffolded from `docs/design/AddToCalendar.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type AddToCalendarProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function AddToCalendarScreen({ onNext }: AddToCalendarProps) {
  return (
    <Screen>
      <Body>
        <Stack>
          <Title>{t('addToCalendar', 'add_thursday_to_your_calendar')}</Title>
          <Small>{t('addToCalendar', 'thu_17_sep_6_30_8_30')}</Small>
        </Stack>
        <Card>
          <Stack>
            <Title>{t('addToCalendar', 'apple_or_device_calendar')}</Title>
            <Small>{t('addToCalendar', 'downloads_an_ics_file')}</Small>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('addToCalendar', 'google_calendar')}</Title>
            <Small>{t('addToCalendar', 'opens_google_calendar_with_the_details_filled')}</Small>
          </Stack>
        </Card>
        <Small>{t('addToCalendar', 'nothing_is_added_to_anyones_calendar_without')}</Small>
        <Button label={t('addToCalendar', 'cancel')} variant="secondary" onPress={onNext} />
      </Body>
    </Screen>
  );
}
