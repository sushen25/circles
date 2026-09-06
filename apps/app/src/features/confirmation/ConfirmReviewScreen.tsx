import {
  Body,
  Button,
  DateText,
  Foot,
  Input,
  Label,
  Marks,
  Notice,
  Screen,
  Small,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * ConfirmReview — scaffolded from `docs/design/ConfirmReview.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type ConfirmReviewProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function ConfirmReviewScreen({ fixture, onNext, onBack }: ConfirmReviewProps) {
  return (
    <Screen>
      <TopBar
        title={t('confirmReview', 'back_to_options')}
        onBack={onBack}
        backLabel={t('common', 'back')}
      />
      <Body>
        <Stack>
          <Label>{t('confirmReview', 'lock_it_in')}</Label>
          <DateText>{t('confirmReview', 'thursday_17_september')}</DateText>
          {t('confirmReview', '6_30_8_30_pm')}
        </Stack>
        <Row>
          <Marks members={fixture.circle.members} />
          <Small>{t('confirmReview', '5_of_6_can_make_it_alex')}</Small>
        </Row>
        <Stack>
          <Label>{t('confirmReview', 'where')}</Label>
          <Input placeholder={t('confirmReview', 'hope_st_radio')} />
          <Input placeholder={t('confirmReview', 'address_or_map_link_optional')} />
        </Stack>
        <Stack>
          <Label>{t('confirmReview', 'a_note_for_everyone')}</Label>
          <Input placeholder={t('confirmReview', 'tables_booked_under_my_name_come_hungry')} />
        </Stack>
        <Notice kind="warn">{t('confirmReview', 'alex_hasnt_replied_theyll_see_the_plan')}</Notice>
      </Body>
      <Foot>
        <Button label={t('confirmReview', 'lock_it_in')} onPress={onNext} />
        <Small>{t('confirmReview', 'times_are_frozen_once_locked_later_replies')}</Small>
      </Foot>
    </Screen>
  );
}
