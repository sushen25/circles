import {
  Body,
  BodyText,
  Button,
  DisplayL,
  DisplayXL,
  Foot,
  Notice,
  Screen,
  Small,
  Tertiary,
  TopBar,
} from '../../components';
import { t } from '../../copy';
import type { ScreenState } from '../state';

/**
 * JoinAsAccount — somebody with an account opens a plan link to a circle they
 * are not in (ADR 0022, Decision 3).
 *
 * No artboard exists; this follows `Main`'s layout: the circle, one sentence,
 * one button, and a way out. **One tap and not none**, because joining is
 * something everybody in the circle sees, and opening a link should not be an
 * act with an audience. **Never a list of names**: those are guests, and an
 * account is nobody's guest.
 *
 * The button names the person when their profile has a name, and the circle
 * alone when it has only the placeholder — in which case the container asks
 * for a name rather than joining them as "Guest".
 */
export type JoinAsAccountProblem = 'circle_full' | 'too_many_tries' | 'couldnt_join' | 'offline';

export type JoinAsAccountProps = {
  state?: ScreenState | undefined;
  circleName?: string | undefined;
  /** The account's own name, or null when it has not chosen one. */
  personName?: string | null | undefined;
  problem?: JoinAsAccountProblem | undefined;
  reference?: string | undefined;
  busy?: boolean | undefined;
  onJoin?: (() => void) | undefined;
  onNotNow?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

function problemCopy(problem: JoinAsAccountProblem, circle: string): string {
  switch (problem) {
    case 'circle_full':
      return t('joinAsAccount', 'circle_full', { circle });
    case 'too_many_tries':
      return t('joinAsAccount', 'too_many_tries');
    case 'offline':
      return t('joinAsAccount', 'youre_offline');
    case 'couldnt_join':
      return t('joinAsAccount', 'couldnt_join');
  }
}

export function JoinAsAccountScreen({
  state = 'default',
  circleName,
  personName = null,
  problem,
  reference,
  busy = false,
  onJoin,
  onNotNow,
  onRetry,
  onBack,
}: JoinAsAccountProps) {
  if (state === 'error' || state === 'offline') {
    return (
      <Screen>
        <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <DisplayL>
            {state === 'offline'
              ? t('joinAsAccount', 'youre_offline')
              : t('joinAsAccount', 'couldnt_load')}
          </DisplayL>
        </Body>
        <Foot>
          <Button label={t('joinAsAccount', 'try_again')} onPress={onRetry} />
        </Foot>
      </Screen>
    );
  }

  if (state === 'loading' || circleName === undefined) {
    return (
      <Screen>
        <TopBar onBack={onBack} backLabel={t('common', 'back')} />
        <Body>
          <Small accessibilityLiveRegion="polite">{t('joinAsAccount', 'finding_the_circle')}</Small>
        </Body>
      </Screen>
    );
  }

  const label = busy
    ? t('joinAsAccount', 'joining')
    : personName === null
      ? t('joinAsAccount', 'join', { circle: circleName })
      : t('joinAsAccount', 'join_as', { circle: circleName, name: personName });

  return (
    <Screen>
      <TopBar title={circleName} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        <DisplayXL>
          {t('joinAsAccount', 'circle_is_finding_a_time', { circle: circleName })}
        </DisplayXL>
        <BodyText>{t('joinAsAccount', 'join_to_pick_your_times', { circle: circleName })}</BodyText>
        {problem === undefined ? null : (
          <Notice kind="warn">{problemCopy(problem, circleName)}</Notice>
        )}
        {reference === undefined ? null : (
          <Small>{t('joinAsAccount', 'reference', { reference })}</Small>
        )}
      </Body>
      <Foot>
        <Button label={label} onPress={onJoin} disabled={busy} />
        <Tertiary label={t('joinAsAccount', 'not_now')} onPress={onNotNow} />
      </Foot>
    </Screen>
  );
}
