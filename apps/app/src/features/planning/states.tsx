import { Body, BodyText, Button, DisplayL, Foot, Screen, Small, TopBar } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ScreenState } from '../state';

/**
 * The states the plan screens share (manifesto §7): loading, error and
 * offline with a retry, and a plain page for everything that is a statement
 * rather than a form — "only the organiser can", "this plan is over". Each
 * screen's own default state is drawn by the screen.
 */
export function PlanStateScreen({
  state,
  title,
  body,
  action,
  onAction,
  onRetry,
  onBack,
}: {
  state: ScreenState;
  /** For the statement states: what is true. */
  title?: string | undefined;
  body?: string | undefined;
  action?: string | undefined;
  onAction?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
}) {
  if (state === 'loading') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('planSetup', 'loading')}</Small>
        </Body>
      </Screen>
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayL>
            {state === 'offline' ? t('planSetup', 'youre_offline') : t('planSetup', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('planSetup', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }
  return (
    <Screen>
      <TopBar onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <Stack>
          <DisplayL>{title ?? t('planSetup', 'not_found')}</DisplayL>
          {body === undefined ? null : <BodyText>{body}</BodyText>}
        </Stack>
      </Body>
      {action === undefined ? null : (
        <Foot>
          <Button label={action} variant="secondary" onPress={onAction} />
        </Foot>
      )}
    </Screen>
  );
}
