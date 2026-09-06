import { Body, Card, DisplayL, Screen, Small, Tertiary, Title, TopBar } from '../../components';
import { Divider, Row, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Account — scaffolded from `docs/design/Account.dc.html`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces `fixture` with real data and `onNext` with real navigation. Edit
 * freely: `scripts/scaffold-screens.mjs` will not overwrite this file.
 */
export type AccountProps = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onDeleteMyAccountAnd?: (() => void) | undefined;
  onSignOut?: (() => void) | undefined;
};

export function AccountScreen({ onBack, onDeleteMyAccountAnd, onSignOut }: AccountProps) {
  return (
    <Screen>
      <TopBar title={t('account', 'account')} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayL>{t('account', 'you')}</DisplayL>
        <Card>
          <Row>
            <Stack>
              <Title>{t('account', 'name')}</Title>
              <Small>{t('account', 'maya')}</Small>
            </Stack>
            <Small>{t('account', 'change')}</Small>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('account', 'time_zone')}</Title>
              <Small>{t('account', 'melbourne_aest')}</Small>
            </Stack>
            <Small>{t('account', 'change')}</Small>
          </Row>
          <Divider />
          <Row>
            <Stack>
              <Title>{t('account', 'email')}</Title>
              <Small>{t('account', 'maya_example_com')}</Small>
            </Stack>
          </Row>
        </Card>
        <Card>
          <Stack>
            <Title>{t('account', 'privacy')}</Title>
            <Small>{t('account', 'what_we_keep_what_friends_see')}</Small>
          </Stack>
          <Divider />
          <Stack>
            <Title>{t('account', 'email_preferences')}</Title>
            <Small>{t('account', 'meetup_updates')}</Small>
          </Stack>
        </Card>
        <Tertiary label={t('account', 'sign_out')} onPress={onSignOut} />
        <Tertiary
          label={t('account', 'delete_my_account_and_data')}
          onPress={onDeleteMyAccountAnd}
        />
      </Body>
    </Screen>
  );
}
