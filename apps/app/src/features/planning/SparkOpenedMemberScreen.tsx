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
 * SparkOpenedMember — `docs/design/SparkOpenedMember.dc.html` (spec §5.4.6):
 * a member who may not take the role — they were not keen, or did not answer,
 * or somebody already has it — once the ask has opened. They may still send
 * their times, whatever they said before.
 *
 * The organiser's name, once there is one, is public (§4.5). Nothing here
 * says who asked, or who was keen.
 */
export type SparkOpenedMemberProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  /** "Sunday Crew · started quietly". */
  label?: string | undefined;
  /** "Enough people are keen to catch up this weekend." */
  headline?: string | undefined;
  /** "Tom volunteered to pick the time. …", or "Someone needs to pick the time. …". */
  body?: string | undefined;
  /** "3 of 6 were keen · Replies close Fri 11 Sep, 6 pm". */
  keenLine?: string | undefined;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onNotThisOne?: (() => void) | undefined;
};

export function SparkOpenedMemberScreen({
  label = t('sparkOpenedMember', 'sunday_crew_started_quietly'),
  headline = t('sparkOpenedMember', 'enough_people_are_keen_for_this_weekend'),
  body = t('sparkOpenedMember', 'tom_volunteered_to_pick_the_time_mark'),
  keenLine = t('sparkOpenedMember', '3_of_6_keen_so_far_replies'),
  onNext,
  onBack,
  onNotThisOne,
}: SparkOpenedMemberProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <Label>{label}</Label>
          <DisplayXL>{headline}</DisplayXL>
          <BodyText>{body}</BodyText>
        </Stack>
        <Row>
          <Small>{keenLine}</Small>
        </Row>
        <Notice>{t('sparkOpenedMember', 'this_plan_started_quietly_we_dont_say')}</Notice>
      </Body>
      <Foot>
        <Button label={t('sparkOpenedMember', 'choose_my_times')} onPress={onNext} />
        <Tertiary label={t('sparkOpenedMember', 'not_this_one')} onPress={onNotThisOne} />
      </Foot>
    </Screen>
  );
}
