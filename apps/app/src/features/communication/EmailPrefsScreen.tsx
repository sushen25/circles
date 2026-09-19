import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  Toggle,
  TopBar,
} from '../../components';
import { Row, Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * EmailPrefs — `docs/design/EmailPrefs.dc.html` (spec §5.8, ADR 0019).
 *
 * No sign-in: the token in the link is the authority. A meetup can be turned
 * off here and not back on — `manage-email-preferences` has no "resume", and
 * asking again from the plan is how updates come back. Removing the address is
 * a tertiary with one confirmation, because it is final and ends this page.
 */
export type PrefsSubscription = {
  planId: string;
  circleName: string;
  planTitle: string;
  active: boolean;
};

export type EmailPrefsState =
  'default' | 'loading' | 'removed' | 'expired' | 'no_token' | 'error' | 'offline';

export type EmailPrefsProps = {
  state?: EmailPrefsState | undefined;
  subscriptions?: readonly PrefsSubscription[] | undefined;
  /** The plan being stopped, while it is. */
  stopping?: string | undefined;
  confirmingRemove?: boolean | undefined;
  removing?: boolean | undefined;
  problem?: 'couldnt_change' | 'offline' | undefined;
  reference?: string | undefined;
  onStop?: ((planId: string) => void) | undefined;
  onRemove?: (() => void) | undefined;
  onConfirmRemove?: (() => void) | undefined;
  onKeep?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
};

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Screen>
      <TopBar />
      <Body>
        <Stack>
          <DisplayL>{title}</DisplayL>
          <BodyText>{body}</BodyText>
        </Stack>
      </Body>
    </Screen>
  );
}

export function EmailPrefsScreen({
  state = 'default',
  subscriptions = [],
  stopping,
  confirmingRemove = false,
  removing = false,
  problem,
  reference,
  onStop,
  onRemove,
  onConfirmRemove,
  onKeep,
  onRetry,
}: EmailPrefsProps) {
  switch (state) {
    case 'loading':
      return (
        <Screen>
          <TopBar />
          <Body>
            <Small accessibilityLiveRegion="polite">{t('emailPrefs', 'loading')}</Small>
          </Body>
        </Screen>
      );
    case 'removed':
      return <Message title={t('emailPrefs', 'removed')} body={t('emailPrefs', 'removed_body')} />;
    case 'expired':
      return (
        <Message
          title={t('emailPrefs', 'link_expired')}
          body={t('emailPrefs', 'link_expired_body')}
        />
      );
    case 'no_token':
      return (
        <Message
          title={t('emailPrefs', 'open_it_again')}
          body={t('emailPrefs', 'open_it_again_body')}
        />
      );
    case 'error':
    case 'offline':
      return (
        <Screen>
          <TopBar />
          <Body>
            <DisplayL>
              {state === 'offline'
                ? t('emailPrefs', 'youre_offline')
                : t('emailPrefs', 'couldnt_load')}
            </DisplayL>
            {reference === undefined ? null : (
              <Small>{t('emailPrefs', 'reference', { reference })}</Small>
            )}
          </Body>
          <Foot>
            <Button label={t('emailPrefs', 'try_again')} onPress={onRetry} />
          </Foot>
        </Screen>
      );
    default:
      break;
  }

  return (
    <Screen>
      <TopBar />
      <Body>
        <Stack>
          <DisplayL>{t('emailPrefs', 'email_preferences')}</DisplayL>
          <BodyText>{t('emailPrefs', 'no_sign_in_needed')}</BodyText>
        </Stack>
        {subscriptions.length === 0 ? (
          <Notice>{t('emailPrefs', 'nothing_being_sent')}</Notice>
        ) : (
          subscriptions.map((subscription) => {
            const label = t('emailPrefs', 'plan', {
              circle: subscription.circleName,
              title: subscription.planTitle,
            });
            return (
              <Card key={subscription.planId}>
                <Row>
                  <Stack>
                    <Title>{label}</Title>
                    <Small>
                      {subscription.active
                        ? t('emailPrefs', 'confirmed_time_changes_and_one_reminder')
                        : t('emailPrefs', 'stopped')}
                    </Small>
                  </Stack>
                  <Toggle
                    value={subscription.active}
                    onValueChange={() => onStop?.(subscription.planId)}
                    label={label}
                    disabled={!subscription.active || stopping !== undefined}
                  />
                </Row>
              </Card>
            );
          })
        )}
        {subscriptions.length === 0 ? null : (
          <Small>{t('emailPrefs', 'turning_this_off_stops_emails_for_this')}</Small>
        )}
        {problem === undefined ? null : (
          <Notice kind="warn">
            {problem === 'offline'
              ? t('emailPrefs', 'youre_offline')
              : t('emailPrefs', 'couldnt_change')}
          </Notice>
        )}
        {reference === undefined ? null : (
          <Small>{t('emailPrefs', 'reference', { reference })}</Small>
        )}
        {confirmingRemove ? (
          <Card>
            <BodyText>{t('emailPrefs', 'remove_confirm')}</BodyText>
            <Button
              label={t('emailPrefs', 'remove_it')}
              variant="secondary"
              onPress={onConfirmRemove}
              disabled={removing}
            />
            <Tertiary label={t('emailPrefs', 'keep_it')} onPress={onKeep} />
          </Card>
        ) : (
          <Tertiary
            label={t('emailPrefs', 'remove_this_email_address_entirely')}
            onPress={onRemove}
          />
        )}
      </Body>
    </Screen>
  );
}
