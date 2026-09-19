import { brand } from '@circles/config';

import {
  Body,
  BodyText,
  Button,
  DisplayL,
  DisplayXL,
  InlineLink,
  Screen,
  Small,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { Fixture } from '../../data/fixtures';
import type { ScreenState } from '../state';

/**
 * Welcome — `docs/design/Welcome.dc.html` (spec §5.1 step 1).
 *
 * **A provider's button appears only when it has somewhere to go.** Apple and
 * Google are S1-14b (SUS-77) and not built; a button that does nothing on the
 * first screen of the product reads as broken, so they are left out until a
 * handler is passed, and email is the one way in. The artboard's three buttons
 * come back the day SUS-77 passes the other two.
 *
 * `loading` is a returning account being sent on to its circles, which takes a
 * read; `error` is that read failing.
 */
export type WelcomeProps = {
  fixture?: Fixture | undefined;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
  onContinueWithApple?: (() => void) | undefined;
  onContinueWithEmail?: (() => void) | undefined;
  onContinueWithGoogle?: (() => void) | undefined;
  onTerms?: (() => void) | undefined;
  onPrivacy?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
};

export function WelcomeScreen({
  state = 'default',
  onContinueWithApple,
  onContinueWithEmail,
  onContinueWithGoogle,
  onTerms,
  onPrivacy,
  onRetry,
}: WelcomeProps) {
  if (state === 'loading') {
    return (
      <Screen>
        <Body>
          <DisplayL>{brand.name}</DisplayL>
          <Small accessibilityLiveRegion="polite">{t('welcome', 'opening_your_circles')}</Small>
        </Body>
      </Screen>
    );
  }

  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <Body>
          <DisplayL>{brand.name}</DisplayL>
          <BodyText>
            {state === 'offline' ? t('welcome', 'youre_offline') : t('welcome', 'couldnt_load')}
          </BodyText>
          <Button label={t('welcome', 'try_again')} onPress={onRetry} />
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Body>
        <DisplayL>{brand.name}</DisplayL>
        <Stack>
          <DisplayXL>{t('welcome', 'make_room_for_each_other')}</DisplayXL>
          <BodyText>{t('welcome', 'find_a_time_your_friends_are_actually')}</BodyText>
        </Stack>
        <Stack>
          {onContinueWithApple === undefined ? null : (
            <Button
              label={t('welcome', 'continue_with_apple')}
              variant="secondary"
              onPress={onContinueWithApple}
            />
          )}
          {onContinueWithGoogle === undefined ? null : (
            <Button
              label={t('welcome', 'continue_with_google')}
              variant="secondary"
              onPress={onContinueWithGoogle}
            />
          )}
          <Button
            label={t('welcome', 'continue_with_email')}
            variant="secondary"
            onPress={onContinueWithEmail}
          />
        </Stack>
        <Small>
          {t('welcome', 'friends_you_invite_never_need_an_account')}{' '}
          <InlineLink onPress={onTerms}>{t('welcome', 'terms')}</InlineLink> {t('welcome', 'and')}{' '}
          <InlineLink onPress={onPrivacy}>{t('welcome', 'privacy')}</InlineLink>{' '}
          {t('welcome', 'basics_no_ads_no_selling_data_18')}
        </Small>
      </Body>
    </Screen>
  );
}
