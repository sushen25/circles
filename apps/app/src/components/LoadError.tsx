import { useContext, type ReactNode } from 'react';
import { QueryClientContext } from '@tanstack/react-query';

import { t } from '../copy';
import { Button, Tertiary } from './Button';
import { Body, Foot, Screen, TopBar } from './Screen';
import { DisplayL, Small } from './Text';
import { Stack } from './layout';

/**
 * The one error block (SUS-200; manifesto §7: plain language, a reference, a
 * way forward). Every "We couldn't load…" screen is this, so a failure always
 * says the same three things in the same order:
 *
 * 1. what happened, in the screen's own sentence (`message`);
 * 2. a short `reference`, small and selectable, for the person to read out and
 *    the founder to find in the logs. Absent when the request never reached the
 *    server ("You're offline"), because there is nothing to find;
 * 3. **Try again**, and a second way out that does not depend on the screen
 *    that just failed (`exit`), because Try again cannot succeed when the cause
 *    is not a blip.
 *
 * Presentational: it holds no router and no analytics. `features/system/LoadFailed`
 * makes the reference, picks the exit and puts it here.
 *
 * "Try again" is `common.try_again`, the same words and the same behaviour as
 * the one `Loading` offers at 20 s: the screen's own `onRetry` wins, and
 * without one it asks again for the queries that failed, so a screen that
 * forgot to pass one does not get a dead button.
 */
export type LoadErrorExit = { label: string; onPress: () => void };

type Props = {
  /** The screen's own sentence: "We couldn't load this plan." */
  message: string;
  /** What the person reads out. Never a token, a code, an address or a name. */
  reference?: string | undefined;
  exit: LoadErrorExit;
  /** A line under the exit, for a route whose real way out is outside the app. */
  hint?: string | undefined;
  onRetry?: (() => void) | undefined;
  topTitle?: string | undefined;
  onBack?: (() => void) | undefined;
  /** A top bar of the screen's own, in place of the plain one. */
  top?: ReactNode;
  /** What the screen keeps while it is in trouble: Welcome's brand lockup. */
  header?: ReactNode;
};

/** Asks again for whatever failed, when the screen did not say how. */
function useRetryFailed(): (() => void) | undefined {
  const client = useContext(QueryClientContext);
  if (client === undefined) return undefined;
  return () =>
    void client.refetchQueries({
      predicate: (query) => query.isActive() && query.state.status === 'error',
    });
}

export function LoadError({
  message,
  reference,
  exit,
  hint,
  onRetry,
  topTitle,
  onBack,
  top,
  header,
}: Props) {
  const fallback = useRetryFailed();
  const retry = onRetry ?? fallback;

  return (
    <Screen>
      {top ?? <TopBar title={topTitle} onBack={onBack} backLabel={t('common', 'back')} />}
      <Body>
        {header}
        <Stack gap={8}>
          <DisplayL accessibilityLiveRegion="polite">{message}</DisplayL>
          {reference === undefined ? null : (
            <Small selectable>{t('loadError', 'reference', { reference })}</Small>
          )}
        </Stack>
      </Body>
      <Foot>
        <Button label={t('common', 'try_again')} onPress={retry} />
        <Tertiary label={exit.label} onPress={exit.onPress} />
        {hint === undefined ? null : <Small>{hint}</Small>}
      </Foot>
    </Screen>
  );
}
