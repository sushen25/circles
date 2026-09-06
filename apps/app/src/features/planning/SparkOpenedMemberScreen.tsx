import {
  Body,
  BodyText,
  Button,
  DisplayXL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * SparkOpenedMember — scaffolded from `docs/design/SparkOpenedMember.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type SparkOpenedMemberProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function SparkOpenedMemberScreen({ onNext, onBack }: SparkOpenedMemberProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{t('sparkOpenedMember', 'sunday_crew_started_quietly')}</Label>
          <DisplayXL>{t('sparkOpenedMember', 'enough_people_are_keen_for_this_weekend')}</DisplayXL>
          <BodyText>{t('sparkOpenedMember', 'tom_volunteered_to_pick_the_time_mark')}</BodyText>
        </Stack>
        <Row>
          <Small>{t('sparkOpenedMember', '3_of_6_keen_so_far_replies')}</Small>
        </Row>
        <Notice>{t('sparkOpenedMember', 'this_plan_started_quietly_we_dont_say')}</Notice>
      </Body>
      <Foot>
        <Button label={t('sparkOpenedMember', 'choose_my_times')} onPress={onNext} />
        <Tertiary label={t('sparkOpenedMember', 'not_this_one')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
