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
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * RescheduledGuest — scaffolded from `docs/design/RescheduledGuest.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type RescheduledGuestProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function RescheduledGuestScreen({ onNext, onBack }: RescheduledGuestProps) {
  return (
    <Screen>
      <TopBar
        title={t('rescheduledGuest', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <Label>{t('rescheduledGuest', 'change_of_plan')}</Label>
          <DisplayXL>{t('rescheduledGuest', 'thursday_is_off_the_table_new_times')}</DisplayXL>
          <BodyText>{t('rescheduledGuest', 'maya_reopened_the_plan_for_the_week')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Stack>
              <Small>{t('rescheduledGuest', 'previously')}</Small>
              {t('rescheduledGuest', 'thu_17_sep_6_30_8_30')}
            </Stack>
          </Row>
          <Row>
            <Stack>
              <Small>{t('rescheduledGuest', 'now_asking_about')}</Small>
              <Title>{t('rescheduledGuest', 'mon_21_sun_27_sep')}</Title>
            </Stack>
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button label={t('rescheduledGuest', 'choose_my_times')} onPress={onNext} />
        <Tertiary label={t('rescheduledGuest', 'not_this_time')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
