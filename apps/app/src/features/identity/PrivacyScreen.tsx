import { Body, BodyText, Card, DisplayL, Screen, Small, Title, TopBar } from '../../components';
import { Row } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Privacy — `docs/design/Privacy.dc.html`, reached from Account: what we keep
 * and who sees it, in the artboard's words. Static; it reads nothing. The
 * full policy is `/privacy` (S4-05).
 */
export type PrivacyProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
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
            <Title>{t('privacy', 'what_email_you_get')}</Title>
          </Row>
          <BodyText>{t('privacy', 'anyone_gets_updates_only_if_they_ask')}</BodyText>
        </Card>
        <Small>{t('privacy', 'to_have_your_details_removed')}</Small>
      </Body>
    </Screen>
  );
}
