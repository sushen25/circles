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
  Tertiary,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Candidates — scaffolded from `docs/design/Candidates.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type CandidatesProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function CandidatesScreen({ fixture, onNext, onBack }: CandidatesProps) {
  return (
    <Screen>
      <TopBar
        title={t('candidates', 'catch_up_next_14_days')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Row>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('candidates', '5_of_6_replied')}</Small>
          </Row>
          <Small>{t('candidates', 'closes_tue_6_pm')}</Small>
        </Row>
        <Stack>
          <DisplayL>{t('candidates', 'thursday_looks_good_for_five_of_you')}</DisplayL>
          <BodyText>{t('candidates', 'alex_hasnt_answered_yet_you_can_lock')}</BodyText>
        </Stack>
        <Card recommended>
          <Row>
            <Label>{t('candidates', 'best_attendance')}</Label>
            <Small>{t('candidates', '5_of_6')}</Small>
          </Row>
          <Stack>
            <DateText>{t('candidates', 'thu_17_sep')}</DateText>
            {t('candidates', '6_30_8_30_pm')}
          </Stack>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('candidates', 'alex_hasnt_answered')}</Small>
          </Row>
        </Card>
        <Card>
          <Row>
            <Label>{t('candidates', 'one_fewer_weekend')}</Label>
            <Small>{t('candidates', '4_of_6')}</Small>
          </Row>
          <Stack>
            <DateText>{t('candidates', 'sat_19_sep')}</DateText>
            {t('candidates', '6_30_8_30_pm')}
          </Stack>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('candidates', 'doesnt_work_for_priya')}</Small>
          </Row>
        </Card>
        <Card>
          <Row>
            <Label>{t('candidates', 'also_four_a_day_later')}</Label>
            <Small>{t('candidates', '4_of_6')}</Small>
          </Row>
          <Stack>
            <DateText>{t('candidates', 'sun_20_sep')}</DateText>
            {t('candidates', '4_6_pm')}
          </Stack>
          <Row>
            <Marks members={fixture.circle.members} />
            <Small>{t('candidates', 'doesnt_work_for_tom')}</Small>
          </Row>
        </Card>
      </Body>
      <Foot>
        <Button label={t('candidates', 'review_thursday')} onPress={onNext} />
        <Tertiary label={t('candidates', 'nudge_alex')} onPress={onNext} />
      </Foot>
    </Screen>
  );
}
