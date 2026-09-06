import {
  Body,
  BodyText,
  Card,
  DisplayL,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * EmailPrefs — scaffolded from `docs/design/EmailPrefs.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type EmailPrefsProps = {
  fixture: Fixture;
  state?: ScreenState;
  onNext?: () => void;
  onBack?: () => void;
};

export function EmailPrefsScreen({ onNext, onBack }: EmailPrefsProps) {
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{t('emailPrefs', 'email_preferences')}</DisplayL>
          <BodyText>{t('emailPrefs', 'for_priya_example_com_no_sign_in')}</BodyText>
        </Stack>
        <Card>
          <Row>
            <Stack>
              <Title>{t('emailPrefs', 'sunday_crew_catch_up_thu_17_sep')}</Title>
              <Small>{t('emailPrefs', 'confirmed_time_changes_and_one_reminder')}</Small>
            </Stack>
          </Row>
        </Card>
        <Small>{t('emailPrefs', 'turning_this_off_stops_emails_for_this')}</Small>
        <Tertiary label={t('emailPrefs', 'remove_this_email_address_entirely')} onPress={onNext} />
      </Body>
    </Screen>
  );
}
