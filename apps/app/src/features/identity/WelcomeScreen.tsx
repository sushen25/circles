import { BrandLockup, Body, BodyText, Button, Screen, Small } from '../../components';
import { t } from '../../copy';
import type { ScreenState } from '../state';

/**
 * What `/` shows while it works out where to send somebody who is signed in
 * (spec §5.1). There is no Welcome screen any more: the front door is the first
 * circle, with no sign-in before it (ADR 00YY), and the returning organiser's way
 * in is the quiet "Sign in" on that screen.
 *
 * `loading` is a returning account being sent on to its circles, which takes a
 * read; `error` and `offline` are that read failing.
 */
export type WelcomeProps = {
  state: ScreenState;
  onRetry?: (() => void) | undefined;
};

export function WelcomeScreen({ state, onRetry }: WelcomeProps) {
  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <Body>
          <BrandLockup />
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
        <BrandLockup />
        <Small accessibilityLiveRegion="polite">{t('welcome', 'opening_your_circles')}</Small>
      </Body>
    </Screen>
  );
}
