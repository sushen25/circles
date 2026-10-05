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
 * - "Still working on it…" at ~8 s, "Try again" at ~20 s (only where the screen
 *   can retry: `onRetry`).
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
  onBack?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
};

export function Loading({ message, shape, topTitle, onBack, onRetry }: Props) {
  const shown = useDelayedShow(true, WAIT.skeletonAfter, 0);
  const { slow, stuck } = useSlow(true);

  return (
    <Screen>
      <TopBar title={topTitle} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        {shown ? (
          <>
            <Stack gap={4}>
              <BodyText accessibilityLiveRegion="polite">{message}</BodyText>
              {slow ? (
                <BodyText accessibilityLiveRegion="polite">{t('common', 'still_working')}</BodyText>
              ) : null}
            </Stack>
            {stuck && onRetry !== undefined ? (
              <Button label={t('common', 'try_again')} variant="secondary" onPress={onRetry} />
            ) : null}
            <Skeleton shape={shape} />
          </>
        ) : null}
      </Body>
    </Screen>
  );
}
