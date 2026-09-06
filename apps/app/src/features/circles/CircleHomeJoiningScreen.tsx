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
 * CircleHomeJoining — scaffolded from `docs/design/CircleHomeJoining.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CircleHomeJoiningProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function CircleHomeJoiningScreen({ fixture, onNext, onBack }: CircleHomeJoiningProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Row>
          <Stack>
            <DisplayL>{t('circleHomeJoining', 'sunday_crew')}</DisplayL>
            <Small>{t('circleHomeJoining', '3_in_so_far_about_monthly')}</Small>
          </Stack>
        </Row>
        <Card>
          <Row>
            <Row>
              <Marks members={fixture.circle.members} />
              <Small>{t('circleHomeJoining', 'priya_and_tom_just_joined')}</Small>
            </Row>
            <Row>{t('circleHomeJoining', 'share_again')}</Row>
          </Row>
        </Card>
        <Card recommended>
          <Label>{t('circleHomeJoining', 'ready_when_you_are')}</Label>
          <BodyText>{t('circleHomeJoining', 'you_dont_have_to_wait_for_everyone')}</BodyText>
        </Card>
        <Card>
          <Row>
            <Stack>
              <Label>{t('circleHomeJoining', 'last_caught_up')}</Label>
              <DateText>{t('circleHomeJoining', 'not_yet')}</DateText>
            </Stack>
            <Stack>
              <Label>{t('circleHomeJoining', 'next_one')}</Label>
              <DateText>{t('circleHomeJoining', 'up_to_you')}</DateText>
            </Stack>
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button label={t('circleHomeJoining', 'plan_the_first_catch_up')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
