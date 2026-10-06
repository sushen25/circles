import { useContext, type ReactNode } from 'react';
import { QueryClientContext, type Query } from '@tanstack/react-query';

import { t } from '../copy';
import { Button } from './Button';
import { Skeleton, type SkeletonShape } from './Skeleton';
import { Body, Screen, TopBar } from './Screen';
import { Body as BodyText } from './Text';
import { WAIT, useDelayedShow, useSlow } from './wait';
import { Stack } from './layout';

/**
 * The screen a wait sits on, shaped like the screen it is waiting for
 * (SUS-155). Loading is not an error or an empty state, so it is not
 * `Placeholder`.
 *
 * - The top bar and the ground only for the first ~300 ms, so a fast load never
 *   flashes a skeleton or a sentence.
 * - Then the skeleton and the sentence together. The sentence is a live region
 *   that arrives with them, so a screen reader reads it once.
 * - "Still working on it…" at ~8 s, "Try again" at ~20 s. A screen's own `onRetry`
 *   wins; without one, "Try again" refetches the queries that are still
 *   waiting for their first answer, and is offered only if there are any
 *   (SUS-157). A wait with no query behind it has nothing to retry and offers
 *   nothing.
 * - `header` is what the screen keeps while it waits, drawn at once with the
 *   bar and never delayed: Welcome's brand lockup.
 * - Always on the light ground, the confirmed screen's included.
 *
 * Screens call `useLoadingHold(state === 'loading')` and render this while it
 * is true, which keeps it up for at least ~400 ms once it has appeared.
 */
type Props = {
  /** The screen's own sentence: "Getting the plan". */
  message: string;
  shape: SkeletonShape;
  topTitle?: string | undefined;
  header?: ReactNode;
  onBack?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
};

/** A query that is still on its way to its first answer (or being asked again), and is wanted. */
function isWaiting(query: Query): boolean {
  return (
    query.isActive() &&
    !query.isDisabled() &&
    (query.state.data === undefined || query.state.fetchStatus === 'fetching')
  );
}

/**
 * What "Try again" does when the screen gave no `onRetry`: drop the fetch that
 * is hanging and ask again. A plain refetch is not enough, because a query with
 * no answer yet keeps the request it already has in flight and hands that back.
 * `undefined` when nothing is waiting on a query, so there is no dead button.
 */
function useRetryWaiting(stuck: boolean): (() => void) | undefined {
  const client = useContext(QueryClientContext);
  if (!stuck || client === undefined) return undefined;
  const targets = client.getQueryCache().findAll({ predicate: isWaiting });
  if (targets.length === 0) return undefined;
  // The targets are fixed before anything is cancelled: a query that had data and
  // was only being refreshed stops matching `isWaiting` the moment its fetch is
  // cancelled, and would never be asked again.
  const same = (query: Query) => targets.includes(query);
  return () =>
    void client
      .cancelQueries({ predicate: same })
      .then(() => client.refetchQueries({ predicate: same }));
}

export function Loading({ message, shape, topTitle, header, onBack, onRetry }: Props) {
  const shown = useDelayedShow(true, WAIT.skeletonAfter, 0);
  const { slow, stuck } = useSlow(true);
  const waitingQueries = useRetryWaiting(stuck);
  const retry = onRetry ?? waitingQueries;

  return (
    <Screen>
      <TopBar title={topTitle} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        {header}
        {shown ? (
          <>
            <Stack gap={4}>
              <BodyText accessibilityLiveRegion="polite">{message}</BodyText>
              {slow ? (
                <BodyText accessibilityLiveRegion="polite">{t('common', 'still_working')}</BodyText>
              ) : null}
            </Stack>
            {stuck && retry !== undefined ? (
              <Button label={t('common', 'try_again')} variant="secondary" onPress={retry} />
            ) : null}
            <Skeleton shape={shape} />
          </>
        ) : null}
      </Body>
    </Screen>
  );
}
