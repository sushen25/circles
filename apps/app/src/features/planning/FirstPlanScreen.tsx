import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
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
 * FirstPlan — scaffolded from `docs/design/FirstPlan.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type FirstPlanProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onSeeIfPeopleAre?: (() => void) | undefined;
};

export function FirstPlanScreen({ onNext, onBack, onSeeIfPeopleAre }: FirstPlanProps) {
  return (
    <Screen>
      <TopBar
        title={t('firstPlan', 'sunday_crew')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('firstPlan', 'your_first_catch_up')}</DisplayL>
          <BodyText>{t('firstPlan', 'weve_picked_sensible_defaults_tap_anything_to')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Stack>
              <Title>{t('firstPlan', 'catch_up_next_14_days')}</Title>
              <Small>{t('firstPlan', 'evenings_and_weekend_days')}</Small>
            </Stack>
            <Small>{t('firstPlan', 'change')}</Small>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('firstPlan', 'about_2_hours')}</Title>
            </Stack>
            <Small>{t('firstPlan', 'change')}</Small>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('firstPlan', 'at_least_2_of_3_need_to')}</Title>
              <Small>{t('firstPlan', 'adjusts_as_more_people_join')}</Small>
            </Stack>
            <Small>{t('firstPlan', 'change')}</Small>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('firstPlan', 'replies_close_in_3_days')}</Title>
              <Small>{t('firstPlan', 'tue_15_sep_6_pm')}</Small>
            </Stack>
            <Small>{t('firstPlan', 'change')}</Small>
          </Row>
        </Card>
        <Small>{t('firstPlan', 'friends_mark_the_times_theyd_actually_be')}</Small>
      </Body>
      <Foot>
        <Button label={t('firstPlan', 'ask_the_group')} onPress={onNext} />
        <Tertiary
          label={t('firstPlan', 'see_if_people_are_keen_instead')}
          onPress={onSeeIfPeopleAre}
        />
      </Foot>
    </Screen>
  );
}
