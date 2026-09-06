import {
  Body,
  Button,
  Card,
  DateText,
  DisplayL,
  Foot,
  Label,
  Marks,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * CircleHomeConfirmed — scaffolded from `docs/design/CircleHomeConfirmed.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CircleHomeConfirmedProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function CircleHomeConfirmedScreen({ fixture, onNext, onBack }: CircleHomeConfirmedProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Row>
          <Stack>
            <DisplayL>{t('circleHomeConfirmed', 'sunday_crew')}</DisplayL>
            <Small>{t('circleHomeConfirmed', '6_members_about_monthly')}</Small>
          </Stack>
        </Row>
        <Card recommended>
          <Row>
            <Label>{t('circleHomeConfirmed', 'locked_in')}</Label>
            <Small>{t('circleHomeConfirmed', '5_going_1_to_confirm')}</Small>
          </Row>
          <Stack>
            <DateText>{t('circleHomeConfirmed', 'thu_17_sep')}</DateText>
            {t('circleHomeConfirmed', '6_30_8_30_pm_hope_st')}
          </Stack>
          <Row>
            <Button
              label={t('circleHomeConfirmed', 'details')}
              variant="secondary"
              onPress={onNext}
            />
            <Button
              label={t('circleHomeConfirmed', 'share')}
              variant="secondary"
              onPress={onNext}
            />
          </Row>
        </Card>
        <Card>
          <Row>
            <Stack>
              <Label>{t('circleHomeConfirmed', 'last_caught_up')}</Label>
              <DateText>{t('circleHomeConfirmed', 'sat_8_aug')}</DateText>
            </Stack>
            <Stack>
              <Label>{t('circleHomeConfirmed', 'next_one')}</Label>
              <DateText>{t('circleHomeConfirmed', 'thu_17_sep')}</DateText>
            </Stack>
          </Row>
        </Card>
        <Row>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('circleHomeConfirmed', '6_members')}</Small>
          </Row>
          <Row>{t('circleHomeConfirmed', 'invite_link')}</Row>
        </Row>
      </Body>
      <Foot>
        <Button
          label={t('circleHomeConfirmed', 'plan_another')}
          variant="secondary"
          onPress={onNext}
        />
      </Foot>
    </Screen>
  );
}
