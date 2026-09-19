import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  DisplayXL,
  Foot,
  Label,
  Notice,
  Screen,
  Small,
  Tertiary,
  Title,
  TopBar,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * EmailVerified — `docs/design/EmailVerified.dc.html` (spec §5.8).
 *
 * Opened from an email, usually in a browser with no session, so everything
 * here comes from `verify-email-contact`'s answer: the plans this address will
 * hear about, by name. The address itself is never returned, so the artboard's
 * "On · priya@example.com" reads "On".
 */
export type VerifiedPlan = { key: string; circleName: string; planTitle: string };

export type EmailVerifiedState =
  'default' | 'loading' | 'expired' | 'no_token' | 'error' | 'offline';

export type EmailVerifiedProps = {
  state?: EmailVerifiedState | undefined;
  plans?: readonly VerifiedPlan[] | undefined;
  alreadyConfirmed?: boolean | undefined;
  reference?: string | undefined;
  /** Back from saving access: the address they can sign in with. */
  savedWith?: string | undefined;
  /** Offered only when this browser holds the guest who answered. */
  offerSaveAccess?: boolean | undefined;
  onBackToCircle?: (() => void) | undefined;
  onSaveAccess?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
};

export function EmailVerifiedScreen({
  state = 'default',
  plans = [],
  alreadyConfirmed = false,
  reference,
  savedWith,
  offerSaveAccess = false,
  onBackToCircle,
  onSaveAccess,
  onRetry,
}: EmailVerifiedProps) {
  if (state === 'loading') {
    return (
      <Screen>
        <TopBar />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('emailVerified', 'checking')}</Small>
        </Body>
      </Screen>
    );
  }

  if (state === 'expired' || state === 'no_token') {
    return (
      <Screen>
        <TopBar />
        <Body>
          <Stack>
            <DisplayL>
              {state === 'expired'
                ? t('emailVerified', 'link_expired')
                : t('emailVerified', 'open_it_again')}
            </DisplayL>
            <BodyText>
              {state === 'expired'
                ? t('emailVerified', 'link_expired_body')
                : t('emailVerified', 'open_it_again_body')}
            </BodyText>
          </Stack>
        </Body>
      </Screen>
    );
  }

  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar />
        <Body>
          <DisplayL>
            {state === 'offline'
              ? t('emailVerified', 'youre_offline')
              : t('emailVerified', 'couldnt_check')}
          </DisplayL>
          {reference === undefined ? null : (
            <Small>{t('emailVerified', 'reference', { reference })}</Small>
          )}
        </Body>
        <Foot>
          <Button label={t('emailVerified', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  const first = plans[0];

  if (first === undefined) {
    return (
      <Screen>
        <TopBar />
        <Body>
          <Stack>
            <DisplayXL>{t('emailVerified', 'verified_nothing_to_send')}</DisplayXL>
            <BodyText>{t('emailVerified', 'nothing_to_send_body')}</BodyText>
          </Stack>
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar />
      <Body>
        <Stack>
          <Label>{first.circleName}</Label>
          <DisplayXL>
            {plans.length === 1
              ? t('emailVerified', 'youll_hear_about_this_meetup_by_email')
              : t('emailVerified', 'youll_hear_about_these_meetups_by_email')}
          </DisplayXL>
          <BodyText>
            {alreadyConfirmed
              ? t('emailVerified', 'already_confirmed')
              : t('emailVerified', 'only_this_one_well_send_the_confirmed')}
          </BodyText>
        </Stack>
        {plans.map((plan) => (
          <Card key={plan.key}>
            <Stack>
              <Title>
                {t('emailVerified', 'plan_on', {
                  circle: plan.circleName,
                  title: plan.planTitle,
                })}
              </Title>
              <Small>{t('emailVerified', 'on')}</Small>
            </Stack>
          </Card>
        ))}
        {savedWith === undefined ? null : (
          <Notice kind="ok">{t('emailVerified', 'place_saved', { address: savedWith })}</Notice>
        )}
        <Small>{t('emailVerified', 'every_email_has_a_link_to_stop')}</Small>
      </Body>
      <Foot>
        <Button
          label={t('emailVerified', 'back_to_circle', { circle: first.circleName })}
          onPress={onBackToCircle}
        />
        {offerSaveAccess ? (
          <Tertiary
            label={t('emailVerified', 'save_access_on_every_device')}
            onPress={onSaveAccess}
          />
        ) : null}
      </Foot>
    </Screen>
  );
}
