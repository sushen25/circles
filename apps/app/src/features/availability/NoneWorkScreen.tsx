import {
  Body,
  BodyText,
  Card,
  DisplayL,
  Foot,
  Screen,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * NoneWork — scaffolded from `docs/design/NoneWork.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type NoneWorkProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onBackToMyTimes?: (() => void) | undefined;
};

export function NoneWorkScreen({ onBack, onBackToMyTimes }: NoneWorkProps) {
  return (
    <Screen>
      <TopBar
        title={t('noneWork', 'catch_up_next_14_days')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <DisplayL>{t('noneWork', 'none_of_these_dates_work_for_you')}</DisplayL>
          <BodyText>{t('noneWork', 'thats_useful_to_know_which_is_closer')}</BodyText>
        </Stack>
        <Card recommended>
          <Row>
            <Title>{t('noneWork', 'im_keen_just_not_these_dates')}</Title>
          </Row>
          <BodyText>{t('noneWork', 'maya_sees_youd_like_to_come_if')}</BodyText>
        </Card>
        <Card>
          <Row>
            <Title>{t('noneWork', 'not_enough_notice')}</Title>
          </Row>
          <BodyText>{t('noneWork', 'same_as_above_and_well_remember_to')}</BodyText>
        </Card>
        <Card>
          <Row>
            <Title>{t('noneWork', 'not_this_time')}</Title>
          </Row>
          <BodyText>{t('noneWork', 'no_reason_needed_nobody_is_told_anything')}</BodyText>
        </Card>
      </Body>
      <Foot>
        <Tertiary label={t('noneWork', 'back_to_my_times')} onPress={onBackToMyTimes} />
      </Foot>
    </Screen>
  );
}
