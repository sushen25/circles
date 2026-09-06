import {
  Body,
  BodyText,
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
 * CircleHomeDue — scaffolded from `docs/design/CircleHomeDue.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CircleHomeDueProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function CircleHomeDueScreen({ fixture, onNext, onBack }: CircleHomeDueProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Row>
          <Stack>
            <DisplayL>{t('circleHomeDue', 'sunday_crew')}</DisplayL>
            <Small>{t('circleHomeDue', '6_members_about_monthly')}</Small>
          </Stack>
        </Row>
        <Card>
          <Label>{t('circleHomeDue', 'about_time_for_the_next_one')}</Label>
          <BodyText>{t('circleHomeDue', 'its_been_about_a_month_since_sunday')}</BodyText>
          <Row>
            <Button
              label={t('circleHomeDue', 'snooze_a_month')}
              variant="secondary"
              onPress={onNext}
            />
            <Button
              label={t('circleHomeDue', 'turn_off_nudges')}
              variant="secondary"
              onPress={onNext}
            />
          </Row>
        </Card>
        <Card>
          <Row>
            <Stack>
              <Label>{t('circleHomeDue', 'last_caught_up')}</Label>
              <DateText>{t('circleHomeDue', 'thu_17_sep')}</DateText>
            </Stack>
            <Stack>
              <Label>{t('circleHomeDue', 'next_one')}</Label>
              <DateText>{t('circleHomeDue', 'nothing_yet')}</DateText>
            </Stack>
          </Row>
        </Card>
        <Row>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('circleHomeDue', '6_members')}</Small>
          </Row>
          <Row>{t('circleHomeDue', 'invite_link')}</Row>
        </Row>
      </Body>
      <Foot>
        <Button label={t('circleHomeDue', 'plan_another')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
