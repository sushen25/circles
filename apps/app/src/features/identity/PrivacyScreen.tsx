import { Body, BodyText, Card, DisplayL, Screen, Small, Title, TopBar } from '../../components';
import { Row } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Privacy — scaffolded from `docs/design/Privacy.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type PrivacyProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function PrivacyScreen({ onBack }: PrivacyProps) {
  return (
    <Screen>
      <TopBar title={t('privacy', 'privacy')} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{t('privacy', 'what_we_keep_and_who_sees_it')}</DisplayL>
        <Card>
          <Row>
            <Title>{t('privacy', 'your_calendar_stays_on_your_phone')}</Title>
          </Row>
          <BodyText>{t('privacy', 'if_you_turn_on_the_calendar_check')}</BodyText>
        </Card>
        <Card>
          <Row>
            <Title>{t('privacy', 'friends_see_a_combined_result')}</Title>
          </Row>
          <BodyText>{t('privacy', 'they_see_which_options_work_for_you')}</BodyText>
        </Card>
        <Card>
          <Row>
            <Title>{t('privacy', 'email_is_optional_and_narrow')}</Title>
          </Row>
          <BodyText>{t('privacy', 'meetup_updates_only_per_meetup_with_a')}</BodyText>
        </Card>
        <Small>{t('privacy', 'you_can_leave_a_circle_delete_your')}</Small>
      </Body>
    </Screen>
  );
}
