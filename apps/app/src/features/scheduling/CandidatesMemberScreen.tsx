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
 * CandidatesMember — scaffolded from `docs/design/CandidatesMember.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CandidatesMemberProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function CandidatesMemberScreen({ fixture, onNext, onBack }: CandidatesMemberProps) {
  return (
    <Screen>
      <TopBar
        title={t('candidatesMember', 'catch_up_next_14_days')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Row>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('candidatesMember', '5_of_6_replied')}</Small>
          </Row>
          <Small>{t('candidatesMember', 'closes_tue_6_pm')}</Small>
        </Row>
        <Stack>
          <DisplayL>{t('candidatesMember', 'thursday_looks_good_for_five_of_you')}</DisplayL>
          <BodyText>{t('candidatesMember', 'maya_will_pick_one_of_these_once')}</BodyText>
        </Stack>
        <Card recommended>
          <Row>
            <Label>{t('candidatesMember', 'best_attendance')}</Label>
            <Small>{t('candidatesMember', '5_of_6')}</Small>
          </Row>
          <Stack>
            <DateText>{t('candidatesMember', 'thu_17_sep')}</DateText>
            {t('candidatesMember', '6_30_8_30_pm')}
          </Stack>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('candidatesMember', 'alex_hasnt_answered')}</Small>
          </Row>
        </Card>
        <Card>
          <Row>
            <Label>{t('candidatesMember', 'one_fewer_weekend')}</Label>
            <Small>{t('candidatesMember', '4_of_6')}</Small>
          </Row>
          <Stack>
            <DateText>{t('candidatesMember', 'sat_19_sep')}</DateText>
            {t('candidatesMember', '6_30_8_30_pm')}
          </Stack>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('candidatesMember', 'doesnt_work_for_priya')}</Small>
          </Row>
        </Card>
        <Card>
          <Row>
            <Label>{t('candidatesMember', 'also_four_a_day_later')}</Label>
            <Small>{t('candidatesMember', '4_of_6')}</Small>
          </Row>
          <Stack>
            <DateText>{t('candidatesMember', 'sun_20_sep')}</DateText>
            {t('candidatesMember', '4_6_pm')}
          </Stack>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('candidatesMember', 'doesnt_work_for_tom')}</Small>
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button
          label={t('candidatesMember', 'change_my_times')}
          variant="secondary"
          onPress={onNext}
        />
      </Foot>
    </Screen>
  );
}
