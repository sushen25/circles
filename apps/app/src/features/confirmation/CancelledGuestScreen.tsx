import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayXL,
  Foot,
  Label,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * CancelledGuest — scaffolded from `docs/design/CancelledGuest.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CancelledGuestProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function CancelledGuestScreen({ onNext, onBack }: CancelledGuestProps) {
  return (
    <Screen>
      <TopBar
        title={t('cancelledGuest', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <Label>{t('cancelledGuest', 'not_going_ahead')}</Label>
          <DisplayXL>{t('cancelledGuest', 'thursdays_catch_up_is_off')}</DisplayXL>
          <BodyText>{t('cancelledGuest', 'maya_cancelled_it_nothing_you_sent_has')}</BodyText>
        </Stack>
        <Card>
          <Stack>
            <Small>{t('cancelledGuest', 'mayas_note')}</Small>
            <BodyText>{t('cancelledGuest', 'work_thing_came_up_sorry_all_will')}</BodyText>
          </Stack>
        </Card>
      </Body>
      <Foot>
        <Button
          label={t('cancelledGuest', 'back_to_sunday_crew')}
          variant="secondary"
          onPress={onNext}
        />
      </Foot>
    </Screen>
  );
}
