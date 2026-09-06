import {
  Body,
  BodyText,
  Card,
  DateText,
  DisplayL,
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
 * NoQuorum — scaffolded from `docs/design/NoQuorum.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type NoQuorumProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function NoQuorumScreen({ fixture, onBack }: NoQuorumProps) {
  return (
    <Screen>
      <TopBar
        title={t('noQuorum', 'drinks_next_7_days')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Row>
          <Marks members={fixture.circle.members} />
          <Small>{t('noQuorum', '6_of_6_replied')}</Small>
        </Row>
        <Stack>
          <DisplayL>{t('noQuorum', 'there_wasnt_enough_overlap_this_time')}</DisplayL>
          <BodyText>{t('noQuorum', 'nothing_in_the_next_7_days_works')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Label>{t('noQuorum', 'closest')}</Label>
            <Small>{t('noQuorum', '3_of_6')}</Small>
          </Row>
          <Stack>
            <DateText>{t('noQuorum', 'fri_11_sep')}</DateText>
            {t('noQuorum', '7_9_pm')}
          </Stack>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('noQuorum', 'not_alex_tom_or_sam')}</Small>
          </Row>
        </Card>
        <Card>
          <Row>
            <Label>{t('noQuorum', 'also_three_a_day_later')}</Label>
            <Small>{t('noQuorum', '3_of_6')}</Small>
          </Row>
          <Stack>
            <DateText>{t('noQuorum', 'sat_12_sep')}</DateText>
            {t('noQuorum', '6_30_8_30_pm')}
          </Stack>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('noQuorum', 'not_priya_alex_or_sam')}</Small>
          </Row>
        </Card>
        <Label>{t('noQuorum', 'what_would_unlock_it')}</Label>
        <Card>
          <Stack>
            <Title>{t('noQuorum', 'lower_to_3_people')}</Title>
            <Small>{t('noQuorum', 'saturday_becomes_possible')}</Small>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('noQuorum', 'try_a_wider_window')}</Title>
            <Small>{t('noQuorum', 'ask_about_the_next_two_weeks_instead')}</Small>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('noQuorum', 'close_this_attempt')}</Title>
            <Small>{t('noQuorum', 'the_circle_just_sees_it_didnt_line')}</Small>
          </Stack>
        </Card>
      </Body>
    </Screen>
  );
}
