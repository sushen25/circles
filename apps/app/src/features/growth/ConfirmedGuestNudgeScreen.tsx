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
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * ConfirmedGuestNudge — scaffolded from `docs/design/ConfirmedGuestNudge.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type ConfirmedGuestNudgeProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function ConfirmedGuestNudgeScreen({ fixture, onNext, onBack }: ConfirmedGuestNudgeProps) {
  return (
    <Screen invert>
      <TopBar
        title={t('confirmedGuestNudge', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Label>{t('confirmedGuestNudge', 'locked_in')}</Label>
        <Stack>
          <DateText>{t('confirmedGuestNudge', 'thursday_17_september')}</DateText>
          {t('confirmedGuestNudge', '6_30_8_30_pm')}
        </Stack>
        <Stack>
          <Row>
            <Title>{t('confirmedGuestNudge', 'hope_st_radio')}</Title>
          </Row>
          <BodyText>{t('confirmedGuestNudge', 'brunswick_east_open_in_maps')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Stack>
              <Title>{t('confirmedGuestNudge', '5_going_1_to_confirm')}</Title>
              <Small>{t('confirmedGuestNudge', 'maya_priya_tom_jess_sam_alex_to')}</Small>
            </Stack>
            <Marks members={fixture.circle.members} />
          </Row>
        </Card>
        <Card>
          <Row>
            <Title>{t('confirmedGuestNudge', 'want_a_nudge_on_thursday')}</Title>
          </Row>
          <BodyText>{t('confirmedGuestNudge', 'the_app_sends_one_reminder_two_hours')}</BodyText>
          <Row>
            <Button
              label={t('confirmedGuestNudge', 'get_the_app')}
              variant="secondary"
              onPress={onNext}
            />
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button label={t('confirmedGuestNudge', 'add_to_calendar')} onPress={onNext} />
        <Tertiary label={t('confirmedGuestNudge', 'i_cant_make_it_after_all')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
