import { Body, BodyText, Button, DisplayL, Foot, Screen, Small, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * CalendarDenied — scaffolded from `docs/design/CalendarDenied.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CalendarDeniedProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CalendarDeniedScreen({ onNext, onBack }: CalendarDeniedProps) {
  return (
    <Screen>
      <TopBar
        title={t('calendarDenied', 'times_id_actually_be_up_for')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('calendarDenied', 'no_calendar_access_and_thats_fine')}</DisplayL>
          <BodyText>{t('calendarDenied', 'everything_works_without_it_paint_the_times')}</BodyText>
        </Stack>
        <Small>{t('calendarDenied', 'if_you_change_your_mind_you_can')}</Small>
      </Body>
      <Foot>
        <Button label={t('calendarDenied', 'choose_my_times')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
