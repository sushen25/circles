import {
  Body,
  BodyText,
  Button,
  DisplayL,
  Foot,
  Screen,
  TopBar,
  Loading,
  useLoadingHold,
} from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ScreenState } from '../state';
import { LoadFailed } from '../system/LoadFailed';

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
  actionVariant = 'secondary',
  onAction,
  onRetry,
  onBack,
}: {
  state: ScreenState;
  /** For the statement states: what is true. */
  title?: string | undefined;
  body?: string | undefined;
  action?: string | undefined;
  /** The statement's way forward leads when it is the only thing to do. */
  actionVariant?: 'primary' | 'secondary' | undefined;
  onAction?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
}) {
  const loading = useLoadingHold(state === 'loading');
  if (loading) {
    return (
      <Loading
        message={t('planSetup', 'loading')}
        shape="detail"
        onBack={onBack}
        onRetry={onRetry}
      />
    );
  }
  if (state === 'error' || state === 'offline') {
    return (
      <LoadFailed
        state={state}
        message={t('planSetup', state === 'offline' ? 'youre_offline' : 'couldnt_load')}
        where="circles"
        onBack={onBack}
        onRetry={onRetry}
      />
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
          <Button label={action} variant={actionVariant} onPress={onAction} />
        </Foot>
      )}
    </Screen>
  );
}
