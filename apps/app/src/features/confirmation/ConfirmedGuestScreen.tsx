import {
  Body,
  BodyText,
  Button,
  Card,
  DateText,
  Foot,
  Label,
  Marks,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * ConfirmedGuest — scaffolded from `docs/design/ConfirmedGuest.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type ConfirmedGuestProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onICantMakeIt?: (() => void) | undefined;
};

export function ConfirmedGuestScreen({
  fixture,
  onNext,
  onBack,
  onICantMakeIt,
}: ConfirmedGuestProps) {
  return (
    <Screen invert>
      <TopBar
        title={t('confirmedGuest', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Label>{t('confirmedGuest', 'locked_in')}</Label>
        <Stack>
          <DateText>{t('confirmedGuest', 'thursday_17_september')}</DateText>
          {t('confirmedGuest', '6_30_8_30_pm')}
        </Stack>
        <Stack>
          <Row>
            <Title>{t('confirmedGuest', 'hope_st_radio')}</Title>
          </Row>
          <BodyText>{t('confirmedGuest', 'brunswick_east_open_in_maps')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Stack>
              <Title>{t('confirmedGuest', '5_going_1_to_confirm')}</Title>
              <Small>{t('confirmedGuest', 'maya_priya_tom_jess_sam_alex_to')}</Small>
            </Stack>
            <Marks members={fixture.circle.members} />
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('confirmedGuest', 'youre_going')}</Title>
              <Small>{t('confirmedGuest', 'tap_below_if_that_changes')}</Small>
            </Stack>
          </Row>
        </Card>
        <BodyText>{t('confirmedGuest', 'maya_says_tables_booked_under_my_name')}</BodyText>
      </Body>
      <Foot>
        <Button label={t('confirmedGuest', 'add_to_calendar')} onPress={onNext} />
        <Tertiary label={t('confirmedGuest', 'i_cant_make_it_after_all')} onPress={onICantMakeIt} />
      </Foot>
    </Screen>
  );
}
