import {
  Body,
  BodyText,
  Card,
  DisplayXL,
  Foot,
  Label,
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
 * ThresholdRole — scaffolded from `docs/design/ThresholdRole.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type ThresholdRoleProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function ThresholdRoleScreen({ onBack }: ThresholdRoleProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('thresholdRole', 'sunday_crew')}</Label>
          <DisplayXL>{t('thresholdRole', 'enough_people_are_keen')}</DisplayXL>
          <BodyText>{t('thresholdRole', 'three_of_you_want_to_catch_up')}</BodyText>
        </Stack>
        <Card recommended>
          <Row>
            <Title>{t('thresholdRole', 'ill_organise')}</Title>
          </Row>
          <BodyText>{t('thresholdRole', 'your_name_will_show_as_the_organiser')}</BodyText>
        </Card>
        <Card>
          <Row>
            <Title>{t('thresholdRole', 'ask_for_a_volunteer')}</Title>
          </Row>
          <BodyText>{t('thresholdRole', 'everyone_whos_keen_sees_a_one_tap')}</BodyText>
        </Card>
      </Body>
      <Foot>
        <Small>{t('thresholdRole', 'if_nobody_volunteers_before_replies_close_the')}</Small>
      </Foot>
    </Screen>
  );
}
