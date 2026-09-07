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
  Title,
  TopBar,
} from '../../components';
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * DeadlinePassed — scaffolded from `docs/design/DeadlinePassed.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type DeadlinePassedProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function DeadlinePassedScreen({ fixture, onNext, onBack }: DeadlinePassedProps) {
  return (
    <Screen>
      <TopBar
        title={t('deadlinePassed', 'catch_up_next_14_days')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Row>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('deadlinePassed', '5_of_6_replied')}</Small>
          </Row>
          <Small>{t('deadlinePassed', 'replies_closed')}</Small>
        </Row>
        <Stack>
          <DisplayL>{t('deadlinePassed', 'replies_have_closed_thursday_still_works_for')}</DisplayL>
          <BodyText>{t('deadlinePassed', 'nothing_changes_until_you_lock_something_in')}</BodyText>
        </Stack>
        <Card recommended>
          <Row>
            <Label>{t('deadlinePassed', 'best_attendance')}</Label>
            <Small>{t('deadlinePassed', '5_of_6')}</Small>
          </Row>
          <Stack>
            <DateText>{t('deadlinePassed', 'thu_17_sep')}</DateText>
            <BodyText>{t('deadlinePassed', '6_30_8_30_pm')}</BodyText>
          </Stack>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('deadlinePassed', 'alex_didnt_answer')}</Small>
          </Row>
        </Card>
        <Card>
          <Stack>
            <Title>{t('deadlinePassed', 'hand_this_to_someone_else')}</Title>
            <Small>{t('deadlinePassed', 'another_member_picks_the_time')}</Small>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('deadlinePassed', 'give_it_one_more_day')}</Title>
            <Small>{t('deadlinePassed', 'reopens_replies_until_wed_6_pm')}</Small>
          </Stack>
        </Card>
      </Body>
      <Foot>
        <Button label={t('deadlinePassed', 'lock_in_thursday')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
