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
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * CircleHome — scaffolded from `docs/design/CircleHome.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CircleHomeProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSeeHowItsLooking?: (() => void) | undefined;
};

export function CircleHomeScreen({ fixture, onNext, onBack, onSeeHowItsLooking }: CircleHomeProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Row>
          <Stack>
            <DisplayL>{t('circleHome', 'sunday_crew')}</DisplayL>
            <Small>{t('circleHome', '6_members_about_monthly')}</Small>
          </Stack>
        </Row>
        <Card recommended>
          <Row>
            <Label>{t('circleHome', 'finding_a_time')}</Label>
            <Small>{t('circleHome', 'replies_close_tue_6_pm')}</Small>
          </Row>
          <Title>{t('circleHome', 'catch_up_in_the_next_14_days')}</Title>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('circleHome', '5_of_6_replied')}</Small>
          </Row>
          <Button
            label={t('circleHome', 'see_how_its_looking')}
            variant="secondary"
            onPress={onSeeHowItsLooking}
          />
        </Card>
        <Card>
          <Row>
            <Stack>
              <Label>{t('circleHome', 'last_caught_up')}</Label>
              <DateText>{t('circleHome', 'sat_8_aug')}</DateText>
            </Stack>
            <Stack>
              <Label>{t('circleHome', 'next_one')}</Label>
              <DateText>{t('circleHome', 'no_rush')}</DateText>
            </Stack>
          </Row>
          <Small>{t('circleHome', 'you_aim_for_about_monthly_early_october')}</Small>
        </Card>
        <Row>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('circleHome', '6_members')}</Small>
          </Row>
          <Row>{t('circleHome', 'invite_link')}</Row>
        </Row>
      </Body>
      <Foot>
        <Button label={t('circleHome', 'plan_a_catch_up')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
